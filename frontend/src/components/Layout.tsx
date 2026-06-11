import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ApiKeyBar } from "./ApiKeyBar";

function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      qc.clear();
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-100 transition-colors"
        onClick={() => setOpen((v) => !v)}
        title={user.username}
      >
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-900 text-white text-[10px] font-semibold">
          {(user.display_name || user.username).slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm text-ink-700 max-w-[100px] truncate">
          {user.display_name || user.username}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 card py-1 z-20">
          <div className="px-3 py-2 border-b border-ink-100">
            <div className="text-sm font-medium text-ink-900 truncate">
              {user.display_name || user.username}
            </div>
            <div className="text-xs text-ink-500">
              {user.role === "admin" ? "管理员" : "普通用户"} · {user.username}
            </div>
          </div>
          <button
            className="w-full text-left px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
          >
            修改密码
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-red-50"
            onClick={logout}
          >
            退出登录
          </button>
        </div>
      )}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function submit() {
    setError("");
    if (newPw.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (newPw !== newPw2) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.changePassword(oldPw, newPw);
      setOk(true);
      setTimeout(() => {
        onClose();
        setOk(false);
        setOldPw("");
        setNewPw("");
        setNewPw2("");
      }, 1000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "修改失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold">修改密码</h2>
        <div>
          <label className="label">原密码</label>
          <input
            className="input"
            type="password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
        </div>
        <div>
          <label className="label">新密码</label>
          <input
            className="input"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
        </div>
        <div>
          <label className="label">确认新密码</label>
          <input
            className="input"
            type="password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
        {ok && <div className="text-sm text-success">修改成功</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-ink-200" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "提交中…" : "确认修改"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-ink-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-ink-900 font-semibold tracking-tight">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-ink-900 text-white text-xs">
              AI
            </span>
            <span>客服AI评测台</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <NavLink
              to="/datasets"
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              数据集管理
            </NavLink>
            <NavLink
              to="/annotate"
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              人工批注
            </NavLink>
            <NavLink
              to="/new"
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              新建评测
            </NavLink>
            <NavLink
              to="/prompts"
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              提示词管理
            </NavLink>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              任务记录
            </NavLink>
            {user?.role === "admin" && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `${isActive ? "text-accent font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
                }
              >
                管理后台
              </NavLink>
            )}
            <ApiKeyBar />
            <UserMenu />
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-ink-500">
        客服AI评测台 · Minimal
      </footer>
    </div>
  );
}
