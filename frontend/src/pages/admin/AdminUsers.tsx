import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, CurrentUser } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AdminTabs, fmtTime } from "./AdminTabs";

export function AdminUsers() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<CurrentUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: adminApi.listUsers,
  });

  const toggleActive = useMutation({
    mutationFn: (u: CurrentUser) => adminApi.updateUser(u.id, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  const del = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (err: any) => alert(err?.response?.data?.detail || "删除失败"),
  });

  const users = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
          <p className="text-sm text-ink-500 mt-1">创建账号发给朋友，管理登录与数据权限。</p>
        </div>
        <button className="btn-accent" onClick={() => setCreating(true)}>
          新建账号
        </button>
      </div>

      <AdminTabs />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">用户名</th>
              <th className="px-4 py-3 font-medium">昵称</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">最近登录</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-ink-200">
                <td className="px-4 py-3 font-medium text-ink-900">
                  {u.username}
                  {me?.id === u.id && <span className="ml-1.5 text-xs text-ink-500">(我)</span>}
                </td>
                <td className="px-4 py-3 text-ink-700">{u.display_name || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      u.role === "admin" ? "bg-accent/10 text-accent-hover" : "bg-ink-100 text-ink-700"
                    }`}
                  >
                    {u.role === "admin" ? "管理员" : "普通用户"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      u.is_active ? "bg-green-50 text-success" : "bg-red-50 text-danger"
                    }`}
                  >
                    {u.is_active ? "启用" : "已禁用"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(u.last_login_at)}</td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5 text-xs"
                      onClick={() => setResetTarget(u)}
                    >
                      重置密码
                    </button>
                    {me?.id !== u.id && (
                      <>
                        <button
                          className="btn-ghost px-2 py-1.5 text-xs"
                          onClick={() => toggleActive.mutate(u)}
                        >
                          {u.is_active ? "禁用" : "启用"}
                        </button>
                        <button
                          className="btn-ghost px-2 py-1.5 text-xs text-danger hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`删除账号「${u.username}」？名下有数据时会被拒绝。`))
                              del.mutate(u.id);
                          }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({ username, password, display_name: displayName, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      setError("");
    },
    onError: (err: any) => setError(err?.response?.data?.detail || "创建失败"),
  });

  if (!open) return null;

  function genPassword() {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let pw = "";
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setPassword(pw);
  }

  function submit() {
    setError("");
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(username)) {
      setError("用户名 2-64 位，仅限字母、数字、_ . -");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold">新建账号</h2>
        <div>
          <label className="label">用户名（登录用）</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="如 zhangsan"
          />
        </div>
        <div>
          <label className="label">昵称（可选）</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="如 张三"
          />
        </div>
        <div>
          <label className="label">初始密码</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
            <button className="btn-ghost border border-ink-200 shrink-0" onClick={genPassword}>
              随机
            </button>
          </div>
        </div>
        <div>
          <label className="label">角色</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as "user" | "admin")}
          >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-ink-200" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
}: {
  user: CurrentUser | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const reset = useMutation({
    mutationFn: () => adminApi.updateUser(user!.id, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
      setPassword("");
      setError("");
    },
    onError: (err: any) => setError(err?.response?.data?.detail || "重置失败"),
  });

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold">重置密码 — {user.username}</h2>
        <div>
          <label className="label">新密码</label>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
          />
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-ink-200" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              if (password.length < 6) {
                setError("密码至少 6 位");
                return;
              }
              reset.mutate();
            }}
            disabled={reset.isPending}
          >
            {reset.isPending ? "提交中…" : "确认重置"}
          </button>
        </div>
      </div>
    </div>
  );
}
