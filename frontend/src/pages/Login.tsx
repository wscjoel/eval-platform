import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const user = await authApi.login(username.trim(), password);
      qc.setQueryData(["auth", "me"], user);
      const next = params.get("next");
      navigate(next && next.startsWith("/") ? next : "/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail || "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-ink-900 text-white text-lg font-semibold mb-3">
            AI
          </span>
          <h1 className="text-xl font-semibold tracking-tight">客服AI评测台</h1>
          <p className="text-sm text-ink-500 mt-1">请使用管理员分配的账号登录</p>
        </div>

        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label" htmlFor="login-username">
              用户名
            </label>
            <input
              id="login-username"
              className="input"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
            />
          </div>
          <div>
            <label className="label" htmlFor="login-password">
              密码
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
          </div>
          {error && (
            <div className="text-sm text-danger bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="text-center text-xs text-ink-500 mt-6">
          没有账号？请联系管理员开通。
        </p>
      </div>
    </div>
  );
}
