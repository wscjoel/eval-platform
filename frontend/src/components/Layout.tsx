import { Link, NavLink, Outlet } from "react-router-dom";
import { ApiKeyBar } from "./ApiKeyBar";

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-ink-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-ink-900 font-semibold tracking-tight">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-ink-900 text-white text-xs">
              LE
            </span>
            <span>LLM 评测平台</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <NavLink
              to="/cleaning"
              className={({ isActive }) =>
                `${isActive ? "text-ink-900 font-semibold" : "text-ink-700 hover:text-ink-900"} transition-colors`
              }
            >
              数据/知识清洗
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
            <ApiKeyBar />
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-ink-500">
        LLM Eval Platform · Minimal
      </footer>
    </div>
  );
}
