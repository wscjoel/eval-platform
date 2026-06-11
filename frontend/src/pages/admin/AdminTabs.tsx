import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/admin", label: "数据总览", end: true },
  { to: "/admin/users", label: "用户管理" },
  { to: "/admin/logins", label: "登录记录" },
];

export function AdminTabs() {
  return (
    <div className="flex items-center gap-1 border-b border-ink-200">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-ink-900 text-ink-900"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

export function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s + (s.endsWith("Z") ? "" : "Z")).toLocaleString();
}
