import { IconCheck, IconClock, IconRefresh, IconStop, IconX } from "./Icon";

type Status =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "success"
  | "parse_error"
  | "stopping"
  | "stopped";

const meta: Record<Status, { label: string; cls: string; icon: JSX.Element }> = {
  pending:    { label: "等待",     cls: "bg-ink-100 text-ink-700",                icon: <IconClock className="w-3 h-3" /> },
  running:    { label: "运行中",   cls: "bg-amber-50 text-amber-700",             icon: <IconRefresh className="w-3 h-3 animate-spin" /> },
  done:       { label: "已完成",   cls: "bg-green-50 text-green-700",             icon: <IconCheck className="w-3 h-3" /> },
  failed:     { label: "失败",     cls: "bg-red-50 text-red-700",                 icon: <IconX className="w-3 h-3" /> },
  success:    { label: "成功",     cls: "bg-green-50 text-green-700",             icon: <IconCheck className="w-3 h-3" /> },
  parse_error:{ label: "解析失败", cls: "bg-amber-50 text-amber-700",             icon: <IconX className="w-3 h-3" /> },
  stopping:   { label: "停止中",   cls: "bg-ink-100 text-ink-700",                icon: <IconRefresh className="w-3 h-3 animate-spin" /> },
  stopped:    { label: "已停止",   cls: "bg-ink-100 text-ink-700",                icon: <IconStop className="w-3 h-3" /> },
};

export function StatusBadge({ status }: { status: string }) {
  const m = meta[status as Status] || { label: status, cls: "bg-ink-100 text-ink-700", icon: <></> };
  return (
    <span className={`badge ${m.cls}`}>
      {m.icon}
      <span>{m.label}</span>
    </span>
  );
}
