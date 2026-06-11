import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 120_000,
});

// 统一异常增强：
// - 401（未登录/会话过期）统一跳转登录页（登录接口本身除外，避免循环）
// - 413（Request Entity Too Large）给出明确文案，
//   这通常由 Nginx / 网关 client_max_body_size 限制触发，而非业务逻辑。
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status;
    const reqUrl: string = error?.config?.url || "";
    if (
      status === 401 &&
      !reqUrl.includes("/auth/login") &&
      window.location.pathname !== "/login"
    ) {
      const next = window.location.pathname + window.location.search;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
    }
    if (status === 413) {
      const friendly =
        "请求体过大被网关拦截（HTTP 413）。请联系管理员调高反向代理的 client_max_body_size，或减小本次上传文件 / 数据量后重试。";
      error.message = friendly;
      if (error.response) {
        error.response.data = { detail: friendly };
      }
    }
    return Promise.reject(error);
  }
);

// ---------------- 账号与登录 ----------------

export type CurrentUser = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type LoginRecordOut = {
  id: number;
  user_id: number | null;
  username: string;
  success: boolean;
  ip: string;
  user_agent: string;
  login_at: string;
};

export type LoginRecordsPage = {
  total: number;
  items: LoginRecordOut[];
};

export type UserDataStats = {
  user: CurrentUser;
  dataset_count: number;
  task_count: number;
  anno_job_count: number;
  login_count: number;
};

