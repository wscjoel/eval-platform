import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, AnnoJob } from "../api/client";
import { exportAnnoJobXlsx } from "../local/exports";
import { IconDownload, IconPlus, IconSettings, IconTrash } from "../components/Icon";

function fmtTime(s: string) {
  const d = new Date(s + "Z");
  return d.toLocaleString();
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-ink-700 w-16 text-right">
        {done}/{total}
      </span>
    </div>
  );
}

export function AnnotateList() {
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["anno-jobs"],
    queryFn: async () => (await api.get<AnnoJob[]>("/anno/jobs")).data,
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/anno/jobs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anno-jobs"] }),
  });

  const jobs = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">人工批注</h1>
          <p className="text-sm text-ink-500 mt-1">基于模版上传数据 · 逐行高可读性批注 · 自动入库 · 一键导出</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/annotate/templates" className="btn-ghost border border-ink-200">
            <IconSettings className="w-4 h-4" />
            模版管理
          </Link>
          <button className="btn-accent" onClick={() => nav("/annotate/new")}>
            <IconPlus className="w-4 h-4" />
            新建批注
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">来源文件</th>
              <th className="px-4 py-3 font-medium">批注维度</th>
              <th className="px-4 py-3 font-medium">进度</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-ink-500">加载中…</td></tr>
            )}
            {!isLoading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-ink-500">
                  暂无批注任务，点击右上角「新建批注」开始。
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-ink-200 hover:bg-ink-50/60 transition-colors">
                <td className="px-4 py-3">
                  <Link className="text-ink-900 font-medium hover:text-accent transition-colors" to={`/annotate/jobs/${j.id}`}>
                    {j.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-700 max-w-[260px] truncate" title={j.source_filename}>
                  {j.source_filename}
                </td>
                <td className="px-4 py-3 text-ink-700">
                  <div className="flex flex-wrap gap-1">
                    {j.selected_dimensions.slice(0, 3).map((d) => (
                      <span key={d} className="badge bg-ink-100 text-ink-700">{d}</span>
                    ))}
                    {j.selected_dimensions.length > 3 && (
                      <span className="badge bg-ink-100 text-ink-500">+{j.selected_dimensions.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3"><Progress done={j.annotated_rows} total={j.total_rows} /></td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(j.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5"
                      onClick={() => exportAnnoJobXlsx(j.id)}
                      title="导出 Excel"
                    >
                      <IconDownload className="w-4 h-4" />
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-danger hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`删除批注任务「${j.name}」?`)) del.mutate(j.id);
                      }}
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
    </div>
  );
}
