import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "../../api/client";
import { AdminTabs, fmtTime } from "./AdminTabs";

const PAGE_SIZE = 50;

export function AdminLoginRecords() {
  const [page, setPage] = useState(0);
  const [userId, setUserId] = useState<number | undefined>(undefined);

  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: adminApi.listUsers,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "login-records", userId, page],
    queryFn: () =>
      adminApi.loginRecords({ user_id: userId, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
        <p className="text-sm text-ink-500 mt-1">所有账号的登录历史，包括失败尝试。</p>
      </div>

      <AdminTabs />

      <div className="flex items-center gap-3">
        <select
          className="input max-w-[200px]"
          value={userId ?? ""}
          onChange={(e) => {
            setPage(0);
            setUserId(e.target.value ? Number(e.target.value) : undefined);
          }}
        >
          <option value="">全部用户</option>
          {(users || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name || u.username}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-500">共 {total} 条记录</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">用户名</th>
              <th className="px-4 py-3 font-medium">结果</th>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">设备 / 浏览器</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-500">
                  暂无登录记录
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.id} className="border-t border-ink-200">
                <td className="px-4 py-3 text-ink-700 whitespace-nowrap">{fmtTime(r.login_at)}</td>
                <td className="px-4 py-3 font-medium text-ink-900">{r.username}</td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      r.success ? "bg-green-50 text-success" : "bg-red-50 text-danger"
                    }`}
                  >
                    {r.success ? "成功" : "失败"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700 tabular-nums">{r.ip || "—"}</td>
                <td className="px-4 py-3 text-ink-500 max-w-[320px] truncate" title={r.user_agent}>
                  {r.user_agent || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            className="btn-ghost border border-ink-200 px-3 py-1.5"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            上一页
          </button>
          <span className="text-ink-500">
            {page + 1} / {pages}
          </span>
          <button
            className="btn-ghost border border-ink-200 px-3 py-1.5"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