export const authApi = {
  async login(username: string, password: string): Promise<CurrentUser> {
    return (await api.post<CurrentUser>("/auth/login", { username, password })).data;
  },
  async logout(): Promise<void> {
    await api.post("/auth/logout");
  },
  async me(): Promise<CurrentUser> {
    return (await api.get<CurrentUser>("/auth/me")).data;
  },
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.post("/auth/change-password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },
};

export const adminApi = {
  async listUsers(): Promise<CurrentUser[]> {
    return (await api.get<CurrentUser[]>("/admin/users")).data;
  },
  async createUser(payload: {
    username: string;
    password: string;
    display_name?: string;
    role?: "admin" | "user";
  }): Promise<CurrentUser> {
    return (await api.post<CurrentUser>("/admin/users", payload)).data;
  },
  async updateUser(
    id: number,
    payload: {
      display_name?: string;
      password?: string;
      is_active?: boolean;
      role?: "admin" | "user";
    }
  ): Promise<CurrentUser> {
    return (await api.put<CurrentUser>(`/admin/users/${id}`, payload)).data;
  },
  async deleteUser(id: number): Promise<void> {
    await api.delete(`/admin/users/${id}`);
  },
  async loginRecords(params: {
    user_id?: number;
    offset?: number;
    limit?: number;
  }): Promise<LoginRecordsPage> {
    return (await api.get<LoginRecordsPage>("/admin/login-records", { params })).data;
  },
  async overview(): Promise<UserDataStats[]> {
    return (await api.get<UserDataStats[]>("/admin/overview")).data;
  },
  async userData(id: number): Promise<{
    user: CurrentUser;
    datasets: DatasetOut[];
    tasks: TaskOut[];
    anno_jobs: AnnoJob[];
  }> {
    return (await api.get(`/admin/users/${id}/data`)).data;
  },
};

export type DatasetOut = {
  id: number;
  name: string;
  filename: string;
  rows: number;
  columns: string[];
  created_at: string;
};

export type DatasetDetail = DatasetOut & {
  preview: Record<string, unknown>[];
};

export type TaskOut = {
  id: number;
  dataset_id: number;
  name: string;
  model: string;
  prompt_template: string;
  json_schema: string;
  temperature: number;
  status: "pending" | "running" | "done" | "failed" | "stopping" | "stopped";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  error: string;
  created_at: string;
  finished_at: string | null;
};

export type ResultOut = {
  id: number;
  task_id: number;
  row_index: number;
  input_json: Record<string, unknown>;
  raw_output: string;
  parsed_json: Record<string, unknown> | null;
  parse_ok: boolean;
  status: "pending" | "success" | "parse_error" | "failed" | "stopped";
  error: string;
  latency_ms: number;
};

export type ResultsPage = {
  total: number;
  items: ResultOut[];
  parsed_keys: string[];
};

export type PromptTemplate = {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  prompt_template: string;
  json_schema: string;
  default_model: string;
  default_temperature: number;
  created_at: string;
  updated_at: string;
};

export type PromptTemplateInput = Omit<PromptTemplate, "id" | "created_at" | "updated_at">;

// ---------------- 人工批注 ----------------

export type DimensionConfig = {
  dimension_name: string;
  input_type: "options" | "text";
  select_mode: "single" | "multi" | null;
  options_text: string;
};

export type AnnotationTemplate = {
  id: number;
  name: string;
  description: string;
  data_columns: string[];
  annotation_columns: string[];
  created_at: string;
  updated_at: string;
  dimensions: DimensionConfig[];
};

export type AnnotationTemplateInput = {
  name: string;
  description?: string;
  data_columns: string[];
  annotation_columns: string[];
};

export type UploadParseResponse = {
  source_path: string;
  source_filename: string;
  columns: string[];
  total_rows: number;
  suggested_mapping: Record<string, string>;
  empty_columns: string[];
};

export type AnnoJob = {
  id: number;
  name: string;
  template_id: number;
  source_filename: string;
  total_rows: number;
  selected_dimensions: string[];
  column_mapping: Record<string, string>;
  annotated_rows: number;
  pending_rows: number;
  created_at: string;
  updated_at: string;
};

export type AnnoJobDetail = AnnoJob & {
  source_columns: string[];
  template: AnnotationTemplate | null;
};

export type AnnoRowSummary = {
  row_index: number;
  annotated: boolean;
  preview: string;
};

export type AnnoRowsResponse = {
  total: number;
  items: AnnoRowSummary[];
};

export type AnnoRowDetail = {
  row_index: number;
  data: Record<string, string>;
  annotations: Record<string, string>;
};

// ---------------- 数据/知识清洗 ----------------

export type CleaningSource = {
  source_id: string;
  filename: string;
  kind: "table" | "text";
  columns: string[];
  total_rows: number;
  text: string;
  table: Record<string, unknown>[];
  preview_text: string;
  preview_table: Record<string, unknown>[];
};

export type CleaningRunResult = {
  ok: boolean;
  output_kind: "table" | "text";
  output_text: string;
  output_table: Record<string, unknown>[] | null;
  stdout: string;
  stderr: string;
  error: string;
  duration_ms: number;
};

export type CleaningScriptTemplate = {
  id: number;
  name: string;
  description: string;
  code: string;
  input_mode: "text" | "table";
  created_at: string;
  updated_at: string;
};

export type CleaningScriptTemplateInput = Omit<
  CleaningScriptTemplate,
  "id" | "created_at" | "updated_at"
>;

export const cleaningApi = {
  async upload(file: File): Promise<CleaningSource> {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post<CleaningSource>("/cleaning/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  async preview(sourceId: string): Promise<CleaningSource> {
    return (await api.get<CleaningSource>(`/cleaning/preview/${sourceId}`)).data;
  },
  async runScript(req: {
    source_id: string;
    code: string;
    input_mode: "text" | "table";
    timeout_sec?: number;
  }): Promise<CleaningRunResult> {
    return (await api.post<CleaningRunResult>("/cleaning/run-script", req)).data;
  },
  async download(req: {
    output_kind: "text" | "table";
    output_text?: string | null;
    output_table?: Record<string, unknown>[] | null;
    filename?: string;
  }): Promise<{ blob: Blob; filename: string }> {
    const resp = await api.post("/cleaning/download", req, { responseType: "blob" });
    const cd = resp.headers["content-disposition"] || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const filename = m ? decodeURIComponent(m[1]) : req.filename || "cleaned";
    return { blob: resp.data as Blob, filename };
  },
  async listTemplates(): Promise<CleaningScriptTemplate[]> {
    return (await api.get<CleaningScriptTemplate[]>("/cleaning/script-templates")).data;
  },
  async createTemplate(payload: CleaningScriptTemplateInput): Promise<CleaningScriptTemplate> {
    return (await api.post<CleaningScriptTemplate>("/cleaning/script-templates", payload)).data;
  },
  async updateTemplate(
    id: number,
    payload: Partial<CleaningScriptTemplateInput>
  ): Promise<CleaningScriptTemplate> {
    return (await api.put<CleaningScriptTemplate>(`/cleaning/script-templates/${id}`, payload)).data;
  },
  async deleteTemplate(id: number): Promise<void> {
    await api.delete(`/cleaning/script-templates/${id}`);
  },
  async fromDataset(datasetId: number): Promise<CleaningSource> {
    return (await api.post<CleaningSource>(`/cleaning/from-dataset/${datasetId}`)).data;
  },
};

export const datasetsApi = {
  async list(): Promise<DatasetOut[]> {
    return (await api.get<DatasetOut[]>("/datasets")).data;
  },
  async get(id: number): Promise<DatasetDetail> {
    return (await api.get<DatasetDetail>(`/datasets/${id}`)).data;
  },
  async upload(file: File): Promise<DatasetDetail> {
    const fd = new FormData();
    fd.append("file", file);
    return (
      await api.post<DatasetDetail>("/datasets", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    ).data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/datasets/${id}`);
  },
  async download(id: number, filename: string): Promise<void> {
    const resp = await api.get(`/datasets/${id}/download`, { responseType: "blob" });
    const blob = resp.data as Blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  async replace(
    id: number,
    payload: { rows: Record<string, unknown>[]; name?: string | null }
  ): Promise<DatasetDetail> {
    return (await api.put<DatasetDetail>(`/datasets/${id}/replace`, payload)).data;
  },
  async createFromCleaning(payload: {
    name: string;
    rows: Record<string, unknown>[];
  }): Promise<DatasetDetail> {
    return (await api.post<DatasetDetail>(`/datasets/from-cleaning`, payload)).data;
  },
};

export const taskApi = {
  async stop(taskId: number): Promise<TaskOut> {
    return (await api.post<TaskOut>(`/tasks/${taskId}/stop`)).data;
  },
};

const API_KEY_STORAGE = "llm_gw_api_key";

export const apiKeyStore = {
  get(): string {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  },
  set(v: string) {
    if (v) localStorage.setItem(API_KEY_STORAGE, v);
    else localStorage.removeItem(API_KEY_STORAGE);
  },
};
