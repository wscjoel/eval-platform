import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, PromptTemplate } from "../api/client";
import { IconDoc, IconPlus, IconTrash } from "../components/Icon";
import { PromptEditor } from "../components/PromptEditor";

function fmtTime(s: string) {
  return new Date(s + "Z").toLocaleString();
}

export function PromptList() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => (await api.get<PromptTemplate[]>("/prompts")).data,
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/prompts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
  });

  const items = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">提示词库</h1>
          <p className="text-sm text-ink-500 mt-1">
            管理可复用的评测提示词模板。在新建任务时可一键加载。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/prompts/compare" className="btn-ghost border border-ink-200">
            提示词对比
          </Link>
          <button className="btn-accent" onClick={() => setCreating(true)}>
            <IconPlus className="w-4 h-4" />
            新建模板
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">描述</th>
              <th className="px-4 py-3 font-medium">默认模型</th>
              <th className="px-4 py-3 font-medium">temperature</th>
              <th className="px-4 py-3 font-medium">更新时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-ink-500">加载中…</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-ink-500">
                  <div className="inline-flex flex-col items-center gap-2">
                    <IconDoc className="w-6 h-6 text-ink-300" />
                    <span>还没有保存的模板，点击右上角「新建模板」开始。</span>
                  </div>
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr
                key={p.id}
                className="border-t border-ink-200 hover:bg-ink-50/60 cursor-pointer transition-colors"
                onClick={() => setEditing(p)}
              >
                <td className="px-4 py-3 font-medium text-ink-900">{p.name}</td>
                <td className="px-4 py-3 text-ink-700 max-w-[260px] truncate" title={p.description}>
                  {p.description || <span className="text-ink-300">—</span>}
                </td>
                <td className="px-4 py-3 text-ink-700">{p.default_model || <span className="text-ink-300">—</span>}</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{p.default_temperature}</td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(p.updated_at)}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5 text-danger hover:bg-red-50"
                      onClick={() => { if (confirm(`删除模板「${p.name}」?`)) del.mutate(p.id); }}
                      title="删除"
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

      <PromptEditor open={creating} onClose={() => setCreating(false)} />
      <PromptEditor
        open={!!editing}
        initial={editing ? { ...editing, id: editing.id } : undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
