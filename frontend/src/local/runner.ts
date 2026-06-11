/**
 * 浏览器内评测任务执行器（移植后端 core/runner.py）。
 * 串行跑（网关限流 1 req/s），进度实时写 IndexedDB，支持手动停止。
 */

import { db, nowIso, Row } from "./db";
import { callLLM, extractJson, LLMError, renderPrompt, systemPromptFromSchema } from "./llm";

const cancelFlags = new Map<number, { cancelled: boolean }>();

export function requestCancel(taskId: number): boolean {
  const f = cancelFlags.get(taskId);
  if (!f) return false;
  f.cancelled = true;
  return true;
}

type RowResult = {
  raw_output: string;
  parsed_json: Record<string, unknown> | null;
  parse_ok: boolean;
  status: string;
  error: string;
  latency_ms: number;
};

async function evalRow(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  template: string;
  row: Row;
}): Promise<RowResult> {
  const userPrompt = renderPrompt(opts.template, opts.row);
  let text: string;
  let latency: number;
  try {
    const r = await callLLM({
      apiKey: opts.apiKey,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      userPrompt,
    });
    text = r.text;
    latency = r.latencyMs;
  } catch (e) {
    return {
      raw_output: "",
      parsed_json: null,
      parse_ok: false,
      status: "failed",
      error: e instanceof LLMError ? e.message : String(e),
      latency_ms: 0,
    };
  }

  const { parsed, error } = extractJson(text);
  if (parsed === null) {
    return {
      raw_output: text,
      parsed_json: null,
      parse_ok: false,
      status: "parse_error",
      error,
      latency_ms: latency,
    };
  }
  return {
    raw_output: text,
    parsed_json: parsed,
    parse_ok: true,
    status: "success",
    error: "",
    latency_ms: latency,
  };
}

/** 单行试运行（不写库） */
export async function trialRunOne(opts: {
  apiKey: string;
  datasetId: number;
  model: string;
  promptTemplate: string;
  jsonSchema: string;
  rowIndex: number;
}): Promise<RowResult> {
  const ds = await db.datasets.get(opts.datasetId);
  if (!ds) throw new Error("dataset not found");
  if (opts.rowIndex < 0 || opts.rowIndex >= ds.data.length) throw new Error("row_index out of range");
  return evalRow({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: systemPromptFromSchema(opts.jsonSchema),
    template: opts.promptTemplate,
    row: ds.data[opts.rowIndex],
  });
}

/** 后台跑一个任务的全部行（fire-and-forget，调用方不 await）。 */
export async function runTask(taskId: number, apiKey: string): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const ds = await db.datasets.get(task.dataset_id);
  if (!ds) {
    await db.tasks.update(taskId, { status: "failed", error: "dataset missing", finished_at: nowIso() });
    return;
  }

  const total = ds.data.length;
  await db.results.where("task_id").equals(taskId).delete();
  await db.tasks.update(taskId, {
    status: "running",
    total,
    processed: 0,
    succeeded: 0,
    failed: 0,
  });

  const flag = { cancelled: false };
  cancelFlags.set(taskId, flag);
  const systemPrompt = systemPromptFromSchema(task.json_schema);

  try {
    for (let i = 0; i < total; i++) {
      let res: RowResult;
      if (flag.cancelled) {
        res = {
          raw_output: "",
          parsed_json: null,
          parse_ok: false,
          status: "stopped",
          error: "任务已手动停止",
          latency_ms: 0,
        };
      } else {
        res = await evalRow({
          apiKey,
          model: task.model,
          systemPrompt,
          template: task.prompt_template,
          row: ds.data[i],
        });
      }
      await db.results.add({
        task_id: taskId,
        row_index: i,
        input_json: ds.data[i],
        ...res,
      } as never);
      const t = await db.tasks.get(taskId);
      if (!t) return; // 任务被删除，停止
      await db.tasks.update(taskId, {
        processed: t.processed + 1,
        succeeded: t.succeeded + (res.status === "success" ? 1 : 0),
        failed: t.failed + (res.status !== "success" && res.status !== "stopped" ? 1 : 0),
      });
    }
    await db.tasks.update(taskId, {
      status: flag.cancelled ? "stopped" : "done",
      finished_at: nowIso(),
    });
  } catch (e) {
    await db.tasks.update(taskId, {
      status: "failed",
      error: String(e),
      finished_at: nowIso(),
    });
  } finally {
    cancelFlags.delete(taskId);
  }
}

/** 重试单行；写回 results 并刷新任务计数。 */
export async function retryRow(taskId: number, rowIndex: number, apiKey: string): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) throw new Error("task not found");
  const ds = await db.datasets.get(task.dataset_id);
  if (!ds) throw new Error("dataset missing");
  if (rowIndex < 0 || rowIndex >= ds.data.length) throw new Error("row_index out of range");

  const res = await evalRow({
    apiKey,
    model: task.model,
    systemPrompt: systemPromptFromSchema(task.json_schema),
    template: task.prompt_template,
    row: ds.data[rowIndex],
  });

  const existing = await db.results.where("[task_id+row_index]").equals([taskId, rowIndex]).first();
  if (existing) {
    const wasSuccess = existing.status === "success";
    const nowSuccess = res.status === "success";
    await db.results.update(existing.id!, { ...res, input_json: ds.data[rowIndex] });
    const t = await db.tasks.get(taskId);
    if (t) {
      let { succeeded, failed } = t;
      if (wasSuccess && !nowSuccess) {
        succeeded -= 1;
        failed += 1;
      } else if (!wasSuccess && nowSuccess) {
        succeeded += 1;
        failed = Math.max(0, failed - 1);
      }
      await db.tasks.update(taskId, { succeeded, failed });
    }
  } else {
    await db.results.add({
      task_id: taskId,
      row_index: rowIndex,
      input_json: ds.data[rowIndex],
      ...res,
    } as never);
  }
}
