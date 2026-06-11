/**
 * axios 本地 adapter：把所有 /api/* 请求路由到浏览器本地实现（IndexedDB + 直连 LLM）。
 *
 * 页面组件零改动 —— 仍然调用 api.get/post/...，由本 adapter 在浏览器内完成
 * 原后端的全部业务逻辑。错误以 axios 风格抛出（error.response.data.detail）。
 */

import {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import {
  db,
  ensureSeeded,
  nowIso,
  LocalAnnoDim,
  LocalAnnoJob,
  Row,
} from "./db";
import { fileExt, parseTableFile, readTextFile, rowsToXlsxBlob, TABLE_EXTS, TEXT_EXTS } from "./excel";
import { runCleaningScript } from "./cleaningRunner";
import { requestCancel, retryRow, runTask, trialRunOne } from "./runner";
import { settings } from "./settings";

const EVAL_MAX_ROWS = 10000;

// ---------------- 工具 ----------------

class HttpError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

function uuid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type HandlerResult = { data: unknown; status?: number; headers?: Record<string, string> };
type Handler = (ctx: {
  m: RegExpMatchArray;
  body: any;
  params: Record<string, string>;
  config: InternalAxiosRequestConfig;
}) => Promise<HandlerResult | unknown>;

type RouteDef = { method: string; pattern: RegExp; handler: Handler };

const routes: RouteDef[] = [];
function route(method: string, pattern: RegExp, handler: Handler) {
  routes.push({ method, pattern, handler });
}

function datasetOut(d: { id?: number; name: string; filename: string; rows: number; columns: string[]; created_at: string }) {
  return {
    id: d.id!,
    name: d.name,
    filename: d.filename,
    rows: d.rows,
    columns: d.columns,
    created_at: d.created_at,
  };
}

async function getDatasetOr404(id: number) {
  const ds = await db.datasets.get(id);
  if (!ds) throw new HttpError(404, "dataset not found");
  return ds;
}

async function getTaskOr404(id: number) {
  const t = await db.tasks.get(id);
  if (!t) throw new HttpError(404, "task not found");
  return t;
}

// ---------------- health / models ----------------

route("get", /^\/health$/, async () => ({ ok: true, has_env_api_key: false }));

route("get", /^\/models$/, async () => ({ models: settings.models() }));

// ---------------- datasets ----------------

route("post", /^\/datasets$/, async ({ body }) => {
  const file = (body as FormData).get("file") as File | null;
  if (!file || !file.name) throw new HttpError(400, "missing filename");
  const ext = fileExt(file.name);
  if (!TABLE_EXTS.includes(ext)) throw new HttpError(400, `unsupported file type: ${ext}`);
  let parsed;
  try {
    parsed = await parseTableFile(file);
  } catch (e) {
    throw new HttpError(400, `parse failed: ${e}`);
  }
  if (parsed.rows.length > EVAL_MAX_ROWS)
    throw new HttpError(400, `too many rows: ${parsed.rows.length} > ${EVAL_MAX_ROWS}`);

  const rec = {
    name: file.name,
    filename: `${uuid()}${ext}`,
    rows: parsed.rows.length,
    columns: parsed.columns,
    data: parsed.rows,
    created_at: nowIso(),
  };
  const id = await db.datasets.add(rec);
  return { ...datasetOut({ ...rec, id }), preview: parsed.rows };
});

route("get", /^\/datasets$/, async () => {
  const all = await db.datasets.toArray();
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return all.map(datasetOut);
});

route("get", /^\/datasets\/(\d+)$/, async ({ m }) => {
  const ds = await getDatasetOr404(Number(m[1]));
  return { ...datasetOut(ds), preview: ds.data };
});

route("delete", /^\/datasets\/(\d+)$/, async ({ m }) => {
  const id = Number(m[1]);
  await getDatasetOr404(id);
  const taskCount = await db.tasks.where("dataset_id").equals(id).count();
  if (taskCount > 0) throw new HttpError(400, "dataset has tasks, delete tasks first");
  await db.datasets.delete(id);
  return { ok: true };
});

route("get", /^\/datasets\/(\d+)\/download$/, async ({ m }) => {
  const ds = await getDatasetOr404(Number(m[1]));
  return {
    data: rowsToXlsxBlob(ds.data, ds.columns),
    headers: { "content-disposition": `attachment; filename="${encodeURIComponent(ds.name)}"` },
  };
});

route("put", /^\/datasets\/(\d+)\/replace$/, async ({ m, body }) => {
  const ds = await getDatasetOr404(Number(m[1]));
  const taskCount = await db.tasks.where("dataset_id").equals(ds.id!).count();
  if (taskCount > 0)
    throw new HttpError(409, "数据集已被评测任务引用，无法直接覆盖。请使用「另存为新数据集」。");
  const rows: Row[] = (body.rows || []).map(normalizeRow);
  if (!rows.length) throw new HttpError(400, "rows is empty");
  if (rows.length > EVAL_MAX_ROWS)
    throw new HttpError(400, `too many rows: ${rows.length} > ${EVAL_MAX_ROWS}`);
  const columns = inferCols(rows);
  const patch: Partial<typeof ds> = { rows: rows.length, columns, data: rows };
  if (body.name && String(body.name).trim()) patch.name = String(body.name).trim();
  await db.datasets.update(ds.id!, patch);
  const updated = (await db.datasets.get(ds.id!))!;
  return { ...datasetOut(updated), preview: updated.data };
});

route("post", /^\/datasets\/from-cleaning$/, async ({ body }) => {
  const rows: Row[] = (body.rows || []).map(normalizeRow);
  if (!rows.length) throw new HttpError(400, "rows is empty");
  if (rows.length > EVAL_MAX_ROWS)
    throw new HttpError(400, `too many rows: ${rows.length} > ${EVAL_MAX_ROWS}`);
  let displayName = String(body.name || "").trim();
  if (!/\.(xlsx|xls|csv)$/i.test(displayName)) displayName = `${displayName}.xlsx`;
  const columns = inferCols(rows);
  const rec = {
    name: displayName,
    filename: `${uuid()}.xlsx`,
    rows: rows.length,
    columns,
    data: rows,
    created_at: nowIso(),
  };
  const id = await db.datasets.add(rec);
  return { ...datasetOut({ ...rec, id }), preview: rows };
});

function normalizeRow(r: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    out[String(k).trim()] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

function inferCols(rows: Row[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

// ---------------- tasks ----------------

route("post", /^\/tasks\/trial$/, async ({ body }) => {
  const apiKey = (body.api_key || "").trim() || settings.apiKey();
  if (!apiKey) throw new HttpError(400, "缺少 API Key：请在顶部设置中填写");
  if (!settings.models().includes(body.model)) throw new HttpError(400, "invalid model");
  try {
    const res = await trialRunOne({
      apiKey,
      datasetId: body.dataset_id,
      model: body.model,
      promptTemplate: body.prompt_template,
      jsonSchema: body.json_schema || "",
      rowIndex: body.row_index ?? 0,
    });
    return {
      raw_output: res.raw_output,
      parsed_json: res.parsed_json,
      parse_ok: res.parse_ok,
      error: res.error,
      latency_ms: res.latency_ms,
    };
  } catch (e) {
    throw new HttpError(400, String(e instanceof Error ? e.message : e));
  }
});

route("post", /^\/tasks$/, async ({ body }) => {
  if (!settings.models().includes(body.model)) throw new HttpError(400, "invalid model");
  const apiKey = (body.api_key || "").trim() || settings.apiKey();
  if (!apiKey) throw new HttpError(400, "缺少 API Key：请在顶部设置中填写");
  const ds = await getDatasetOr404(body.dataset_id);
  const running = await db.tasks.where("status").equals("running").count();
  if (running > 0) throw new HttpError(409, "another task is running, please wait");

  const rec = {
    dataset_id: body.dataset_id,
    name: body.name,
    model: body.model,
    prompt_template: body.prompt_template,
    json_schema: body.json_schema || "",
    temperature: body.temperature ?? 0.2,
    status: "pending",
    total: ds.rows,
    processed: 0,
    succeeded: 0,
    failed: 0,
    error: "",
    created_at: nowIso(),
    finished_at: null,
  };
  const id = await db.tasks.add(rec);
  // 后台跑，不阻塞响应（页面轮询任务进度）
  void runTask(id, apiKey);
  return { ...rec, id };
});

route("get", /^\/tasks$/, async () => {
  const all = await db.tasks.toArray();
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return all;
});

route("get", /^\/tasks\/(\d+)$/, async ({ m }) => getTaskOr404(Number(m[1])));

route("delete", /^\/tasks\/(\d+)$/, async ({ m }) => {
  const t = await getTaskOr404(Number(m[1]));
  if (t.status === "running" || t.status === "stopping")
    throw new HttpError(400, "cannot delete a running task");
  await db.results.where("task_id").equals(t.id!).delete();
  await db.tasks.delete(t.id!);
  return { ok: true };
});

route("post", /^\/tasks\/(\d+)\/stop$/, async ({ m }) => {
  const t = await getTaskOr404(Number(m[1]));
  if (t.status !== "running" && t.status !== "pending")
    throw new HttpError(400, `cannot stop a task in status: ${t.status}`);
  requestCancel(t.id!);
  await db.tasks.update(t.id!, { status: "stopping" });
  return await db.tasks.get(t.id!);
});

route("get", /^\/tasks\/(\d+)\/results$/, async ({ m, params }) => {
  const taskId = Number(m[1]);
  await getTaskOr404(taskId);
  const status = params.status || "";
  const offset = Number(params.offset || 0);
  const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);

  let all = await db.results.where("task_id").equals(taskId).toArray();
  all.sort((a, b) => a.row_index - b.row_index);

  // 解析字段（全量成功结果）
  const parsedKeys: string[] = [];
  const seen = new Set<string>();
  for (const r of all) {
    if (r.parse_ok && r.parsed_json && typeof r.parsed_json === "object") {
      for (const k of Object.keys(r.parsed_json)) {
        if (!seen.has(k)) {
          seen.add(k);
          parsedKeys.push(k);
        }
      }
    }
  }

  if (status) all = all.filter((r) => r.status === status);
  return {
    total: all.length,
    items: all.slice(offset, offset + limit),
    parsed_keys: parsedKeys,
  };
});

route("post", /^\/tasks\/(\d+)\/retry\/(\d+)$/, async ({ m, params }) => {
  const taskId = Number(m[1]);
  const rowIndex = Number(m[2]);
  const apiKey = (params.api_key || "").trim() || settings.apiKey();
  if (!apiKey) throw new HttpError(400, "缺少 API Key：请在顶部设置中填写");
  try {
    await retryRow(taskId, rowIndex, apiKey);
  } catch (e) {
    throw new HttpError(400, String(e instanceof Error ? e.message : e));
  }
  const r = await db.results.where("[task_id+row_index]").equals([taskId, rowIndex]).first();
  return r;
});

// ---------------- prompts ----------------

route("get", /^\/prompts$/, async () => {
  const all = await db.prompts.toArray();
  all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return all;
});

route("post", /^\/prompts$/, async ({ body }) => {
  const dupe = await db.prompts.where("name").equals(body.name).first();
  if (dupe) throw new HttpError(409, `name already exists: ${body.name}`);
  const rec = {
    name: body.name,
    description: body.description || "",
    system_prompt: body.system_prompt || "",
    prompt_template: body.prompt_template,
    json_schema: body.json_schema || "",
    default_model: body.default_model || "",
    default_temperature: body.default_temperature ?? 0.2,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const id = await db.prompts.add(rec);
  return { ...rec, id };
});

route("get", /^\/prompts\/(\d+)$/, async ({ m }) => {
  const p = await db.prompts.get(Number(m[1]));
  if (!p) throw new HttpError(404, "prompt not found");
  return p;
});

route("put", /^\/prompts\/(\d+)$/, async ({ m, body }) => {
  const p = await db.prompts.get(Number(m[1]));
  if (!p) throw new HttpError(404, "prompt not found");
  if (body.name && body.name !== p.name) {
    const dupe = await db.prompts.where("name").equals(body.name).first();
    if (dupe) throw new HttpError(409, `name already exists: ${body.name}`);
  }
  const patch: Record<string, unknown> = {};
  for (const k of [
    "name",
    "description",
    "system_prompt",
    "prompt_template",
    "json_schema",
    "default_model",
    "default_temperature",
  ]) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = body[k];
  }
  patch.updated_at = nowIso();
  await db.prompts.update(p.id!, patch);
  return await db.prompts.get(p.id!);
});

route("delete", /^\/prompts\/(\d+)$/, async ({ m }) => {
  const p = await db.prompts.get(Number(m[1]));
  if (!p) throw new HttpError(404, "prompt not found");
  await db.prompts.delete(p.id!);
  return { ok: true };
});

// ---------------- 人工批注：模版 ----------------

async function tplToOut(tplId: number) {
  const tpl = await db.annoTemplates.get(tplId);
  if (!tpl) throw new HttpError(404, "template not found");
  const dims = await db.annoDims.where("template_id").equals(tplId).toArray();
  return {
    ...tpl,
    dimensions: dims.map((d) => ({
      dimension_name: d.dimension_name,
      input_type: d.input_type,
      select_mode: d.select_mode,
      options_text: d.options_text,
    })),
  };
}

route("get", /^\/anno\/templates$/, async () => {
  const all = await db.annoTemplates.toArray();
  all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return Promise.all(all.map((t) => tplToOut(t.id!)));
});

route("post", /^\/anno\/templates$/, async ({ body }) => {
  const dupe = await db.annoTemplates.where("name").equals(body.name).first();
  if (dupe) throw new HttpError(409, `template name exists: ${body.name}`);
  const rec = {
    name: body.name,
    description: body.description || "",
    data_columns: body.data_columns || [],
    annotation_columns: body.annotation_columns || [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const id = await db.annoTemplates.add(rec);
  return tplToOut(id);
});

route("get", /^\/anno\/templates\/(\d+)$/, async ({ m }) => tplToOut(Number(m[1])));

route("put", /^\/anno\/templates\/(\d+)$/, async ({ m, body }) => {
  const tpl = await db.annoTemplates.get(Number(m[1]));
  if (!tpl) throw new HttpError(404, "template not found");
  if (body.name && body.name !== tpl.name) {
    const dupe = await db.annoTemplates.where("name").equals(body.name).first();
    if (dupe) throw new HttpError(409, `name exists: ${body.name}`);
  }
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  for (const k of ["name", "description", "data_columns", "annotation_columns"]) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = body[k];
  }
  await db.annoTemplates.update(tpl.id!, patch as never);
  return tplToOut(tpl.id!);
});

route("delete", /^\/anno\/templates\/(\d+)$/, async ({ m }) => {
  const tplId = Number(m[1]);
  const tpl = await db.annoTemplates.get(tplId);
  if (!tpl) throw new HttpError(404, "template not found");
  const jobCount = await db.annoJobs.where("template_id").equals(tplId).count();
  if (jobCount > 0) throw new HttpError(400, "template has jobs, delete jobs first");
  await db.annoDims.where("template_id").equals(tplId).delete();
  await db.annoTemplates.delete(tplId);
  return { ok: true };
});

// ---------------- 人工批注：维度配置 ----------------

route("get", /^\/anno\/templates\/(\d+)\/dimensions\/(.+)$/, async ({ m }) => {
  const tplId = Number(m[1]);
  const name = decodeURIComponent(m[2]);
  const tpl = await db.annoTemplates.get(tplId);
  if (!tpl) throw new HttpError(404, "template not found");
  const cfg = await db.annoDims.where("[template_id+dimension_name]").equals([tplId, name]).first();
  if (!cfg) {
    return { dimension_name: name, input_type: "options", select_mode: "single", options_text: "" };
  }
  return {
    dimension_name: cfg.dimension_name,
    input_type: cfg.input_type,
    select_mode: cfg.select_mode,
    options_text: cfg.options_text,
  };
});

route("put", /^\/anno\/templates\/(\d+)\/dimensions\/(.+)$/, async ({ m, body }) => {
  const tplId = Number(m[1]);
  const name = decodeURIComponent(m[2]);
  const tpl = await db.annoTemplates.get(tplId);
  if (!tpl) throw new HttpError(404, "template not found");
  if (body.input_type !== "options" && body.input_type !== "text")
    throw new HttpError(400, "input_type must be 'options' or 'text'");
  if (body.input_type === "options" && body.select_mode !== "single" && body.select_mode !== "multi")
    throw new HttpError(400, "select_mode must be 'single' or 'multi' when input_type=options");

  const existing = await db.annoDims
    .where("[template_id+dimension_name]")
    .equals([tplId, name])
    .first();
  const rec: LocalAnnoDim = {
    id: existing?.id,
    template_id: tplId,
    dimension_name: name,
    input_type: body.input_type,
    select_mode: body.input_type === "options" ? body.select_mode : null,
    options_text: body.options_text || "",
  };
  if (existing) {
    await db.annoDims.update(existing.id!, rec as never);
  } else {
    delete rec.id;
    await db.annoDims.add(rec);
  }
  return {
    dimension_name: name,
    input_type: rec.input_type,
    select_mode: rec.select_mode,
    options_text: rec.options_text,
  };
});

// ---------------- 人工批注：上传 & 作业 ----------------

function buildParseResponse(
  columns: string[],
  rows: Row[],
  tpl: { data_columns: string[]; annotation_columns: string[] },
  sourcePath: string,
  sourceFilename: string
) {
  const templateFields = [...(tpl.data_columns || []), ...(tpl.annotation_columns || [])];
  const suggested: Record<string, string> = {};
  for (const f of templateFields) if (columns.includes(f)) suggested[f] = f;
  const emptyCols = columns.filter((c) => rows.every((r) => !String(r[c] ?? "").trim()));
  return {
    source_path: sourcePath,
    source_filename: sourceFilename,
    columns,
    total_rows: rows.length,
    suggested_mapping: suggested,
    empty_columns: emptyCols,
  };
}

route("post", /^\/anno\/jobs\/upload$/, async ({ body }) => {
  const fd = body as FormData;
  const tplId = Number(fd.get("template_id"));
  const file = fd.get("file") as File | null;
  const tpl = await db.annoTemplates.get(tplId);
  if (!tpl) throw new HttpError(404, "template not found");
  if (!file || !file.name) throw new HttpError(400, "missing filename");
  const ext = fileExt(file.name);
  if (!TABLE_EXTS.includes(ext)) throw new HttpError(400, `unsupported file type: ${ext}`);
  let parsed;
  try {
    parsed = await parseTableFile(file);
  } catch (e) {
    throw new HttpError(400, `parse failed: ${e}`);
  }
  if (parsed.rows.length > EVAL_MAX_ROWS)
    throw new HttpError(400, `too many rows: ${parsed.rows.length} > ${EVAL_MAX_ROWS}`);

  const sourcePath = `anno_${uuid()}${ext}`;
  await db.annoSources.add({
    source_path: sourcePath,
    source_filename: file.name,
    columns: parsed.columns,
    data: parsed.rows,
    created_at: nowIso(),
  });
  return buildParseResponse(parsed.columns, parsed.rows, tpl, sourcePath, file.name);
});

route("post", /^\/anno\/jobs\/from-dataset$/, async ({ body }) => {
  const tpl = await db.annoTemplates.get(body.template_id);
  if (!tpl) throw new HttpError(404, "template not found");
  const ds = await getDatasetOr404(body.dataset_id);
  const sourcePath = `anno_${uuid()}.xlsx`;
  await db.annoSources.add({
    source_path: sourcePath,
    source_filename: ds.name,
    columns: ds.columns,
    data: ds.data,
    created_at: nowIso(),
  });
  return buildParseResponse(ds.columns, ds.data, tpl, sourcePath, ds.name);
});

async function jobProgress(job: LocalAnnoJob): Promise<{ annotated: number; pending: number }> {
  if (!job.selected_dimensions?.length) return { annotated: 0, pending: job.total_rows };
  const annos = await db.annotations.where("job_id").equals(job.id!).toArray();
  const dims = new Set(job.selected_dimensions);
  const rows = new Set<number>();
  for (const a of annos) {
    if (dims.has(a.dimension_name) && a.value !== "") rows.add(a.row_index);
  }
  return { annotated: rows.size, pending: Math.max(0, job.total_rows - rows.size) };
}

async function jobToOut(job: LocalAnnoJob) {
  const { annotated, pending } = await jobProgress(job);
  return {
    id: job.id!,
    name: job.name,
    template_id: job.template_id,
    source_filename: job.source_filename,
    total_rows: job.total_rows,
    selected_dimensions: job.selected_dimensions || [],
    column_mapping: job.column_mapping || {},
    annotated_rows: annotated,
    pending_rows: pending,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

route("post", /^\/anno\/jobs$/, async ({ body }) => {
  const tpl = await db.annoTemplates.get(body.template_id);
  if (!tpl) throw new HttpError(404, "template not found");
  const src = await db.annoSources.get(body.source_path);
  if (!src) throw new HttpError(400, "source file not found, please re-upload");
  const rec: LocalAnnoJob = {
    name: body.name,
    template_id: body.template_id,
    source_filename: body.source_filename,
    source_columns: src.columns,
    source_data: src.data,
    total_rows: src.data.length,
    column_mapping: body.column_mapping || {},
    selected_dimensions: body.selected_dimensions || [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const id = await db.annoJobs.add(rec);
  await db.annoSources.delete(body.source_path);
  return jobToOut({ ...rec, id });
});

route("get", /^\/anno\/jobs$/, async () => {
  const all = await db.annoJobs.toArray();
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return Promise.all(all.map(jobToOut));
});

route("get", /^\/anno\/jobs\/(\d+)$/, async ({ m }) => {
  const job = await db.annoJobs.get(Number(m[1]));
  if (!job) throw new HttpError(404, "job not found");
  const out = await jobToOut(job);
  let template = null;
  try {
    template = await tplToOut(job.template_id);
  } catch {
    /* 模版被删则为 null */
  }
  return { ...out, source_columns: job.source_columns || [], template };
});

route("delete", /^\/anno\/jobs\/(\d+)$/, async ({ m }) => {
  const id = Number(m[1]);
  const job = await db.annoJobs.get(id);
  if (!job) throw new HttpError(404, "job not found");
  await db.annotations.where("job_id").equals(id).delete();
  await db.annoJobs.delete(id);
  return { ok: true };
});

// ---------------- 人工批注：行 ----------------

route("get", /^\/anno\/jobs\/(\d+)\/rows$/, async ({ m, params }) => {
  const job = await db.annoJobs.get(Number(m[1]));
  if (!job) throw new HttpError(404, "job not found");
  const status = params.status || "all";
  const tpl = await db.annoTemplates.get(job.template_id);
  const dataFields = tpl?.data_columns || [];
  const mapping = job.column_mapping || {};
  const dataFieldToCol: Record<string, string> = {};
  for (const f of dataFields) if (mapping[f]) dataFieldToCol[f] = mapping[f];

  const annos = await db.annotations.where("job_id").equals(job.id!).toArray();
  const dims = new Set(job.selected_dimensions || []);
  const annotatedRows = new Set<number>();
  for (const a of annos) {
    if (dims.has(a.dimension_name) && a.value !== "") annotatedRows.add(a.row_index);
  }

  const items: { row_index: number; annotated: boolean; preview: string }[] = [];
  for (let i = 0; i < job.source_data.length; i++) {
    const isAnnotated = annotatedRows.has(i);
    if (status === "annotated" && !isAnnotated) continue;
    if (status === "pending" && isAnnotated) continue;
    const row = job.source_data[i];
    const parts: string[] = [];
    for (const col of Object.values(dataFieldToCol)) {
      const v = String(row[col] ?? "").trim().replace(/\n/g, " ");
      if (v) {
        parts.push(v.slice(0, 40));
        if (parts.length >= 2) break;
      }
    }
    items.push({ row_index: i, annotated: isAnnotated, preview: parts.join(" · ") || "(空行)" });
  }
  return { total: items.length, items };
});

route("get", /^\/anno\/jobs\/(\d+)\/rows\/(\d+)$/, async ({ m }) => {
  const job = await db.annoJobs.get(Number(m[1]));
  if (!job) throw new HttpError(404, "job not found");
  const rowIndex = Number(m[2]);
  if (rowIndex < 0 || rowIndex >= job.source_data.length) throw new HttpError(404, "row out of range");
  const tpl = await db.annoTemplates.get(job.template_id);
  const dataFields = tpl?.data_columns || [];
  const mapping = job.column_mapping || {};
  const row = job.source_data[rowIndex];
  const data: Record<string, string> = {};
  for (const f of dataFields) {
    const col = mapping[f];
    data[f] = col && col in row ? String(row[col] ?? "") : "";
  }
  const annos = await db.annotations.where("[job_id+row_index]").equals([job.id!, rowIndex]).toArray();
  const annotations: Record<string, string> = {};
  for (const a of annos) annotations[a.dimension_name] = a.value;
  return { row_index: rowIndex, data, annotations };
});

route("put", /^\/anno\/jobs\/(\d+)\/rows\/(\d+)$/, async ({ m, body }) => {
  const job = await db.annoJobs.get(Number(m[1]));
  if (!job) throw new HttpError(404, "job not found");
  const rowIndex = Number(m[2]);
  if (rowIndex < 0 || rowIndex >= job.total_rows) throw new HttpError(404, "row out of range");
  const payload: Record<string, string> = body.annotations || {};
  for (const [dim, value] of Object.entries(payload)) {
    const existing = await db.annotations
      .where("[job_id+row_index+dimension_name]")
      .equals([job.id!, rowIndex, dim])
      .first();
    if (existing) await db.annotations.update(existing.id!, { value: value || "" });
    else
      await db.annotations.add({
        job_id: job.id!,
        row_index: rowIndex,
        dimension_name: dim,
        value: value || "",
      });
  }
  await db.annoJobs.update(job.id!, { updated_at: nowIso() });
  const { annotated, pending } = await jobProgress(job);
  return { ok: true, annotated_rows: annotated, pending_rows: pending };
});

// ---------------- 数据清洗 ----------------

function cleaningSourceOut(src: {
  source_id: string;
  filename: string;
  kind: "table" | "text";
  text: string;
  table: Row[];
  columns: string[];
  created_at?: string;
}) {
  return {
    source_id: src.source_id,
    filename: src.filename,
    kind: src.kind,
    columns: src.columns,
    total_rows: src.table.length,
    text: src.text,
    table: src.table,
    preview_text: src.text.slice(0, 5000),
    preview_table: src.table.slice(0, 50),
  };
}

route("post", /^\/cleaning\/upload$/, async ({ body }) => {
  const file = (body as FormData).get("file") as File | null;
  if (!file || !file.name) throw new HttpError(400, "missing filename");
  const ext = fileExt(file.name);
  const supported = [...TABLE_EXTS, ...TEXT_EXTS];
  if (!supported.includes(ext))
    throw new HttpError(400, `unsupported file type: ${ext}（纯前端模式暂不支持 .docx）`);

  let rec;
  try {
    if (TABLE_EXTS.includes(ext)) {
      const parsed = await parseTableFile(file);
      rec = {
        source_id: uuid(),
        filename: file.name,
        kind: "table" as const,
        text: "",
        table: parsed.rows,
        columns: parsed.columns,
        created_at: nowIso(),
      };
    } else {
      const text = await readTextFile(file);
      rec = {
        source_id: uuid(),
        filename: file.name,
        kind: "text" as const,
        text,
        table: [] as Row[],
        columns: [] as string[],
        created_at: nowIso(),
      };
    }
  } catch (e) {
    throw new HttpError(400, `解析失败: ${e}`);
  }
  await db.cleaningSources.add(rec);
  return cleaningSourceOut(rec);
});

route("post", /^\/cleaning\/from-dataset\/(\d+)$/, async ({ m }) => {
  const ds = await getDatasetOr404(Number(m[1]));
  const rec = {
    source_id: uuid(),
    filename: ds.name,
    kind: "table" as const,
    text: "",
    table: ds.data,
    columns: ds.columns,
    created_at: nowIso(),
  };
  await db.cleaningSources.add(rec);
  return cleaningSourceOut(rec);
});

route("get", /^\/cleaning\/preview\/([0-9a-f]+)$/, async ({ m }) => {
  const src = await db.cleaningSources.get(m[1]);
  if (!src) throw new HttpError(404, "source not found");
  return cleaningSourceOut(src);
});

route("post", /^\/cleaning\/run-script$/, async ({ body }) => {
  const src = await db.cleaningSources.get(body.source_id);
  if (!src) throw new HttpError(404, "source not found");
  return runCleaningScript({
    code: body.code,
    text: src.text || "",
    table: src.table || [],
    mode: body.input_mode,
    timeoutSec: body.timeout_sec,
  });
});

route("post", /^\/cleaning\/download$/, async ({ body }) => {
  const baseName = (String(body.filename || "cleaned").trim() || "cleaned")
    .replace(/[/\\]/g, "_")
    .slice(0, 80);
  if (body.output_kind === "table") {
    const rows = (body.output_table || []) as Row[];
    const blob = rowsToXlsxBlob(rows);
    return {
      data: blob,
      headers: {
        "content-disposition": `attachment; filename="${encodeURIComponent(baseName)}.xlsx"`,
      },
    };
  }
  const blob = new Blob([String(body.output_text || "")], { type: "text/plain;charset=utf-8" });
  return {
    data: blob,
    headers: {
      "content-disposition": `attachment; filename="${encodeURIComponent(baseName)}.txt"`,
    },
  };
});

route("get", /^\/cleaning\/script-templates$/, async () => {
  const all = await db.cleaningTemplates.toArray();
  all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return all;
});

route("post", /^\/cleaning\/script-templates$/, async ({ body }) => {
  const dupe = await db.cleaningTemplates.where("name").equals(body.name).first();
  if (dupe) throw new HttpError(409, `name already exists: ${body.name}`);
  const rec = {
    name: body.name,
    description: body.description || "",
    code: body.code,
    input_mode: body.input_mode || "text",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const id = await db.cleaningTemplates.add(rec);
  return { ...rec, id };
});

route("put", /^\/cleaning\/script-templates\/(\d+)$/, async ({ m, body }) => {
  const tpl = await db.cleaningTemplates.get(Number(m[1]));
  if (!tpl) throw new HttpError(404, "template not found");
  if (body.name && body.name !== tpl.name) {
    const dupe = await db.cleaningTemplates.where("name").equals(body.name).first();
    if (dupe) throw new HttpError(409, `name already exists: ${body.name}`);
  }
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  for (const k of ["name", "description", "code", "input_mode"]) {
    if (body[k] !== undefined && body[k] !== null) patch[k] = body[k];
  }
  await db.cleaningTemplates.update(tpl.id!, patch);
  return await db.cleaningTemplates.get(tpl.id!);
});

route("delete", /^\/cleaning\/script-templates\/(\d+)$/, async ({ m }) => {
  const tpl = await db.cleaningTemplates.get(Number(m[1]));
  if (!tpl) throw new HttpError(404, "template not found");
  await db.cleaningTemplates.delete(tpl.id!);
  return { ok: true };
});

// ---------------- adapter 入口 ----------------

function isHandlerResult(v: unknown): v is HandlerResult {
  return (
    !!v &&
    typeof v === "object" &&
    "data" in (v as object) &&
    ((v as HandlerResult).headers !== undefined || (v as HandlerResult).status !== undefined)
  );
}

export async function localAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await ensureSeeded();

  const method = (config.method || "get").toLowerCase();
  // url 可能含 query string；params 也可能单独传
  const rawUrl = config.url || "";
  const [pathPart, queryPart] = rawUrl.split("?");
  // baseURL="/api" 已从 url 中剥离（axios 不会拼接给 adapter？实际会拼接 full url），统一去前缀
  const path = pathPart.replace(/^\/api/, "") || "/";

  const params: Record<string, string> = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) params[k] = v;
  }
  if (config.params && typeof config.params === "object") {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) params[k] = String(v);
    }
  }

  let body: unknown = config.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      /* 保留原文 */
    }
  }

  const mk = (data: unknown, status = 200, headers: Record<string, string> = {}): AxiosResponse => ({
    data,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers,
    config,
    request: {},
  });

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.pattern);
    if (!m) continue;
    try {
      const result = await r.handler({ m, body, params, config });
      if (isHandlerResult(result)) {
        return mk(result.data, result.status ?? 200, result.headers ?? {});
      }
      return mk(result);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const detail = e instanceof Error ? e.message : String(e);
      const resp = mk({ detail }, status);
      throw new AxiosError(detail, String(status), config, {}, resp);
    }
  }

  const resp = mk({ detail: `Not Found: ${method.toUpperCase()} ${path}` }, 404);
  throw new AxiosError("Not Found", "404", config, {}, resp);
}
