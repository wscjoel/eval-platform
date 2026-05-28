import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  apiKeyStore,
  DatasetDetail,
  PromptTemplate,
  ResultsPage,
  TaskOut,
} from "../api/client";
import { IconArrowLeft, IconPlay, IconRefresh, IconUpload, IconX } from "../components/Icon";
import { PromptEditor } from "../components/PromptEditor";
import { StatusBadge } from "../components/StatusBadge";

// ---------------- Types ----------------

type SideMode = "results" | "rerun_task" | "upload";

type RowResult = {
  row_index: number;
  input: Record<string, unknown>;
  raw_output: string;
  parsed_json: Record<string, unknown> | null;
  parse_ok: boolean;
  status: string;
  error: string;
  latency_ms: number;
};

type SideState = {
  label: "A" | "B";
  mode: SideMode;
  prompt: string;
  model: string;
  temperature: number;
  selectedTplId: string;
  taskId: number | null;
  uploadedDs: DatasetDetail | null;
  running: boolean;
  progress: number;
  rows: RowResult[];
  error: string;
};

function emptySide(label: "A" | "B"): SideState {
  return {
    label,
    mode: "rerun_task",
    prompt: "",
    model: "",
    temperature: 0.2,
    selectedTplId: "",
    taskId: null,
    uploadedDs: null,
    running: false,
    progress: 0,
    rows: [],
    error: "",
  };
}

function mergePrompt(system: string, user: string): string {
  const s = (system || "").trim();
  const u = (user || "").trim();
  if (s && u) return `# System\n${s}\n\n# User\n${u}`;
  if (s) return `# System\n${s}`;
  return u;
}

// ---------------- Page ----------------

