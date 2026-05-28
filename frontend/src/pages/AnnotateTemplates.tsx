import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, AnnotationTemplate, AnnotationTemplateInput } from "../api/client";
import { IconArrowLeft, IconArrowRight, IconEdit, IconPlus, IconTrash, IconX } from "../components/Icon";

export function AnnotateTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["anno-templates"],
    queryFn: async () => (await api.get<AnnotationTemplate[]>("/anno/templates")).data,
  });

  const [editing, setEditing] = useState<AnnotationTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/anno/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anno-templates"] }),
  });

  const tpls = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Link to="/annotate" className="hover:text-ink-900 transition-colors">人工批注</Link>
            <span>/</span>
            <span>模版管理</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">模版管理</h1>
          <p className="text-sm text-ink-500 mt-1">定义【数据列】（客观信息）与【批注列】（待标注维度）</p>
        </div>
        <button className="btn-accent" onClick={() => setCreating(true)}>
          <IconPlus className="w-4 h-4" />
          新建模版
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">数据列</th>
              <th className="px-4 py-3 font-medium">批注列</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-500">加载中…</td></tr>}
            {!isLoading && tpls.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-ink-500">暂无模版</td></tr>
            )}
            {tpls.map((t) => (
              <tr key={t.id} className="border-t border-ink-200">
                <td className="px-4 py-3">
                  <div className="text-ink-900 font-medium">{t.name}</div>
                  {t.description && <div className="text-xs text-ink-500 mt-0.5">{t.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-md">
                    {t.data_columns.map((c) => (
                      <span key={c} className="badge bg-ink-100 text-ink-700">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-md">
                    {t.annotation_columns.map((c) => (
                      <span key={c} className="badge bg-amber-50 text-amber-800 border border-amber-200">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button className="btn-ghost px-2 py-1.5" title="编辑" onClick={() => setEditing(t)}>
                      <IconEdit className="w-4 h-4" />
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-danger hover:bg-red-50"
                      title="删除"
                      onClick={() => { if (confirm(`删除模版「${t.name}」?`)) del.mutate(t.id); }}
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <TemplateEditor
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["anno-templates"] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: AnnotationTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [dataCols, setDataCols] = useState<string[]>(initial?.data_columns || []);
  const [annoCols, setAnnoCols] = useState<string[]>(initial?.annotation_columns || []);
  const [newCol, setNewCol] = useState("");

  const allCols = useMemo(() => [...dataCols, ...annoCols], [dataCols, annoCols]);

  const save = useMutation({
    mutationFn: async () => {
      const body: AnnotationTemplateInput = {
        name: name.trim(),
        description: desc.trim(),
        data_columns: dataCols,
        annotation_columns: annoCols,
      };
      if (initial) {
        return api.put<AnnotationTemplate>(`/anno/templates/${initial.id}`, body);
      }
      return api.post<AnnotationTemplate>("/anno/templates", body);
    },
    onSuccess: onSaved,
  });

  const addCol = (target: "data" | "anno") => {
    const v = newCol.trim();
    if (!v) return;
    if (allCols.includes(v)) { setNewCol(""); return; }
    if (target === "data") setDataCols([...dataCols, v]);
    else setAnnoCols([...annoCols, v]);
    setNewCol("");
  };

  const moveTo = (col: string, target: "data" | "anno") => {
    if (target === "data") {
      setAnnoCols(annoCols.filter((c) => c !== col));
      if (!dataCols.includes(col)) setDataCols([...dataCols, col]);
    } else {
      setDataCols(dataCols.filter((c) => c !== col));
      if (!annoCols.includes(col)) setAnnoCols([...annoCols, col]);
    }
  };

  const removeCol = (col: string) => {
    setDataCols(dataCols.filter((c) => c !== col));
    setAnnoCols(annoCols.filter((c) => c !== col));
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-soft w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? "编辑模版" : "新建模版"}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose}><IconX className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="label">名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：客服助手适配评测" />
          </div>
          <div>
            <label className="label">描述（可选）</label>
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>

          <div>
            <label className="label">添加字段</label>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={newCol}
                onChange={(e) => setNewCol(e.target.value)}
                placeholder="输入字段名后选择归类"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCol("data"); } }}
              />
              <button className="btn-ghost border border-ink-200" onClick={() => addCol("data")} disabled={!newCol.trim()}>
                ← 加到数据列
              </button>
              <button className="btn-ghost border border-ink-200" onClick={() => addCol("anno")} disabled={!newCol.trim()}>
                加到批注列 →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ColumnBucket
              title="数据列（用于阅读）"
              cols={dataCols}
              colorClass="bg-ink-100 text-ink-700"
              onRemove={removeCol}
              onMove={(c) => moveTo(c, "anno")}
              moveLabel="移到批注列"
              moveIcon="right"
            />
            <ColumnBucket
              title="批注列（待标注维度）"
              cols={annoCols}
              colorClass="bg-amber-50 text-amber-800 border border-amber-200"
              onRemove={removeCol}
              onMove={(c) => moveTo(c, "data")}
              moveLabel="移到数据列"
              moveIcon="left"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-ink-200 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
        </div>
        {save.isError && (
          <div className="px-6 pb-4 text-sm text-danger">
            {(save.error as any)?.response?.data?.detail || String(save.error)}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnBucket({
  title, cols, colorClass, onRemove, onMove, moveLabel, moveIcon,
}: {
  title: string;
  cols: string[];
  colorClass: string;
  onRemove: (c: string) => void;
  onMove: (c: string) => void;
  moveLabel: string;
  moveIcon: "left" | "right";
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-700 mb-2">{title}</div>
      <div className="border border-ink-200 rounded-md p-3 min-h-[120px] space-y-1.5">
        {cols.length === 0 && <div className="text-xs text-ink-500">（暂无字段）</div>}
        {cols.map((c) => (
          <div key={c} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-white border border-ink-200">
            <span className={`badge ${colorClass}`}>{c}</span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-1.5 py-1 text-xs" title={moveLabel} onClick={() => onMove(c)}>
                {moveIcon === "left" ? <IconArrowLeft className="w-3.5 h-3.5" /> : <IconArrowRight className="w-3.5 h-3.5" />}
              </button>
              <button className="btn-ghost px-1.5 py-1 text-xs text-danger hover:bg-red-50" title="删除" onClick={() => onRemove(c)}>
                <IconTrash className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
