import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/client";
import { AdminTabs, fmtTime } from "./AdminTabs";

export function AdminOverview() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: adminApi.overview,
  });

  const stats = data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
        <p className="text-sm text-ink-500 mt-1">
          每位用户的评测数据概况，点击行展开查看明细。
        </p>
      </div>

      <AdminTabs />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium text-right">数据集</th>
              <th className="px-4 py-3 font-medium text-right">评测任务</th>
              <th className="px-4 py-3 font-medium text-right">批注作业</th>
              <th className="px-4 py-3 font-medium text-right">登录次数</th>
              <th className="px-4 py-3 font-medium">最近登录</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {stats.map((s) => (
              <>
                <tr
                  key={s.user.id}
                  className="border-t border-ink-200 hover:bg-ink-50/60 cursor-pointer transition-colors"
                  onClick={() => setExpandedId(expandedId === s.user.id ? null : s.user.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-900 text-white text-[10px] font-semibold">
                        {(s.user.display_name || s.user.username).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="font-medium text-ink-900">
                        {s.user.display_name || s.user.username}
                      </span>
                      <span className="text-xs text-ink-500">{s.user.username}</span>
                      {s.user.role === "admin" && (
                        <span className="badge bg-accent/10 text-accent-hover">管理员</span>
                      )}
                      {!s.user.is_active && (
                        <span className="badge bg-red-50 text-danger">已禁用</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.dataset_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.task_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.anno_job_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.login_count}</td>
                  <td className="px-4 py-3 text-ink-500">{fmtTime(s.user.last_login_at)}</td>
                </tr>
                {expandedId === s.user.id && (
                  <tr key={`detail-${s.user.id}`} className="border-t border-ink-100 bg-ink-50/40">
                    <td colSpan={6} className="px-6 py-4">
                      <UserDataDetail userId={s.user.id} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserDataDetail({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "user-data", userId],
    queryFn: () => adminApi.userData(userId),
  });

  if (isLoading) return <div className="text-sm text-ink-500 py-2">加载明细中…</div>;
  if (!data) return null;

  const { datasets, tasks, anno_jobs } = data;

  return (
    <div className="grid md:grid-cols-3 gap-4 text-sm">
      <div>
        <div className="font-medium text-ink-900 mb-2">数据集（{datasets.length}）</div>
        {datasets.length === 0 && <div className="text-ink-500">无</div>}
        <ul className="space-y-1">
          {datasets.slice(0, 8).map((d) => (
            <li key={d.id} className="text-ink-700 truncate" title={d.name}>
              {d.name} <span className="text-ink-500">· {d.rows} 行</span>
            </li>
          ))}
          {datasets.length > 8 && (
            <li className="text-ink-500">… 共 {datasets.length} 个</li>
          )}
        </ul>
      </div>
      <div>
        <div className="font-medium text-ink-900 mb-2">评测任务（{tasks.length}）</div>
        {tasks.length === 0 && <div className="text-ink-500">无</div>}
        <ul className="space-y-1">
          {tasks.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">
              <Link to={`/tasks/${t.id}`} className="text-ink-700 hover:text-ink-900 underline-offset-2 hover:underline">
                {t.name}
              </Link>{" "}
              <span className="text-ink-500">
                · {t.status} · {t.succeeded}/{t.total}
              </span>
            </li>
          ))}
          {tasks.length > 8 && <li className="text-ink-500">… 共 {tasks.length} 个</li>}
        </ul>
      </div>
      <div>
        <div className="font-medium text-ink-900 mb-2">批注作业（{anno_jobs.length}）</div>
        {anno_jobs.length === 0 && <div className="text-ink-500">无</div>}
        <ul className="space-y-1">
          {anno_jobs.slice(0, 8).map((j) => (
            <li key={j.id} className="truncate">
              <Link to={`/annotate/jobs/${j.id}`} className="text-ink-700 hover:text-ink-900 underline-offset-2 hover:underline">
                {j.name}
              </Link>{" "}
              <span className="text-ink-500">· {j.total_rows} 行</span>
            </li>
          ))}
          {anno_jobs.length > 8 && <li className="text-ink-500">… 共 {anno_jobs.length} 个</li>}
        </ul>
      </div>
    </div>
  );
}
