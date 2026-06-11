import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ApiKeyBar } from "./ApiKeyBar";
import { DEFAULT_GW_URL, PROXY_GW_URL, settings } from "../local/settings";

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [gwUrl, setGwUrl] = useState(() => settings.gatewayUrl());
  const [models, setModels] = useState(() => settings.models().join("\n"));
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  function save() {
    settings.setGatewayUrl(gwUrl);
    settings.setModels(models);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
      <div className="card w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">LLM 网关设置</h2>
        <p className="text-xs text-ink-500">
          所有配置与数据只保存在你自己的浏览器本地。
        </p>
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800 leading-relaxed">
          浏览器无法直接调用内网 HTTP 网关（安全限制）。请先运行随仓库提供的
          <b> 本机转发小工具</b>（见 <code className="font-mono">proxy/</code> 目录），
          再把网关地址填成代理地址。详见 <code className="font-mono">proxy/README.md</code>。
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">网关地址（OpenAI Chat Completions 兼容）</label>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setGwUrl(PROXY_GW_URL)}
            >
              填入本地代理地址
            </button>
          </div>
          <input
            className="input w-full"
            value={gwUrl}
            onChange={(e) => setGwUrl(e.target.value)}
            placeholder={DEFAULT_GW_URL}
          />
        </div>
        <div>
          <label className="label">可选模型（每行一个）</label>
          <textarea
            className="input w-full h-28 font-mono text-xs"
            value={models}
            onChange={(e) => setModels(e.target.value)}
          />
        </div>
        {saved && <div className="text-sm text-success">已保存</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-ink-200" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
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
            <ApiKeyBar />
            <button
              className="btn-ghost border border-ink-200"
              onClick={() => setSettingsOpen(true)}
              title="LLM 网关设置"
            >
              设置
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-ink-500">
        客服AI评测台 · 数据仅保存在你的浏览器本地
      </footer>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
