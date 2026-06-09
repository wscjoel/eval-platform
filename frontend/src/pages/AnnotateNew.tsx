import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AnnoJob,
  AnnotationTemplate,
  api,
  DatasetOut,
  datasetsApi,
  UploadParseResponse,
} from "../api/client";
import { DatasetPreviewModal } from "../components/DatasetPreviewModal";
import { DimensionConfigModal } from "../components/DimensionConfigModal";
import { IconArrowLeft, IconCheck, IconRefresh, IconSettings } from "../components/Icon";

type Step = 1 | 2 | 3;

export function AnnotateNew() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);

  const [templateId, setTemplateId] = useState<number | "">("");
  const [upload, setUpload] = useState<UploadParseResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedDims, setSelectedDims] = useState<string[]>([]);
  const [jobName, setJobName] = useState("");

  const tpls = useQuery({
    queryKey: ["anno-templates"],
    queryFn: async () => (await api.get<AnnotationTemplate[]>("/anno/templates")).data,
  });
  const tpl = (tpls.data || []).find((t) => t.id === templateId) || null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Link to="/annotate" className="hover:text-ink-900 transition-colors">人工批注</Link>
          <span>/</span>
          <span>新建批注</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link to="/annotate" className="btn-ghost !px-1.5 !py-1 text-ink-500" title="返回人工批注">
            <IconArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">新建批注任务</h1>
        </div>
        <p className="text-sm text-ink-500 mt-1">三步完成：选模版 → 选择数据集与字段映射 → 选维度与配置选项</p>
      </div>

      <Steps step={step} />

      {step === 1 && (
        <StepPickTemplate
          templates={tpls.data || []}
          loading={tpls.isLoading}
          templateId={templateId}
          setTemplateId={setTemplateId}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && tpl && (
        <StepUploadAndMap
          template={tpl}
          upload={upload}
          setUpload={(u) => {
            setUpload(u);
            if (u) setMapping(u.suggested_mapping || {});
            if (u && !jobName) setJobName(u.source_filename.replace(/\.[^.]+$/, ""));
          }}
          mapping={mapping}
          setMapping={setMapping}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && tpl && upload && (
        <StepDimensions
          template={tpl}
          jobName={jobName}
          setJobName={setJobName}
          selected={selectedDims}
          setSelected={setSelectedDims}
          upload={upload}
          mapping={mapping}
          onBack={() => setStep(2)}
          onDone={(job) => nav(`/annotate/jobs/${job.id}`)}
        />
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items = [
    { k: 1, label: "选模版" },
    { k: 2, label: "选择数据集与字段映射" },
    { k: 3, label: "选维度与选项" },
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

function StepPickTemplate({
  templates, loading, templateId, setTemplateId, onNext,
}: {
  templates: AnnotationTemplate[];
  loading: boolean;
  templateId: number | "";
  setTemplateId: (v: number | "") => void;
  onNext: () => void;
}) {
  const tpl = templates.find((t) => t.id === templateId);
  return (
    <div className="card p-6 space-y-4 max-w-2xl">
      <div>
        <label className="label">选择模版</label>
        <select
          className="input"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">{loading ? "加载中…" : "请选择…"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div className="text-xs text-ink-500 mt-1">
          没有合适的？前往 <Link className="text-accent hover:underline" to="/annotate/templates">模版管理</Link> 新建。
        </div>
      </div>

      {tpl && (
        <div className="space-y-3">
          <div>
            <div className="label">数据列（{tpl.data_columns.length}）</div>
            <div className="flex flex-wrap gap-1.5">
              {tpl.data_columns.map((c) => (
                <span key={c} className="badge bg-ink-100 text-ink-700">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="label">批注列（{tpl.annotation_columns.length}）</div>
            <div className="flex flex-wrap gap-1.5">
              {tpl.annotation_columns.map((c) => (
                <span key={c} className="badge bg-amber-50 text-amber-800 border border-amber-200">{c}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed" disabled={!tpl} onClick={onNext}>
          下一步 →
        </button>
      </div>
    </div>
  );
}

function StepUploadAndMap({
  template, upload, setUpload, mapping, setMapping, onBack, onNext,
}: {
  template: AnnotationTemplate;
  upload: UploadParseResponse | null;
  setUpload: (u: UploadParseResponse | null) => void;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const listQ = useQuery({ queryKey: ["datasets"], queryFn: datasetsApi.list });
  const datasets: DatasetOut[] = listQ.data || [];

  const pick = useMutation({
    mutationFn: async (datasetId: number) => {
      const r = await api.post<UploadParseResponse>("/anno/jobs/from-dataset", {
        template_id: template.id,
        dataset_id: datasetId,
      });
      return r.data;
    },
    onSuccess: setUpload,
  });

  const onPickDataset = (datasetId: number) => {
    setPickedId(datasetId);
    setUpload(null);
    pick.mutate(datasetId);
  };

  const allFields = [...template.data_columns, ...template.annotation_columns];
  const unmatched = upload
    ? allFields.filter((f) => !mapping[f])
    : [];

  const setField = (field: string, col: string) => {
    setMapping({ ...mapping, [field]: col });
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="text-sm font-semibold text-ink-900">选择要批注的数据集</div>
            <div className="text-xs text-ink-500 mt-0.5">
              从已保存的评测数据集中选择一个。若列表为空，请先到
              <Link to="/datasets" className="text-accent hover:underline mx-1">
                数据集管理
              </Link>
              新建数据集。点击名称可预览。
            </div>
          </div>
          <Link to="/datasets" className="btn-ghost border border-ink-200 !py-1 !text-xs">
            前往数据集管理
          </Link>
        </div>

        {listQ.isLoading && (
          <div className="px-3 py-10 text-center text-sm text-ink-500">加载中…</div>
        )}
        {!listQ.isLoading && datasets.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-ink-500">
            暂无数据集。请到「数据集管理」上传一个数据集后再来新建批注。
          </div>
        )}

        {datasets.length > 0 && (
          <div className="border border-ink-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-ink-700 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium w-10"></th>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">行数</th>
                  <th className="px-3 py-2 font-medium">列数</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => {
                  const active = pickedId === d.id;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => onPickDataset(d.id)}
                      className={`border-t border-ink-200 cursor-pointer transition-colors ${
                        active ? "bg-amber-50/60" : "hover:bg-ink-50/60"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="pick-anno-dataset"
                          checked={active}
                          onChange={() => onPickDataset(d.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-ink-900 font-medium truncate hover:text-accent transition-colors cursor-pointer text-left"
                          title="点击预览数据集"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewId(d.id);
                          }}
                        >
                          {d.name}
                        </button>
                        <div className="text-[11px] text-ink-500 mt-0.5 truncate">
                          {d.columns.slice(0, 6).join(" · ")}
                          {d.columns.length > 6 ? ` … +${d.columns.length - 6}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-ink-700">{d.rows}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-700">{d.columns.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pick.isPending && (
          <div className="flex items-center gap-2 text-xs text-ink-700 mt-3">
            <IconRefresh className="w-4 h-4 animate-spin" />
            解析数据集中…
          </div>
        )}
        {pick.isError && (
          <div className="text-xs text-danger mt-3">
            加载失败：{(pick.error as any)?.response?.data?.detail || String(pick.error)}
          </div>
        )}
        {upload && (
          <div className="text-xs text-success mt-3">
            已选择：{upload.source_filename}（{upload.total_rows} 行 / {upload.columns.length} 列）
          </div>
        )}
      </div>

      {upload && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">字段映射（模版字段 ← 数据集列）</h3>
            <div className="text-xs text-ink-500">
              {unmatched.length === 0 ? <span className="text-success">全部已映射</span> : `${unmatched.length} 个字段未映射`}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {allFields.map((f) => {
              const isAnno = template.annotation_columns.includes(f);
              const v = mapping[f] || "";
              const ok = !!v;
              return (
                <div key={f} className={`flex items-center gap-2 px-3 py-2 rounded-md border ${ok ? "border-ink-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
                  <span className={`badge ${isAnno ? "bg-amber-100 text-amber-800" : "bg-ink-100 text-ink-700"} shrink-0`}>{f}</span>
                  <span className="text-ink-300 shrink-0">←</span>
                  <select
                    className="input !py-1 !text-xs"
                    value={v}
                    onChange={(e) => setField(f, e.target.value)}
                  >
                    <option value="">（未映射）</option>
                    {upload.columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack}>← 上一步</button>
        <button
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!upload}
          onClick={onNext}
        >
          下一步 →
        </button>
      </div>

      {previewId != null && (
        <DatasetPreviewModal datasetId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}

function StepDimensions({
  template, jobName, setJobName, selected, setSelected, upload, mapping, onBack, onDone,
}: {
  template: AnnotationTemplate;
  jobName: string;
  setJobName: (s: string) => void;
  selected: string[];
  setSelected: (a: string[]) => void;
  upload: UploadParseResponse;
  mapping: Record<string, string>;
  onBack: () => void;
  onDone: (job: AnnoJob) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const toggle = (dim: string) => {
    if (selected.includes(dim)) setSelected(selected.filter((d) => d !== dim));
    else setSelected([...selected, dim]);
  };

  const dimsByName = useMemo(() => {
    const map = new Map<string, { input_type: string; select_mode: string | null; options_count: number }>();
    for (const d of template.dimensions || []) {
      map.set(d.dimension_name, {
        input_type: d.input_type,
        select_mode: d.select_mode,
        options_count: d.options_text ? d.options_text.split(/\r?\n/).filter((s) => s.trim()).length : 0,
      });
    }
    return map;
  }, [template]);

  const create = useMutation({
    mutationFn: async () => {
      const r = await api.post<AnnoJob>("/anno/jobs", {
        name: jobName.trim(),
        template_id: template.id,
        source_path: upload.source_path,
        source_filename: upload.source_filename,
        column_mapping: mapping,
        selected_dimensions: selected,
      });
      return r.data;
    },
    onSuccess: onDone,
  });

  const canCreate = jobName.trim() && selected.length > 0;

  return (
    <div className="space-y-4">
      <div className="card p-6 space-y-4 max-w-3xl">
        <div>
          <label className="label">任务名称</label>
          <input className="input" value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="例：客服助手 0526 抽样批注" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label !mb-0">选择本次要批注的维度（从模版批注列）</label>
            <div className="text-xs text-ink-500">已选 {selected.length} 个</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {template.annotation_columns.map((dim) => {
              const checked = selected.includes(dim);
              const cfg = dimsByName.get(dim);
              return (
                <div
                  key={dim}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-md border transition-colors ${
                    checked ? "border-ink-700 bg-ink-50" : "border-ink-200 bg-white hover:bg-ink-50/60"
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      className="accent-ink-900 cursor-pointer"
                      checked={checked}
                      onChange={() => toggle(dim)}
                    />
                    <span className="text-sm text-ink-900 truncate">{dim}</span>
                    {cfg && cfg.input_type === "options" && (
                      <span className="badge bg-ink-100 text-ink-700">{cfg.select_mode === "multi" ? "多选" : "单选"} · {cfg.options_count}</span>
                    )}
                    {cfg && cfg.input_type === "text" && (
                      <span className="badge bg-ink-100 text-ink-700">文本</span>
                    )}
                    {!cfg && (
                      <span className="badge bg-amber-50 text-amber-800 border border-amber-200">未配置</span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-xs border border-ink-200"
                    onClick={() => setEditing(dim)}
                    title="配置选项"
                  >
                    <IconSettings className="w-3.5 h-3.5" />
                    配置
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack}>← 上一步</button>
        <button
          className="btn-accent disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!canCreate || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "创建中…" : "创建并开始批注"}
        </button>
      </div>
      {create.isError && (
        <div className="text-sm text-danger">
          {(create.error as any)?.response?.data?.detail || String(create.error)}
        </div>
      )}

      {editing && (
        <DimensionConfigModal
          templateId={template.id}
          dimensionName={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
