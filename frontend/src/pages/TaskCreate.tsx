import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiKeyStore, DatasetDetail, PromptTemplate, TaskOut } from "../api/client";
import { IconCheck, IconDoc, IconUpload } from "../components/Icon";
import { PromptEditor } from "../components/PromptEditor";
import { getUsedColumns } from "../components/PromptPreview";
import { StatusBadge } from "../components/StatusBadge";

type Step = 1 | 2 | 3;

function mergePrompt(system: string, user: string): string {
  const s = (system || "").trim();
  const u = (user || "").trim();
  if (s && u) return `# System\n${s}\n\n# User\n${u}`;
  if (s) return `# System\n${s}`;
  return u;
}

export function TaskCreate() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);

  const [ds, setDs] = useState<DatasetDetail | null>(null);
  const [taskName, setTaskName] = useState("");
  const [model, setModel] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.2);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await api.get<{ models: string[] }>("/models")).data.models,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">新建评测</h1>
        <p className="text-sm text-ink-500 mt-1">三步完成：上传数据 → 配置提示词 → 启动评测</p>
      </div>
      <Steps step={step} />

      {step === 1 && (
        <StepUpload
          onNext={(d) => {
            setDs(d);
            if (!taskName) setTaskName(d.name.replace(/\.[^.]+$/, ""));
            setStep(2);
          }}
        />
      )}

      {step === 2 && ds && (
        <StepConfigure
          ds={ds}
          name={taskName}
          setName={setTaskName}
          models={models.data || []}
          model={model}
          setModel={setModel}
          prompt={prompt}
          setPrompt={setPrompt}
          temperature={temperature}
          setTemperature={setTemperature}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && ds && (
        <StepLaunch
          ds={ds}
          name={taskName}
          model={model}
          prompt={prompt}
          temperature={temperature}
          onBack={() => setStep(2)}
          onDone={(t) => nav(`/tasks/${t.id}`)}
        />
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items = [
    { k: 1, label: "上传数据" },
    { k: 2, label: "配置评测" },
    { k: 3, label: "启动" },
  ];
  return (
    <ol className="flex items-center gap-3 text-sm">
      {items.map((it, i) => {
        const active = step === (it.k as Step);
        const done = step > (it.k as Step);
        return (
          <li key={it.k} className="flex items-center gap-3">
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-colors ${
                done ? "bg-success text-white" : active ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-700"
              }`}
            >
              {done ? <IconCheck className="w-3.5 h-3.5" /> : it.k}
            </span>
            <span className={active ? "text-ink-900 font-medium" : "text-ink-500"}>{it.label}</span>
            {i < items.length - 1 && <span className="w-8 h-px bg-ink-200" />}
          </li>
        );
      })}
    </ol>
  );
}

function StepUpload({ onNext }: { onNext: (d: DatasetDetail) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
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
    onSuccess: onNext,
  });

  const onPick = (f?: File | null) => {
    if (!f) return;
    upload.mutate(f);
  };

  return (
    <div className="card p-8">
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onPick(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center gap-3 py-14 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          drag ? "border-accent bg-amber-50/40" : "border-ink-200 hover:border-ink-700 hover:bg-ink-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-100 text-ink-700">
          <IconUpload className="w-5 h-5" />
        </span>
        <div className="text-ink-900 font-medium">点击或拖拽上传 .xlsx / .xls / .csv</div>
        <div className="text-xs text-ink-500">最大 5MB / 500 行</div>
        {upload.isPending && <div className="text-xs text-ink-700 mt-2">解析中…</div>}
        {upload.isError && (
          <div className="text-xs text-danger mt-2">
            上传失败：{(upload.error as any)?.response?.data?.detail || String(upload.error)}
          </div>
        )}
      </label>
    </div>
  );
}

function StepConfigure(props: {
  ds: DatasetDetail;
  name: string; setName: (s: string) => void;
  models: string[]; model: string; setModel: (s: string) => void;
  prompt: string; setPrompt: (s: string) => void;
  temperature: number; setTemperature: (n: number) => void;
  onBack: () => void; onNext: () => void;
}) {
  const { ds, name, setName, models, model, setModel, prompt, setPrompt, temperature, setTemperature, onBack, onNext } = props;
  const [showSave, setShowSave] = useState(false);
  const [selectedTplId, setSelectedTplId] = useState<string>("");
  const [cell, setCell] = useState<{ col: string; value: string; row: number } | null>(null);

  useEffect(() => {
    if (!cell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCell(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cell]);

  const validModel = !!model && models.includes(model);
  const canNext = name.trim() && prompt.trim() && validModel;
  const usedCols = useMemo(() => getUsedColumns(prompt), [prompt]);

  const tpls = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => (await api.get<PromptTemplate[]>("/prompts")).data,
  });

  const applyTemplate = (id: string) => {
    setSelectedTplId(id);
    if (!id) return;
    const t = (tpls.data || []).find((p) => String(p.id) === id);
    if (!t) return;
    setPrompt(mergePrompt(t.system_prompt, t.prompt_template));
    if (t.default_model && models.includes(t.default_model)) setModel(t.default_model);
    if (typeof t.default_temperature === "number") setTemperature(t.default_temperature);
    if (!name.trim()) setName(t.name);
  };

  const trial = useMutation({
    mutationFn: async () => {
      const r = await api.post("/tasks/trial", {
        dataset_id: ds.id,
        model,
        prompt_template: prompt,
        json_schema: "",
        temperature,
        row_index: 0,
        api_key: apiKeyStore.get() || null,
      });
      return r.data as {
        raw_output: string;
        parsed_json: Record<string, unknown> | null;
        parse_ok: boolean;
        error: string;
        latency_ms: number;
      };
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="card p-6 space-y-4">
          <div>
            <label className="label">任务名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：商品标题吸引力评测 v1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">模型</label>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">请选择…</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Temperature</label>
              <input
                type="number" min={0} max={2} step={0.1}
                className="input"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value || "0"))}
              />
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <label className="label !mb-0">
                提示词模板（用 <code className="px-1 py-0.5 bg-ink-100 rounded text-ink-900">{"{{列名}}"}</code> 引用 Excel 列）
              </label>
              <div className="flex items-center gap-2">
                <select
                  className="input !py-1 !text-xs w-52"
                  value={selectedTplId}
                  onChange={(e) => applyTemplate(e.target.value)}
                  title="从模板库选用"
                >
                  <option value="">从模板库选用…</option>
                  {(tpls.data || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost border border-ink-200 !py-1 !text-xs"
                  onClick={() => setShowSave(true)}
                  disabled={!prompt.trim()}
                  title="把当前配置保存到模板库"
                >
                  保存为模板
                </button>
              </div>
            </div>
            <textarea
              className="input font-mono text-[13px]"
              rows={7}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={"请评测以下商品标题与描述：\n标题：{{title}}\n描述：{{description}}"}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button className="btn-ghost" onClick={onBack}>← 返回</button>
            <div className="flex items-center gap-2">
              <button
                className="btn-ghost border border-ink-200"
                onClick={() => trial.mutate()}
                disabled={!canNext || trial.isPending}
                title={canNext ? "用首行试运行一次" : "请先填写必填项"}
              >
                {trial.isPending ? "试运行中…" : "首行试运行"}
              </button>
              <button className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed" onClick={onNext} disabled={!canNext}>
                下一步 →
              </button>
            </div>
          </div>
        </div>

        {trial.data && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">试运行结果</h3>
              <span className="text-xs text-ink-500">{trial.data.latency_ms} ms</span>
            </div>
            <div className="mb-2">
              <StatusBadge status={trial.data.parse_ok ? "success" : trial.data.error ? "failed" : "parse_error"} />
            </div>
            {trial.data.parsed_json && (
              <pre className="bg-ink-50 border border-ink-200 rounded p-3 text-[12px] overflow-auto max-h-60">
                {JSON.stringify(trial.data.parsed_json, null, 2)}
              </pre>
            )}
            <details className="mt-3">
              <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-900">查看原始输出</summary>
              <pre className="mt-2 bg-ink-50 border border-ink-200 rounded p-3 text-[12px] overflow-auto max-h-60 whitespace-pre-wrap">
                {trial.data.raw_output}
              </pre>
            </details>
          </div>
        )}
        {trial.isError && (
          <div className="card p-4 text-sm text-danger">
            试运行失败：{(trial.error as any)?.response?.data?.detail || String(trial.error)}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3 text-ink-700">
            <IconDoc className="w-4 h-4" />
            <span className="text-sm font-semibold">{ds.name}</span>
          </div>
          <div className="text-xs text-ink-500 space-y-1 mb-3">
            <div>共 <span className="text-ink-900 font-medium">{ds.rows}</span> 行</div>
            <div>{ds.columns.length} 列</div>
          </div>
          <div className="text-xs text-ink-700 mb-2 font-semibold uppercase tracking-wide">可用列名</div>
          <div className="flex flex-wrap gap-1.5">
            {ds.columns.map((c) => {
              const used = usedCols.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPrompt(prompt + `{{${c}}}`)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors cursor-pointer border ${
                    used
                      ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-200"
                      : "bg-ink-100 text-ink-700 border-transparent hover:bg-ink-900 hover:text-white"
                  }`}
                  title={used ? "已在模板中引用" : "点击插入到提示词"}
                >
                  {`{{${c}}}`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-700 mb-2">
            数据预览（共 {ds.preview.length} 行）
          </div>
          <div className="text-[11px] text-ink-500 mb-2">点击单元格可查看完整内容</div>
          <div className="overflow-auto max-h-[480px] -mx-2">
            <table className="w-full text-[12px]">
              <thead className="text-ink-500 sticky top-0 bg-white z-10">
                <tr className="border-b border-ink-200">
                  <th className="px-2 py-1 text-left font-medium w-10">#</th>
                  {ds.columns.map((c) => (
                    <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ds.preview.map((row, i) => (
                  <tr key={i} className="border-t border-ink-200">
                    <td className="px-2 py-1 align-top text-ink-400 tabular-nums">{i + 1}</td>
                    {ds.columns.map((c) => {
                      const v = String(row[c] ?? "");
                      return (
                        <td
                          key={c}
                          className="px-2 py-1 align-top text-ink-700 max-w-[160px] truncate cursor-pointer hover:bg-ink-100 transition-colors"
                          title={v}
                          onClick={() => setCell({ col: c, value: v, row: i })}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PromptEditor
        open={showSave}
        onClose={() => setShowSave(false)}
        initial={{
          name: name.trim(),
          prompt_template: prompt,
          json_schema: "",
          default_model: model,
          default_temperature: temperature,
        }}
      />

      {cell && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCell(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-soft border border-ink-200 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200">
              <div className="text-sm font-semibold text-ink-900 truncate pr-3">
                第 {cell.row + 1} 行 · {cell.col}
              </div>
              <button
                type="button"
                className="text-ink-500 hover:text-ink-900 cursor-pointer transition-colors shrink-0"
                onClick={() => setCell(null)}
                aria-label="关闭"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
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

function StepLaunch(props: {
  ds: DatasetDetail;
  name: string; model: string; prompt: string; temperature: number;
  onBack: () => void; onDone: (t: TaskOut) => void;
}) {
  const { ds, name, model, prompt, temperature, onBack, onDone } = props;
  const start = useMutation({
    mutationFn: async () => {
      const r = await api.post<TaskOut>("/tasks", {
        dataset_id: ds.id,
        name,
        model,
        prompt_template: prompt,
        json_schema: "",
        temperature,
        api_key: apiKeyStore.get() || null,
      });
      return r.data;
    },
    onSuccess: onDone,
  });

  return (
    <div className="card p-6 space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-700">确认信息</h3>
      <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
        <dt className="text-ink-500">任务名称</dt><dd className="text-ink-900 font-medium">{name}</dd>
        <dt className="text-ink-500">数据集</dt><dd className="text-ink-900 font-medium">{ds.name}（{ds.rows} 行）</dd>
        <dt className="text-ink-500">模型</dt><dd className="text-ink-900 font-medium">{model}</dd>
        <dt className="text-ink-500">Temperature</dt><dd className="text-ink-900 font-medium">{temperature}</dd>
      </dl>
      <div>
        <div className="label">提示词模板</div>
        <pre className="bg-ink-50 border border-ink-200 rounded p-3 text-[12px] overflow-auto max-h-48 whitespace-pre-wrap">{prompt}</pre>
      </div>
      <div className="flex items-center justify-between pt-2">
        <button className="btn-ghost" onClick={onBack}>← 返回修改</button>
        <button className="btn-accent" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? "启动中…" : "启动评测"}
        </button>
      </div>
      {start.isError && (
        <div className="text-sm text-danger">
          {(start.error as any)?.response?.data?.detail || String(start.error)}
        </div>
      )}
    </div>
  );
}
