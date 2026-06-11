import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, TaskOut } from "../api/client";
import { exportTaskXlsx } from "../local/exports";
import { IconDownload, IconPlus, IconTrash } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";

function fmtTime(s: string) {
  const d = new Date(s + "Z");
  return d.toLocaleString();
}

function ProgressBar({ t }: { t: TaskOut }) {
  const pct = t.total === 0 ? 0 : Math.round((t.processed / t.total) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-ink-900 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-ink-700 w-14 text-right">
        {t.processed}/{t.total}
      </span>
    </div>
  );
}

export function TaskList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => (await api.get<TaskOut[]>("/tasks")).data,
    refetchInterval: 3000,
  });
  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const tasks = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">评测任务</h1>
          <p className="text-sm text-ink-500 mt-1">上传 Excel · 配置提示词 · 自动评测 · 导出结果</p>
        </div>
        <button className="btn-accent" onClick={() => nav("/new")}>
          <IconPlus className="w-4 h-4" />
          新建评测
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">模型</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">进度</th>
              <th className="px-4 py-3 font-medium">成功 / 失败</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-ink-500">加载中…</td></tr>
            )}
            {!isLoading && tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-ink-500">
                  暂无任务，点击右上角「新建评测」开始。
                </td>
              </tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-ink-200 hover:bg-ink-50/60 transition-colors">
                <td className="px-4 py-3">
                  <Link className="text-ink-900 font-medium hover:text-accent transition-colors" to={`/tasks/${t.id}`}>
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-700">{t.model}</td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3"><ProgressBar t={t} /></td>
                <td className="px-4 py-3 tabular-nums">
                  <span className="text-success">{t.succeeded}</span>
                  <span className="text-ink-300 mx-1">/</span>
                  <span className="text-danger">{t.failed}</span>
                </td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(t.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5"
                      onClick={() => exportTaskXlsx(t.id)}
                      title="导出 Excel"
                    >
                      <IconDownload className="w-4 h-4" />
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-danger hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`删除任务「${t.name}」?`)) del.mutate(t.id);
                      }}
                      disabled={t.status === "running"}
                      title={t.status === "running" ? "运行中不可删除" : "删除"}
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
    </div>
  );
}