export function PromptCompare() {
  const [N, setN] = useState(5);
  const [A, setA] = useState<SideState>(emptySide("A"));
  const [B, setB] = useState<SideState>(emptySide("B"));
  const [cell, setCell] = useState<{ title: string; value: string } | null>(null);

  useEffect(() => {
    if (!cell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCell(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cell]);

  // shared queries
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await api.get<{ models: string[] }>("/models")).data.models,
  });
  const tpls = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => (await api.get<PromptTemplate[]>("/prompts")).data,
  });
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => (await api.get<TaskOut[]>("/tasks")).data,
  });

  const canRun =
    !A.running &&
    !B.running &&
    N >= 1 &&
    sideReady(A) &&
    sideReady(B);

  const reset = () => {
    setA(emptySide("A"));
    setB(emptySide("B"));
  };

  const runAll = async () => {
    const apiKey = apiKeyStore.get();
    // Clear previous rows
    setA((s) => ({ ...s, running: true, progress: 0, rows: [], error: "" }));
    setB((s) => ({ ...s, running: true, progress: 0, rows: [], error: "" }));
    await Promise.all([
      runSide(A, N, apiKey, tasks.data || [], (u) => setA((s) => ({ ...s, ...u }))),
      runSide(B, N, apiKey, tasks.data || [], (u) => setB((s) => ({ ...s, ...u }))),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/prompts" className="btn-ghost !px-1.5 !py-1 text-ink-500" title="返回提示词管理">
              <IconArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">提示词对比</h1>
          </div>
          <p className="text-sm text-ink-500 mt-1">
            为左右两侧分别配置提示词与数据来源，按行对齐展示输出差异（结果仅当前会话保留，不入库）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-ink-500">重跑行数</span>
            <NumberField
              value={N}
              onChange={setN}
              min={1}
              max={500}
              fallback={1}
              className="input !w-20 !py-1 text-center tabular-nums"
              title="对每侧前 N 行执行（≤ 数据集行数）"
            />
          </div>
          <button
            className="btn-ghost border border-ink-200"
            onClick={reset}
            disabled={A.running || B.running}
            title="清空两侧配置与结果"
          >
            清空
          </button>
          <button
            className="btn-accent disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={runAll}
            disabled={!canRun}
            title={canRun ? "开始对比" : "请先完成两侧的提示词与数据来源配置"}
          >
            {A.running || B.running ? (
              <>
                <IconRefresh className="w-4 h-4 animate-spin" />
                对比中…
              </>
            ) : (
              <>
                <IconPlay className="w-4 h-4" />
                开始对比
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SideCard
          side={A}
          setSide={setA}
          models={models.data || []}
          tpls={tpls.data || []}
          tasks={tasks.data || []}
          N={N}
        />
        <SideCard
          side={B}
          setSide={setB}
          models={models.data || []}
          tpls={tpls.data || []}
          tasks={tasks.data || []}
          N={N}
        />
      </div>

      <ResultsTable A={A} B={B} N={N} onOpenCell={setCell} />

      {cell && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCell(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-soft border border-ink-200 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200">
              <div className="text-sm font-semibold text-ink-900 truncate pr-3">{cell.title}</div>
              <button
                type="button"
                className="text-ink-500 hover:text-ink-900 cursor-pointer transition-colors shrink-0"
                onClick={() => setCell(null)}
                aria-label="关闭"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3 overflow-auto text-[12px] text-ink-800 whitespace-pre-wrap break-all">
              {cell.value || <span className="text-ink-400">（空）</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function sideReady(s: SideState): boolean {
  if (s.mode === "results") {
    return s.taskId != null;
  }
  if (s.mode === "rerun_task") {
    return s.taskId != null && !!s.prompt.trim() && !!s.model;
  }
  // upload
  return s.uploadedDs != null && !!s.prompt.trim() && !!s.model;
}

// ---------------- Side Card ----------------

function SideCard(props: {
  side: SideState;
  setSide: (u: SideState | ((s: SideState) => SideState)) => void;
  models: string[];
  tpls: PromptTemplate[];
  tasks: TaskOut[];
  N: number;
}) {
  const { side, setSide, models, tpls, tasks, N } = props;
  const [showSave, setShowSave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post<DatasetDetail>("/datasets", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return r.data;
    },
    onSuccess: (ds) => setSide((s) => ({ ...s, uploadedDs: ds })),
  });

  // when picking results mode + task, prefill prompt/model/temp (readonly)
  const onPickTask = async (taskId: number, mode: SideMode) => {
    setSide((s) => ({ ...s, taskId, error: "" }));
    if (mode === "results" || mode === "rerun_task") {
      try {
        const t = (await api.get<TaskOut>(`/tasks/${taskId}`)).data;
        if (mode === "results") {
          setSide((s) => ({
            ...s,
            prompt: t.prompt_template,
            model: t.model,
            temperature: t.temperature,
            selectedTplId: "",
          }));
        } else {
          setSide((s) => ({
            ...s,
            // only auto-fill when current is empty, so user can iterate
            prompt: s.prompt.trim() ? s.prompt : t.prompt_template,
            model: s.model || t.model,
            temperature: s.temperature,
            selectedTplId: "",
          }));
        }
      } catch {
        /* ignore */
      }
    }
  };

  const applyTemplate = (id: string) => {
    setSide((s) => ({ ...s, selectedTplId: id }));
    if (!id) return;
    const t = tpls.find((p) => String(p.id) === id);
    if (!t) return;
    setSide((s) => ({
      ...s,
      prompt: mergePrompt(t.system_prompt, t.prompt_template),
      model: t.default_model && models.includes(t.default_model) ? t.default_model : s.model,
      temperature: typeof t.default_temperature === "number" ? t.default_temperature : s.temperature,
    }));
  };

  const setMode = (mode: SideMode) => {
    setSide((s) => ({
      ...s,
      mode,
      // clear cross-mode selections (but keep prompt/model for user convenience)
      taskId: null,
      uploadedDs: null,
      rows: [],
      progress: 0,
      error: "",
    }));
  };

  const readonlyPrompt = side.mode === "results";
  const accent = side.label === "A" ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-800";

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${accent}`}>
            {side.label}
          </span>
          <span className="text-sm font-semibold text-ink-900">提示词 {side.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input !py-1 !text-xs w-44"
            value={side.selectedTplId}
            onChange={(e) => applyTemplate(e.target.value)}
            title="从模板库选用"
            disabled={readonlyPrompt}
          >
            <option value="">从模板库选用…</option>
            {tpls.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost border border-ink-200 !py-1 !text-xs"
            onClick={() => setShowSave(true)}
            disabled={!side.prompt.trim() || readonlyPrompt}
            title="把当前配置保存到模板库"
          >
            保存为模板
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">模型</label>
          <select
            className="input !py-1.5"
            value={side.model}
            onChange={(e) => setSide((s) => ({ ...s, model: e.target.value }))}
            disabled={readonlyPrompt}
          >
            <option value="">请选择…</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Temperature</label>
          <NumberField
            value={side.temperature}
            onChange={(n) => setSide((s) => ({ ...s, temperature: n }))}
            min={0}
            max={2}
            step={0.1}
            fallback={0.2}
            disabled={readonlyPrompt}
            className="input !py-1.5"
          />
        </div>
      </div>

      <div>
        <label className="label">
          提示词模板（用 <code className="px-1 py-0.5 bg-ink-100 rounded text-ink-900">{"{{列名}}"}</code> 引用列）
          {readonlyPrompt && (
            <span className="ml-2 text-[10px] font-normal text-ink-500 normal-case">
              · 已锁定为任务原配置
            </span>
          )}
        </label>
        <textarea
          className="input font-mono text-[13px] disabled:bg-ink-50 disabled:text-ink-700"
          rows={6}
          value={side.prompt}
          onChange={(e) => setSide((s) => ({ ...s, prompt: e.target.value }))}
          placeholder={"请评测以下商品标题与描述：\n标题：{{title}}\n描述：{{description}}"}
          disabled={readonlyPrompt}
        />
      </div>

      <div className="border-t border-ink-200 pt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-700">数据来源</div>

        <div className="space-y-2">
          <ModeRadio
            checked={side.mode === "results"}
            onChange={() => setMode("results")}
            label="复用已有任务结果"
            hint="选择已完成的任务，直接展示其已有输出（不重跑）"
          />
          <ModeRadio
            checked={side.mode === "rerun_task"}
            onChange={() => setMode("rerun_task")}
            label="复用任务的数据集 + 重跑"
            hint="使用上述提示词在该任务的数据集上重新跑前 N 行"
          />
          <ModeRadio
            checked={side.mode === "upload"}
            onChange={() => setMode("upload")}
            label="上传新数据 + 重跑"
            hint="上传 Excel/CSV，使用上述提示词跑前 N 行"
          />
        </div>

        {(side.mode === "results" || side.mode === "rerun_task") && (
          <div>
            <label className="label">选择评测任务</label>
            <select
              className="input !py-1.5"
              value={side.taskId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  setSide((s) => ({ ...s, taskId: null }));
                  return;
                }
                onPickTask(parseInt(v, 10), side.mode);
              }}
            >
              <option value="">请选择…</option>
              {tasks
                .filter((t) => (side.mode === "results" ? t.status === "done" : true))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.id} · {t.name} · {t.model} ({t.status})
                  </option>
                ))}
            </select>
            {side.mode === "results" && (
              <div className="text-[11px] text-ink-500 mt-1">
                只显示状态为 “已完成” 的任务
              </div>
            )}
          </div>
        )}

        {side.mode === "upload" && (
          <div>
            <label className="label">上传数据</label>
            {side.uploadedDs ? (
              <div className="flex items-center justify-between bg-ink-50 border border-ink-200 rounded px-3 py-2 text-xs">
                <div className="truncate pr-2">
                  <div className="text-ink-900 font-medium truncate">{side.uploadedDs.name}</div>
                  <div className="text-ink-500 mt-0.5">
                    {side.uploadedDs.rows} 行 · {side.uploadedDs.columns.length} 列
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 !text-xs text-ink-500 hover:text-danger shrink-0"
                  onClick={() => setSide((s) => ({ ...s, uploadedDs: null }))}
                >
                  移除
                </button>
              </div>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) upload.mutate(f);
                }}
                className={`flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed rounded cursor-pointer transition-colors ${
                  drag ? "border-accent bg-amber-50/40" : "border-ink-200 hover:border-ink-700 hover:bg-ink-50"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                  }}
                />
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-ink-100 text-ink-700">
                  <IconUpload className="w-4 h-4" />
                </span>
                <div className="text-xs text-ink-700">
                  {upload.isPending ? "解析中…" : "点击或拖拽 .xlsx / .xls / .csv"}
                </div>
              </label>
            )}
            {upload.isError && (
              <div className="text-xs text-danger mt-1">
                上传失败：{(upload.error as any)?.response?.data?.detail || String(upload.error)}
              </div>
            )}
          </div>
        )}

        {/* Progress / row count hint */}
        <RowCountHint side={side} N={N} tasks={tasks} />

        {side.running && (
          <div className="flex items-center gap-2 text-xs text-ink-700">
            <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-ink-900 transition-all duration-300"
                style={{ width: `${N === 0 ? 0 : Math.round((side.progress / N) * 100)}%` }}
              />
            </div>
            <span className="tabular-nums w-14 text-right">{side.progress}/{N}</span>
          </div>
        )}

        {side.error && <div className="text-xs text-danger">{side.error}</div>}
      </div>

      <PromptEditor
        open={showSave}
        onClose={() => setShowSave(false)}
        initial={{
          name: `提示词${side.label}`,
          prompt_template: side.prompt,
          json_schema: "",
          default_model: side.model,
          default_temperature: side.temperature,
        }}
      />
    </div>
  );
}

function NumberField(props: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  fallback?: number;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const { value, onChange, min, max, step = 1, fallback, className, title, disabled } = props;
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    if (draft === "" || draft === "-" || draft.endsWith(".") || Number(draft) !== value) {
      setDraft(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    if (draft === "" || draft === "-" || Number.isNaN(Number(draft))) {
      const f = fallback ?? min ?? 0;
      setDraft(String(f));
      onChange(f);
      return;
    }
    let n = Number(draft);
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    setDraft(String(n));
    onChange(n);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      title={title}
      className={className}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v === "" || v === "-" || v.endsWith(".")) return;
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(n);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ModeRadio(props: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="radio"
        className="mt-1 accent-ink-900 cursor-pointer"
        checked={props.checked}
        onChange={props.onChange}
      />
      <div className="flex-1">
        <div className="text-sm text-ink-900 group-hover:text-ink-700 transition-colors">{props.label}</div>
        <div className="text-[11px] text-ink-500">{props.hint}</div>
      </div>
    </label>
  );
}

function RowCountHint({ side, N, tasks }: { side: SideState; N: number; tasks: TaskOut[] }) {
  let total: number | null = null;
  if (side.mode === "upload" && side.uploadedDs) {
    total = side.uploadedDs.rows;
  } else if ((side.mode === "results" || side.mode === "rerun_task") && side.taskId != null) {
    const t = tasks.find((x) => x.id === side.taskId);
    total = t?.total ?? null;
  }
  if (total == null) return null;
  const ok = N <= total;
  return (
    <div className={`text-[11px] ${ok ? "text-ink-500" : "text-danger"}`}>
      数据集共 <span className="font-medium text-ink-700">{total}</span> 行
      {!ok && <span> · 行数 N 已超出，将自动按可用行执行</span>}
    </div>
  );
}

// ---------------- Runner ----------------

async function runSide(
  side: SideState,
  N: number,
  apiKey: string,
  tasks: TaskOut[],
  update: (u: Partial<SideState>) => void,
) {
  try {
    if (side.mode === "results") {
      if (side.taskId == null) throw new Error("未选择任务");
      const r = await api.get<ResultsPage>(`/tasks/${side.taskId}/results?limit=${N}`);
      const rows: RowResult[] = r.data.items.map((it) => ({
        row_index: it.row_index,
        input: it.input_json,
        raw_output: it.raw_output,
        parsed_json: it.parsed_json,
        parse_ok: it.parse_ok,
        status: it.status,
        error: it.error,
        latency_ms: it.latency_ms,
      }));
      update({ rows, progress: rows.length, running: false });
      return;
    }

    // Re-run modes
    let dsId: number;
    let preview: Record<string, unknown>[];
    if (side.mode === "upload") {
      if (!side.uploadedDs) throw new Error("未上传数据");
      dsId = side.uploadedDs.id;
      preview = side.uploadedDs.preview;
    } else {
      if (side.taskId == null) throw new Error("未选择任务");
      const t = (await api.get<TaskOut>(`/tasks/${side.taskId}`)).data;
      dsId = t.dataset_id;
      const ds = (await api.get<DatasetDetail>(`/datasets/${dsId}`)).data;
      preview = ds.preview;
    }

    const actualN = Math.min(N, preview.length);
    const collected: RowResult[] = [];
    for (let i = 0; i < actualN; i++) {
      try {
        const r = await api.post("/tasks/trial", {
          dataset_id: dsId,
          model: side.model,
          prompt_template: side.prompt,
          json_schema: "",
          temperature: side.temperature,
          row_index: i,
          api_key: apiKey || null,
        });
        const d = r.data as {
          raw_output: string;
          parsed_json: Record<string, unknown> | null;
          parse_ok: boolean;
          error: string;
          latency_ms: number;
        };
        collected.push({
          row_index: i,
          input: preview[i] || {},
          raw_output: d.raw_output,
          parsed_json: d.parsed_json,
          parse_ok: d.parse_ok,
          status: d.parse_ok ? "success" : d.error ? "failed" : "parse_error",
          error: d.error,
          latency_ms: d.latency_ms,
        });
      } catch (e: any) {
        collected.push({
          row_index: i,
          input: preview[i] || {},
          raw_output: "",
          parsed_json: null,
          parse_ok: false,
          status: "failed",
          error: e?.response?.data?.detail || String(e),
          latency_ms: 0,
        });
      }
      update({ rows: [...collected], progress: collected.length });
    }
    update({ running: false });
  } catch (e: any) {
    update({
      running: false,
      error: e?.response?.data?.detail || (e as Error).message || String(e),
    });
  }
}

// ---------------- Results Table ----------------

function ResultsTable({
  A,
  B,
  N,
  onOpenCell,
}: {
  A: SideState;
  B: SideState;
  N: number;
  onOpenCell: (c: { title: string; value: string }) => void;
}) {
  const hasData = A.rows.length > 0 || B.rows.length > 0;
  const maxLen = Math.max(A.rows.length, B.rows.length, hasData ? 0 : 0);

  const merged = useMemo(() => {
    const out: Array<{ row_index: number; a: RowResult | null; b: RowResult | null; input: Record<string, unknown> }> = [];
    for (let i = 0; i < maxLen; i++) {
      const a = A.rows[i] || null;
      const b = B.rows[i] || null;
      out.push({
        row_index: a?.row_index ?? b?.row_index ?? i,
        a,
        b,
        input: (a?.input && Object.keys(a.input).length ? a.input : b?.input) || {},
      });
    }
    return out;
  }, [A.rows, B.rows, maxLen]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200 bg-ink-50">
        <div className="text-sm font-semibold text-ink-900">对比结果</div>
        <div className="text-xs text-ink-500">
          A: {A.rows.length} 行 · B: {B.rows.length} 行 · 计划 {N} 行/侧
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-white text-ink-700 text-left border-b border-ink-200">
            <tr>
              <th className="px-3 py-2 font-medium w-10 align-bottom">#</th>
              <th className="px-3 py-2 font-medium align-bottom">输入</th>
              <th className="px-3 py-2 font-medium w-[36%] align-bottom">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">A</span>
                  输出
                </span>
              </th>
              <th className="px-3 py-2 font-medium w-[36%] align-bottom">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-violet-100 text-violet-800">B</span>
                  输出
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!hasData && (
              <tr>
                <td colSpan={4} className="px-4 py-16 text-center text-ink-500">
                  暂无对比结果。完成两侧配置后点击右上角「开始对比」。
                </td>
              </tr>
            )}
            {merged.map((row, i) => (
              <tr key={i} className="border-t border-ink-200 align-top hover:bg-ink-50/40 transition-colors">
                <td className="px-3 py-2 text-ink-400 tabular-nums">{row.row_index + 1}</td>
                <td className="px-3 py-2 max-w-0">
                  <InputCell input={row.input} onOpen={(v) => onOpenCell({ title: `第 ${row.row_index + 1} 行 · 输入`, value: v })} />
                </td>
                <td className="px-3 py-2 max-w-0">
                  <OutputCell
                    row={row.a}
                    onOpen={(v) => onOpenCell({ title: `第 ${row.row_index + 1} 行 · A 输出`, value: v })}
                  />
                </td>
                <td className="px-3 py-2 max-w-0">
                  <OutputCell
                    row={row.b}
                    onOpen={(v) => onOpenCell({ title: `第 ${row.row_index + 1} 行 · B 输出`, value: v })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InputCell({
  input,
  onOpen,
}: {
  input: Record<string, unknown>;
  onOpen: (v: string) => void;
}) {
  const text = Object.entries(input)
    .map(([k, v]) => `${k}: ${String(v ?? "")}`)
    .join("\n");
  if (!text) return <span className="text-ink-300">—</span>;
  return (
    <button
      type="button"
      className="text-left w-full text-[12px] text-ink-700 line-clamp-3 hover:text-ink-900 cursor-pointer transition-colors"
      title="点击查看完整输入"
      onClick={() => onOpen(text)}
    >
      {text}
    </button>
  );
}

function OutputCell({
  row,
  onOpen,
}: {
  row: RowResult | null;
  onOpen: (v: string) => void;
}) {
  if (!row) {
    return <span className="text-ink-300 text-xs">—</span>;
  }
  const display =
    row.parsed_json != null
      ? JSON.stringify(row.parsed_json, null, 2)
      : row.raw_output || row.error || "";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <StatusBadge status={row.status} />
        {row.latency_ms > 0 && (
          <span className="text-[11px] text-ink-500 tabular-nums">{row.latency_ms} ms</span>
        )}
      </div>
      <button
        type="button"
        className="block text-left w-full font-mono text-[11.5px] leading-snug text-ink-800 bg-ink-50 border border-ink-200 rounded px-2 py-1.5 line-clamp-6 hover:bg-ink-100 cursor-pointer transition-colors"
        title="点击查看完整输出"
        onClick={() => onOpen(display)}
      >
        {display || <span className="text-ink-400">（空）</span>}
      </button>
      {row.error && (
        <div className="text-[11px] text-danger truncate" title={row.error}>
          {row.error}
        </div>
      )}
    </div>
  );
}
