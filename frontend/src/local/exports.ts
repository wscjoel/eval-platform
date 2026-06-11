/**
 * 本地导出：评测任务结果 / 批注作业（移植后端 write_results_xlsx 与 export_job）。
 */

import { db } from "./db";
import { downloadBlob, rowsToXlsxBlob } from "./excel";

/** 多选 JSON 字符串还原成 ; 拼接 */
function stringifyAnnoValue(v: string): string {
  if (!v) return "";
  const s = v.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x)).join(";");
    } catch {
      /* 保留原值 */
    }
  }
  return v;
}

export async function exportTaskXlsx(taskId: number): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) throw new Error("task not found");
  const ds = await db.datasets.get(task.dataset_id);
  if (!ds) throw new Error("dataset missing");
  const results = await db.results.where("task_id").equals(taskId).toArray();
  const byRow = new Map(results.map((r) => [r.row_index, r]));

  // 收集所有解析字段（保持出现顺序）
  const parsedKeys: string[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.parsed_json && typeof r.parsed_json === "object") {
      for (const k of Object.keys(r.parsed_json)) {
        if (!seen.has(k)) {
          seen.add(k);
          parsedKeys.push(k);
        }
      }
    }
  }

  const rows: Record<string, unknown>[] = [];
  const columns = [
    ...ds.columns,
    ...parsedKeys.map((k) => `eval_${k}`),
    "eval_status",
    "eval_raw_output",
    "eval_error",
    "eval_latency_ms",
  ];
  for (let i = 0; i < ds.data.length; i++) {
    const base: Record<string, unknown> = { ...ds.data[i] };
    const r = byRow.get(i);
    if (!r) {
      rows.push(base);
      continue;
    }
    const pj = (r.parsed_json || {}) as Record<string, unknown>;
    for (const k of parsedKeys) {
      let v = pj[k];
      if (v !== null && typeof v === "object") v = JSON.stringify(v);
      base[`eval_${k}`] = v ?? "";
    }
    base["eval_status"] = r.status;
    base["eval_raw_output"] = r.raw_output;
    base["eval_error"] = r.error;
    base["eval_latency_ms"] = r.latency_ms;
    rows.push(base);
  }

  const safeName = `task_${taskId}_${task.name.replace(/\//g, "_").slice(0, 60)}.xlsx`;
  downloadBlob(rowsToXlsxBlob(rows, columns), safeName);
}

export async function exportAnnoJobXlsx(jobId: number): Promise<void> {
  const job = await db.annoJobs.get(jobId);
  if (!job) throw new Error("job not found");
  const annos = await db.annotations.where("job_id").equals(jobId).toArray();
  const byRow = new Map<number, Record<string, string>>();
  for (const a of annos) {
    if (!byRow.has(a.row_index)) byRow.set(a.row_index, {});
    byRow.get(a.row_index)![a.dimension_name] = stringifyAnnoValue(a.value);
  }

  const mapping = job.column_mapping || {};
  const columns = [...job.source_columns];
  const rows: Record<string, unknown>[] = job.source_data.map((r) => ({ ...r }));

  for (const dim of job.selected_dimensions || []) {
    const targetCol = mapping[dim] || dim;
    if (!columns.includes(targetCol)) columns.push(targetCol);
    for (let i = 0; i < rows.length; i++) {
      const v = byRow.get(i)?.[dim] || "";
      if (v) rows[i][targetCol] = v;
      else if (!(targetCol in rows[i])) rows[i][targetCol] = "";
    }
  }

  const stem = job.source_filename.replace(/\.[^.]+$/, "");
  downloadBlob(rowsToXlsxBlob(rows, columns), `${stem}_annotated.xlsx`);
}
