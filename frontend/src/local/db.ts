/**
 * 浏览器本地数据层（IndexedDB / Dexie）。
 *
 * 纯前端模式下，原后端 SQLite 的所有表迁移到浏览器：
 * 数据只存在使用者自己的浏览器里，互不可见。
 */

import Dexie, { Table } from "dexie";

export type Row = Record<string, string>;

export interface LocalDataset {
  id?: number;
  name: string;
  filename: string;
  rows: number;
  columns: string[];
  data: Row[]; // 全量行数据
  created_at: string;
}

export interface LocalTask {
  id?: number;
  dataset_id: number;
  name: string;
  model: string;
  prompt_template: string;
  json_schema: string;
  temperature: number;
  status: string; // pending/running/done/failed/stopping/stopped
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  error: string;
  created_at: string;
  finished_at: string | null;
}

export interface LocalResult {
  id?: number;
  task_id: number;
  row_index: number;
  input_json: Row;
  raw_output: string;
  parsed_json: Record<string, unknown> | null;
  parse_ok: boolean;
  status: string; // pending/success/parse_error/failed/stopped
  error: string;
  latency_ms: number;
}

export interface LocalPrompt {
  id?: number;
  name: string;
  description: string;
  system_prompt: string;
  prompt_template: string;
  json_schema: string;
  default_model: string;
  default_temperature: number;
  created_at: string;
  updated_at: string;
}

export interface LocalAnnoTemplate {
  id?: number;
  name: string;
  description: string;
  data_columns: string[];
  annotation_columns: string[];
  created_at: string;
  updated_at: string;
}

export interface LocalAnnoDim {
  id?: number;
  template_id: number;
  dimension_name: string;
  input_type: "options" | "text";
  select_mode: "single" | "multi" | null;
  options_text: string;
}

export interface LocalAnnoJob {
  id?: number;
  name: string;
  template_id: number;
  source_filename: string;
  source_columns: string[];
  source_data: Row[]; // 源表全量数据
  total_rows: number;
  column_mapping: Record<string, string>;
  selected_dimensions: string[];
  created_at: string;
  updated_at: string;
}

export interface LocalAnnotation {
  id?: number;
  job_id: number;
  row_index: number;
  dimension_name: string;
  value: string;
}

/** 批注新建流程中"已上传待确认"的临时源数据 */
export interface LocalAnnoSource {
  source_path: string; // uuid
  source_filename: string;
  columns: string[];
  data: Row[];
  created_at: string;
}

export interface LocalCleaningSource {
  source_id: string;
  filename: string;
  kind: "table" | "text";
  text: string;
  table: Row[];
  columns: string[];
  created_at: string;
}

export interface LocalCleaningTemplate {
  id?: number;
  name: string;
  description: string;
  code: string;
  input_mode: "text" | "table";
  created_at: string;
  updated_at: string;
}

class EvalDB extends Dexie {
  datasets!: Table<LocalDataset, number>;
  tasks!: Table<LocalTask, number>;
  results!: Table<LocalResult, number>;
  prompts!: Table<LocalPrompt, number>;
  annoTemplates!: Table<LocalAnnoTemplate, number>;
  annoDims!: Table<LocalAnnoDim, number>;
  annoJobs!: Table<LocalAnnoJob, number>;
  annotations!: Table<LocalAnnotation, number>;
  annoSources!: Table<LocalAnnoSource, string>;
  cleaningSources!: Table<LocalCleaningSource, string>;
  cleaningTemplates!: Table<LocalCleaningTemplate, number>;

  constructor() {
    super("eval-platform");
    this.version(1).stores({
      datasets: "++id, name, created_at",
      tasks: "++id, dataset_id, status, created_at",
      results: "++id, task_id, [task_id+row_index], status",
      prompts: "++id, &name, updated_at",
      annoTemplates: "++id, &name, updated_at",
      annoDims: "++id, template_id, [template_id+dimension_name]",
      annoJobs: "++id, template_id, created_at",
      annotations: "++id, job_id, [job_id+row_index], [job_id+row_index+dimension_name]",
      annoSources: "source_path, created_at",
      cleaningSources: "source_id, created_at",
      cleaningTemplates: "++id, &name, updated_at",
    });
  }
}

export const db = new EvalDB();

export function nowIso(): string {
  // 与原后端一致：存 UTC 时间（前端 fmtTime 会补 "Z" 再本地化显示）
  return new Date().toISOString().replace(/Z$/, "").replace(/\.\d+$/, "");
}

let seeded = false;

/** 首次使用时种入默认批注模版（与原后端 _seed_default_annotation_template 一致）。 */
export async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;
  const count = await db.annoTemplates.count();
  if (count > 0) return;
  await db.annoTemplates.add({
    name: "东东客服助手复用适配评测",
    description: "默认内置模版：客服助手评测",
    data_columns: ["query", "上文QA", "agent response", "场景", "会话id", "消息id", "意图", "子意图"],
    annotation_columns: ["P0问题类型", "P1问题类型", "是否需复核", "问题现象描述", "修改建议", "备注"],
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}
