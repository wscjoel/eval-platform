import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AnnoJobDetail,
  AnnoRowDetail,
  AnnoRowsResponse,
  api,
  DimensionConfig,
} from "../api/client";
import { DimensionConfigModal, parseOptions } from "../components/DimensionConfigModal";
import { exportAnnoJobXlsx } from "../local/exports";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconSettings,
} from "../components/Icon";

type RowFilter = "all" | "annotated" | "pending";

export function AnnotateWorkspace() {
  const { id } = useParams();
  const jobId = Number(id);
  const qc = useQueryClient();

  const jobQ = useQuery({
    queryKey: ["anno-job", jobId],
    queryFn: async () => (await api.get<AnnoJobDetail>(`/anno/jobs/${jobId}`)).data,
    enabled: !Number.isNaN(jobId),
  });

  const [filter, setFilter] = useState<RowFilter>("all");
  const rowsQ = useQuery({
    queryKey: ["anno-rows", jobId, filter],
    queryFn: async () => (await api.get<AnnoRowsResponse>(`/anno/jobs/${jobId}/rows`, { params: { status: filter } })).data,
    enabled: !Number.isNaN(jobId),
  });

  const [currentRow, setCurrentRow] = useState<number | null>(null);

  // 进入时默认指向第一个 pending 行（若有），否则第一行
  useEffect(() => {
    if (currentRow !== null) return;
    if (!jobQ.data) return;
    // 先查 pending 列表选第一个
    api.get<AnnoRowsResponse>(`/anno/jobs/${jobId}/rows`, { params: { status: "pending" } })
      .then((r) => {
        if (r.data.items.length > 0) setCurrentRow(r.data.items[0].row_index);
        else if (jobQ.data && jobQ.data.total_rows > 0) setCurrentRow(0);
      })
      .catch(() => {
        if (jobQ.data && jobQ.data.total_rows > 0) setCurrentRow(0);
      });
  }, [jobQ.data, currentRow, jobId]);

  const rowQ = useQuery({
    queryKey: ["anno-row", jobId, currentRow],
    queryFn: async () => (await api.get<AnnoRowDetail>(`/anno/jobs/${jobId}/rows/${currentRow}`)).data,
    enabled: currentRow !== null,
  });

  const job = jobQ.data;
  const tpl = job?.template;

  const dimConfigs = useMemo(() => {
    const map = new Map<string, DimensionConfig>();
    if (tpl) for (const d of tpl.dimensions || []) map.set(d.dimension_name, d);
    return map;
  }, [tpl]);

  const [configDim, setConfigDim] = useState<string | null>(null);

  const goPrev = () => {
    if (!rowsQ.data || currentRow === null) return;
    const items = rowsQ.data.items;
    const idx = items.findIndex((r) => r.row_index === currentRow);
    if (idx > 0) setCurrentRow(items[idx - 1].row_index);
    else if (idx === -1 && items.length > 0) setCurrentRow(items[0].row_index);
  };

  const goNextPending = useCallback(() => {
    if (!rowsQ.data || currentRow === null) return;
    const items = rowsQ.data.items;
    // 优先找下一个未批注
    const startIdx = items.findIndex((r) => r.row_index === currentRow);
    for (let i = startIdx + 1; i < items.length; i++) {
      if (!items[i].annotated) { setCurrentRow(items[i].row_index); return; }
    }
    // 没有则下一个任意行
    if (startIdx >= 0 && startIdx + 1 < items.length) setCurrentRow(items[startIdx + 1].row_index);
  }, [rowsQ.data, currentRow]);

  const goNext = () => {
    if (!rowsQ.data || currentRow === null) return;
    const items = rowsQ.data.items;
    const idx = items.findIndex((r) => r.row_index === currentRow);
    if (idx >= 0 && idx + 1 < items.length) setCurrentRow(items[idx + 1].row_index);
  };

  if (Number.isNaN(jobId)) return <div className="text-sm text-danger">无效任务 id</div>;
  if (jobQ.isLoading) return <div className="text-sm text-ink-500">加载中…</div>;
  if (!job || !tpl) return <div className="text-sm text-danger">任务不存在或模版已删除</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Link to="/annotate" className="hover:text-ink-900 transition-colors">人工批注</Link>
            <span>/</span>
            <span>{job.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Link to="/annotate" className="btn-ghost !px-1.5 !py-1 text-ink-500" title="返回人工批注">
              <IconArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">{job.name}</h1>
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            来源：{job.source_filename} · 共 {job.total_rows} 行 · 已批注 <span className="text-success font-medium">{job.annotated_rows}</span> · 未批注 <span className="text-warning font-medium">{job.pending_rows}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost border border-ink-200" onClick={() => exportAnnoJobXlsx(jobId)}>
            <IconDownload className="w-4 h-4" />
            导出 Excel
          </button>
        </div>
      </div>

      <Progress done={job.annotated_rows} total={job.total_rows} />

      <div className="grid grid-cols-12 gap-4">
        {/* 左：行选择器 */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="card overflow-hidden sticky top-20">
            <div className="px-3 py-2 border-b border-ink-200 bg-ink-50">
              <div className="flex items-center gap-1 text-xs">
                <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>全部 {job.total_rows}</FilterTab>
                <FilterTab active={filter === "pending"} onClick={() => setFilter("pending")}>未批注 {job.pending_rows}</FilterTab>
                <FilterTab active={filter === "annotated"} onClick={() => setFilter("annotated")}>已批注 {job.annotated_rows}</FilterTab>
              </div>
            </div>
            <div className="max-h-[calc(100vh-280px)] overflow-auto overscroll-contain">
              {rowsQ.isLoading && <div className="px-3 py-6 text-center text-xs text-ink-500">加载中…</div>}
              {rowsQ.data && rowsQ.data.items.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-ink-500">（无数据）</div>
              )}
              {rowsQ.data?.items.map((r) => {
                const active = r.row_index === currentRow;
                return (
                  <button
                    key={r.row_index}
                    type="button"
                    onClick={() => setCurrentRow(r.row_index)}
                    className={`w-full text-left px-3 py-2 border-b border-ink-100 cursor-pointer transition-colors ${
                      active ? "bg-ink-900 text-white" : "hover:bg-ink-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] tabular-nums ${active ? "text-white/70" : "text-ink-500"}`}>#{r.row_index + 1}</span>
                      {r.annotated ? (
                        <span className={`badge ${active ? "bg-white/20 text-white" : "bg-success/10 text-success"}`}>
                          <IconCheck className="w-3 h-3" />
                          已批注
                        </span>
                      ) : (
                        <span className={`badge ${active ? "bg-white/20 text-white" : "bg-warning/10 text-warning"}`}>未批注</span>
                      )}
                    </div>
                    <div className={`mt-1 text-[12px] truncate ${active ? "text-white" : "text-ink-700"}`} title={r.preview}>
                      {r.preview || "(空)"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* 中：阅读区 */}
        <section className="col-span-12 lg:col-span-5">
          {rowQ.data ? <ReadingPanel row={rowQ.data} /> : (
            <div className="card p-10 text-center text-ink-500 text-sm">{currentRow === null ? "请从左侧选择一行" : "加载中…"}</div>
          )}
        </section>

        {/* 右：批注表单 */}
        <section className="col-span-12 lg:col-span-4">
          {rowQ.data && currentRow !== null ? (
            <AnnotationForm
              jobId={jobId}
              rowIndex={currentRow}
              row={rowQ.data}
              selectedDims={job.selected_dimensions}
              dimConfigs={dimConfigs}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["anno-job", jobId] });
                qc.invalidateQueries({ queryKey: ["anno-rows", jobId] });
              }}
              onConfig={(dim) => setConfigDim(dim)}
              onPrev={goPrev}
              onNext={goNext}
              onNextPending={goNextPending}
            />
          ) : (
            <div className="card p-10 text-center text-ink-500 text-sm">—</div>
          )}
        </section>
      </div>

      {configDim && tpl && (
        <DimensionConfigModal
          templateId={tpl.id}
          dimensionName={configDim}
          onClose={() => setConfigDim(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["anno-job", jobId] });
          }}
        />
      )}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3 text-xs text-ink-500">
      <span className="tabular-nums">{done}/{total}</span>
      <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums w-10 text-right">{pct}%</span>
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded transition-colors cursor-pointer ${
        active ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100"
      }`}
    >
      {children}
    </button>
  );
}

function ReadingPanel({ row }: { row: AnnoRowDetail }) {
  const fields = Object.entries(row.data);
  return (
    <div className="card p-5 space-y-4 h-[calc(100vh-200px)] overflow-auto overscroll-contain">
      <div className="flex items-center justify-between sticky top-0 bg-white -mt-5 -mx-5 px-5 pt-5 pb-2 border-b border-ink-100 z-[1]">
        <h3 className="text-sm font-semibold text-ink-900">数据阅读 · 第 {row.row_index + 1} 行</h3>
      </div>
      {fields.length === 0 && (
        <div className="text-sm text-ink-500">未配置数据列映射</div>
      )}
      {fields.map(([field, value]) => (
        <div key={field}>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1.5">{field}</div>
          <FieldContent value={value} />
        </div>
      ))}
    </div>
  );
}

function FieldContent({ value }: { value: string }) {
  const text = (value || "").trim();
  if (!text) return <div className="text-sm text-ink-500 italic px-3 py-2 bg-ink-50 rounded-md border border-ink-200">（空）</div>;

  // 尝试 JSON 美化
  try {
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      const parsed = JSON.parse(text);
      return (
        <pre className="bg-ink-50 border border-ink-200 rounded-md p-3 text-[12px] overflow-auto overscroll-contain max-h-72 whitespace-pre-wrap leading-relaxed text-ink-900">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
  } catch {
    /* fallthrough */
  }

  return (
    <div className="bg-white border border-ink-200 rounded-md px-4 py-3 text-[13.5px] leading-relaxed text-ink-900 whitespace-pre-wrap break-words max-h-72 overflow-auto overscroll-contain">
      {text}
    </div>
  );
}

function AnnotationForm({
  jobId, rowIndex, row, selectedDims, dimConfigs, onSaved, onConfig, onPrev, onNext, onNextPending,
}: {
  jobId: number;
  rowIndex: number;
  row: AnnoRowDetail;
  selectedDims: string[];
  dimConfigs: Map<string, DimensionConfig>;
  onSaved: () => void;
  onConfig: (dim: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onNextPending: () => void;
}) {
  // 解析当前行的批注值（单选/文本：string；多选：string[]）
  const initialValues = useMemo(() => {
    const out: Record<string, string | string[]> = {};
    for (const dim of selectedDims) {
      const raw = row.annotations[dim] || "";
      const cfg = dimConfigs.get(dim);
      if (cfg?.input_type === "options" && cfg.select_mode === "multi") {
        try {
          const arr = raw ? JSON.parse(raw) : [];
          out[dim] = Array.isArray(arr) ? arr.map(String) : [];
        } catch {
          out[dim] = raw ? [raw] : [];
        }
      } else {
        out[dim] = raw;
      }
    }
    return out;
  }, [row, selectedDims, dimConfigs]);

  const [values, setValues] = useState<Record<string, string | string[]>>(initialValues);

  // 切换行时重置
  useEffect(() => { setValues(initialValues); }, [initialValues]);

  // ---- 折叠状态：默认全部折叠；按 job+row+dim 记忆 ----
  const storageKey = `anno-collapse:${jobId}`;
  const collapseKey = (r: number, d: string) => `${r}::${d}`;
  const [collapseMap, setCollapseMap] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try {
      setCollapseMap(JSON.parse(localStorage.getItem(storageKey) || "{}"));
    } catch {
      setCollapseMap({});
    }
  }, [storageKey]);
  const isCollapsed = (dim: string): boolean => {
    const v = collapseMap[collapseKey(rowIndex, dim)];
    return v === undefined ? true : v; // 默认折叠
  };
  const writeCollapse = (next: Record<string, boolean>) => {
    setCollapseMap(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore quota */ }
  };
  const toggleCollapse = (dim: string) => {
    const k = collapseKey(rowIndex, dim);
    const cur = isCollapsed(dim);
    writeCollapse({ ...collapseMap, [k]: !cur });
  };
  const setAllCollapsed = (collapsed: boolean) => {
    const next = { ...collapseMap };
    for (const dim of selectedDims) next[collapseKey(rowIndex, dim)] = collapsed;
    writeCollapse(next);
  };

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<number | null>(null);

  const buildPayload = useCallback((v: Record<string, string | string[]>) => {
    const out: Record<string, string> = {};
    for (const dim of selectedDims) {
      const val = v[dim];
      if (Array.isArray(val)) out[dim] = val.length ? JSON.stringify(val) : "";
      else out[dim] = (val as string) || "";
    }
    return out;
  }, [selectedDims]);

  const doSave = useCallback(async (v: Record<string, string | string[]>) => {
    setSaveState("saving");
    try {
      await api.put(`/anno/jobs/${jobId}/rows/${rowIndex}`, { annotations: buildPayload(v) });
      setSaveState("saved");
      onSaved();
    } catch {
      setSaveState("error");
    }
  }, [jobId, rowIndex, buildPayload, onSaved]);

  const scheduleSave = useCallback((v: Record<string, string | string[]>) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { doSave(v); }, 600);
  }, [doSave]);

  const setVal = (dim: string, v: string | string[]) => {
    const next = { ...values, [dim]: v };
    setValues(next);
    scheduleSave(next);
  };

  const saveAndNext = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await doSave(values);
    onNextPending();
  };

  return (
    <div className="card flex flex-col h-[calc(100vh-200px)]">
      {/* 顶部 sticky header */}
      <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold shrink-0">批注</h3>
          <SaveIndicator state={saveState} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="text-[11px] text-ink-500 hover:text-ink-900 px-2 py-1 rounded hover:bg-ink-50 cursor-pointer transition-colors"
            onClick={() => setAllCollapsed(false)}
            title="全部展开"
          >
            全部展开
          </button>
          <button
            type="button"
            className="text-[11px] text-ink-500 hover:text-ink-900 px-2 py-1 rounded hover:bg-ink-50 cursor-pointer transition-colors"
            onClick={() => setAllCollapsed(true)}
            title="全部折叠"
          >
            全部折叠
          </button>
        </div>
      </div>

      {/* 中部可滚动维度列表 */}
      <div className="flex-1 overflow-auto overscroll-contain px-3 py-3 space-y-2">
        {selectedDims.length === 0 && (
          <div className="text-sm text-ink-500 px-2">此任务未选择任何批注维度</div>
        )}
        {selectedDims.map((dim) => {
          const cfg = dimConfigs.get(dim);
          const v = values[dim] ?? "";
          const open = !isCollapsed(dim);
          const filled = hasValue(v);
          const summary = summarize(v);
          return (
            <div key={dim} className={`rounded-md border transition-colors ${open ? "border-ink-200 bg-white" : "border-ink-200 bg-white hover:bg-ink-50/60"}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapse(dim)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapse(dim); } }}
                className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
              >
                <IconChevronRight className={`w-3.5 h-3.5 text-ink-500 transition-transform duration-150 shrink-0 ${open ? "rotate-90" : ""}`} />
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${filled ? "bg-success" : "bg-ink-200"}`} aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-700 shrink-0">{dim}</span>
                {!open && (
                  <span className={`text-[11px] truncate flex-1 ${filled ? "text-ink-700" : "text-ink-400 italic"}`} title={summary || "未填写"}>
                    {summary || "未填写"}
                  </span>
                )}
                {open && <span className="flex-1" />}
                <button
                  type="button"
                  className="text-[11px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-ink-100 cursor-pointer transition-colors shrink-0"
                  onClick={(e) => { e.stopPropagation(); onConfig(dim); }}
                  title="配置该维度的选项"
                >
                  <IconSettings className="w-3 h-3" />
                  配置
                </button>
              </div>
              {open && (
                <div className="px-3 pb-3 pl-7">
                  <DimensionField cfg={cfg} value={v} onChange={(nv) => setVal(dim, nv)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部固定操作区 */}
      <div className="px-5 py-3 border-t border-ink-200 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <button className="btn-ghost border border-ink-200 flex-1" onClick={onPrev}>
            <IconArrowLeft className="w-4 h-4" />
            上一行
          </button>
          <button className="btn-ghost border border-ink-200 flex-1" onClick={onNext}>
            下一行
            <IconArrowRight className="w-4 h-4" />
          </button>
        </div>
        <button className="btn-accent w-full" onClick={saveAndNext}>
          保存并跳至下一未批注
          <IconArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function hasValue(v: string | string[]): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return (v || "").trim().length > 0;
}

function summarize(v: string | string[]): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    if (v.length <= 2) return v.join("、");
    return `${v.slice(0, 2).join("、")} +${v.length - 2}`;
  }
  const s = (v || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s.length > 30 ? `${s.slice(0, 30)}…` : s;
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "saving") return <span className="text-xs text-ink-500">保存中…</span>;
  if (state === "saved") return <span className="text-xs text-success inline-flex items-center gap-1"><IconCheck className="w-3 h-3" />已保存</span>;
  if (state === "error") return <span className="text-xs text-danger">保存失败</span>;
  return <span className="text-xs text-ink-400">—</span>;
}

function DimensionField({
  cfg, value, onChange,
}: {
  cfg: DimensionConfig | undefined;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  if (!cfg || (cfg.input_type === "options" && !cfg.options_text)) {
    return (
      <div className="text-xs text-ink-500 italic px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
        该维度未配置选项，请点击右上角"配置"。
      </div>
    );
  }

  if (cfg.input_type === "text") {
    return (
      <textarea
        className="input"
        rows={4}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="请输入…"
      />
    );
  }

  const options = parseOptions(cfg.options_text);

  if (cfg.select_mode === "single") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1">
        {options.map((opt) => {
          const checked = v === opt;
          return (
            <label
              key={opt}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                checked ? "border-ink-700 bg-ink-50" : "border-ink-200 hover:bg-ink-50/60"
              }`}
            >
              <input
                type="radio"
                className="accent-ink-900 cursor-pointer"
                checked={checked}
                onChange={() => onChange(opt)}
              />
              <span className="text-sm text-ink-900">{opt}</span>
            </label>
          );
        })}
        {v && (
          <button type="button" className="text-xs text-ink-500 hover:text-danger transition-colors cursor-pointer" onClick={() => onChange("")}>
            清除选择
          </button>
        )}
      </div>
    );
  }

  // multi
  const arr = Array.isArray(value) ? value : [];
  const toggle = (opt: string) => {
    if (arr.includes(opt)) onChange(arr.filter((x) => x !== opt));
    else onChange([...arr, opt]);
  };
  return (
    <div className="space-y-1">
      {options.map((opt) => {
        const checked = arr.includes(opt);
        return (
          <label
            key={opt}
            className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
              checked ? "border-ink-700 bg-ink-50" : "border-ink-200 hover:bg-ink-50/60"
            }`}
          >
            <input
              type="checkbox"
              className="accent-ink-900 cursor-pointer"
              checked={checked}
              onChange={() => toggle(opt)}
            />
            <span className="text-sm text-ink-900">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}
