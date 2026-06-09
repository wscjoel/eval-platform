import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, apiKeyStore, ResultOut, ResultsPage, TaskOut, taskApi } from "../api/client";
import {
  IconArrowLeft,
  IconChart,
  IconCheck,
  IconChevronRight,
  IconDoc,
  IconDownload,
  IconEye,
  IconRefresh,
  IconStop,
} from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";

const STATUS_FILTERS = [
  { v: "", label: "全部" },
  { v: "success", label: "成功" },
  { v: "parse_error", label: "解析失败" },
  { v: "failed", label: "失败" },
];

export function TaskDetail() {
  const { id } = useParams();
  const taskId = Number(id);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const taskQ = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => (await api.get<TaskOut>(`/tasks/${taskId}`)).data,
    refetchInterval: (q) => {
      const d = q.state.data as TaskOut | undefined;
      return d && (d.status === "running" || d.status === "pending" || d.status === "stopping")
        ? 2000
        : false;
    },
  });

  const resultsQ = useQuery({
    queryKey: ["results", taskId, status],
    queryFn: async () =>
      (await api.get<ResultsPage>(`/tasks/${taskId}/results`, {
        params: { status: status || undefined, limit: 500 },
      })).data,
    refetchInterval: (q) => {
      const t = taskQ.data;
      return t && (t.status === "running" || t.status === "pending" || t.status === "stopping")
        ? 3000
        : false;
    },
  });

  const retry = useMutation({
    mutationFn: async (row: number) =>
      api.post(`/tasks/${taskId}/retry/${row}`, null, { params: { api_key: apiKeyStore.get() || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["results", taskId] });
      qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const stop = useMutation({
    mutationFn: async () => taskApi.stop(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const task = taskQ.data;
  const results = resultsQ.data;
  const avgLatency = useMemo(() => {
    if (!results || results.items.length === 0) return 0;
    const arr = results.items.filter((r) => r.latency_ms > 0).map((r) => r.latency_ms);
    if (!arr.length) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }, [results]);

  if (!task) return <div className="text-ink-500">加载中…</div>;

  const inputCols = results && results.items.length > 0 ? Object.keys(results.items[0].input_json) : [];
  const parsedKeys = results?.parsed_keys || [];
  const pct = task.total === 0 ? 0 : Math.round((task.processed / task.total) * 100);

  return (
    <div className="space-y-6">
      <div className="text-xs text-ink-500 flex items-center gap-1">
        <Link to="/" className="hover:text-ink-900 transition-colors">任务</Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-ink-700">{task.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/" className="btn-ghost !px-1.5 !py-1 text-ink-500" title="返回任务记录">
              <IconArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{task.name}</h1>
            <StatusBadge status={task.status} />
          </div>
          <div className="text-sm text-ink-500 mt-1">
            模型 <span className="text-ink-700">{task.model}</span> · temperature {task.temperature}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(task.status === "running" ||
            task.status === "pending" ||
            task.status === "stopping") && (
            <button
              className="btn-danger"
              onClick={() => stop.mutate()}
              disabled={task.status === "stopping" || stop.isPending}
              title={task.status === "stopping" ? "正在停止…" : "停止评测任务"}
            >
              <IconStop className="w-4 h-4" />
              {task.status === "stopping" ? "停止中…" : "停止"}
            </button>
          )}
          <a className="btn-accent" href={`/api/tasks/${task.id}/export.xlsx`}>
            <IconDownload className="w-4 h-4" />
            导出 Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="总数" value={task.total} />
        <KPI label="已完成" value={task.processed} sub={`${pct}%`} />
        <KPI label="成功" value={task.succeeded} accent="text-success" />
        <KPI label="失败" value={task.failed} accent="text-danger" sub={`平均 ${avgLatency} ms`} />
      </div>

      <div className="card p-1">
        <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
          <div className="h-full bg-ink-900 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <SummaryPanel results={results} parsedKeys={parsedKeys} />

      <ConfigPanel task={task} />

      {task.status === "failed" && task.error && (
        <div className="card p-4 border-l-4 border-l-danger text-sm text-danger">
          任务错误：{task.error}
        </div>
      )}

      <div className="card overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 border-b border-ink-200 bg-white flex items-center gap-2 text-sm flex-wrap">
          <span className="text-ink-500">筛选：</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setStatus(f.v)}
              className={`px-3 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                status === f.v
                  ? "bg-ink-900 text-white"
                  : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-500 tabular-nums">
            共 {results?.total ?? 0} 条 · 显示 {results?.items.length ?? 0} 条
          </span>
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-50 text-ink-700 text-left sticky top-0 z-[1]">
              <tr>
                <th className="px-3 py-2 font-medium w-10">#</th>
                <th className="px-3 py-2 font-medium">状态</th>
                {inputCols.map((c) => (
                  <th key={"in_" + c} className="px-3 py-2 font-medium">{c}</th>
                ))}
                {parsedKeys.map((k) => (
                  <th key={"out_" + k} className="px-3 py-2 font-medium text-accent">eval_{k}</th>
                ))}
                <th className="px-3 py-2 font-medium w-20 text-right">耗时</th>
                <th className="px-3 py-2 font-medium w-20 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {results?.items.map((r) => (
                <ResultRow
                  key={r.id}
                  r={r}
                  inputCols={inputCols}
                  parsedKeys={parsedKeys}
                  expanded={!!expanded[r.row_index]}
                  onToggle={() => setExpanded({ ...expanded, [r.row_index]: !expanded[r.row_index] })}
                  onRetry={() => retry.mutate(r.row_index)}
                  retrying={retry.isPending && retry.variables === r.row_index}
                />
              ))}
              {results && results.items.length === 0 && (
                <tr><td colSpan={3 + inputCols.length + parsedKeys.length} className="px-3 py-12 text-center text-ink-500">暂无结果</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${accent || "text-ink-900"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

type Bucket = { value: string; count: number; pct: number };
type Aggregated = { buckets: Bucket[]; total: number; nullCount: number };

function aggregate(results: ResultOut[], key: string): Aggregated {
  const successRows = results.filter((r) => r.status === "success" && r.parse_ok);
  const counts = new Map<string, number>();
  let nullCount = 0;
  for (const r of successRows) {
    const v = (r.parsed_json ?? {})[key];
    if (v == null || v === "") {
      nullCount++;
      continue;
    }
    const label = typeof v === "object" ? JSON.stringify(v) : String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = successRows.length;
  const buckets = [...counts.entries()]
    .map(([value, count]) => ({ value, count, pct: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
  return { buckets, total, nullCount };
}

function SummaryPanel({
  results,
  parsedKeys,
}: {
  results: ResultsPage | undefined;
  parsedKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const items = results?.items ?? [];

  const aggregated = useMemo(() => {
    const map: Record<string, Aggregated> = {};
    for (const k of selected) {
      map[k] = aggregate(items, k);
    }
    return map;
  }, [items, selected]);

  const toggle = (k: string) =>
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-ink-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <IconChart className="w-4 h-4 text-ink-500" />
          <span className="font-medium">评测总结（字段分布可视化）</span>
        </div>
        <span className="text-xs text-ink-500">
          {open ? "收起" : "展开"} · 已选 {selected.length} 个字段
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-200 p-5 space-y-4">
          {parsedKeys.length === 0 ? (
            <div className="text-sm text-ink-500 py-8 text-center">
              暂无可统计字段（任务还未成功解析任何输出）
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-500 mr-1">字段：</span>
                {parsedKeys.map((k) => {
                  const active = selected.includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(k)}
                      className={`px-3 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                        active
                          ? "bg-ink-900 text-white"
                          : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                      }`}
                    >
                      {k}
                    </button>
                  );
                })}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className="btn-ghost border border-ink-200 !py-1 !px-2 !text-xs"
                    onClick={() => setSelected(parsedKeys)}
                  >
                    全选
                  </button>
                  <button
                    className="btn-ghost border border-ink-200 !py-1 !px-2 !text-xs"
                    onClick={() => setSelected([])}
                  >
                    清空
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-ink-500">
                基于最近 {items.length} 条结果统计（仅成功且解析通过的行）
              </div>

              {selected.length === 0 ? (
                <div className="text-sm text-ink-500 py-8 text-center border border-dashed border-ink-200 rounded">
                  请在上方选择需要可视化的字段
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {selected.map((k) => (
                    <FieldChart key={k} fieldName={k} data={aggregated[k]} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FieldChart({ fieldName, data }: { fieldName: string; data: Aggregated }) {
  const { buckets, total, nullCount } = data;
  // When categories exceed the comfortable fit, force a wider inner area
  // so the outer overflow-x-auto enables horizontal scroll.
  const innerWidth = Math.max(420, buckets.length * 56);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="badge bg-ink-100 text-ink-700">{fieldName}</span>
        <span className="text-[11px] text-ink-500 tabular-nums">
          {buckets.length} 类 · 共 {total} 条
          {nullCount > 0 ? ` · 空值 ${nullCount} 条` : ""}
        </span>
      </div>
      {buckets.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-ink-500">
          无数据
        </div>
      ) : (
        <div className="h-64 overflow-x-auto overflow-y-hidden">
          <div style={{ minWidth: innerWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#E5E5E5" vertical={false} />
                <XAxis
                  dataKey="value"
                  tick={{ fontSize: 11, fill: "#404040" }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#737373" }} width={32} />
                <Tooltip
                  cursor={{ fill: "rgba(212,175,55,0.08)" }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #E5E5E5",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                  formatter={(v, _n, p) => {
                    const pct = (p?.payload as Bucket | undefined)?.pct ?? 0;
                    return [`${v} 条 (${(pct * 100).toFixed(1)}%)`, "数量"];
                  }}
                />
                <Bar dataKey="count" fill="#171717" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList
                    dataKey="pct"
                    position="top"
                    formatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                    style={{ fontSize: 11, fill: "#737373" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ task }: { task: TaskOut }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"prompt" | "schema" | "">("");

  const copy = async (text: string, which: "prompt" | "schema") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-ink-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <IconDoc className="w-4 h-4 text-ink-500" />
          <span className="font-medium">评测配置（当时使用的提示词与 Schema）</span>
        </div>
        <span className="text-xs text-ink-500">
          {open ? "收起" : "展开"} · 模型 {task.model} · temp {task.temperature}
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-200 p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="label !mb-0">提示词模板</div>
              <button
                className="btn-ghost border border-ink-200 !py-1 !text-xs"
                onClick={() => copy(task.prompt_template, "prompt")}
              >
                {copied === "prompt" ? <><IconCheck className="w-3.5 h-3.5" />已复制</> : "复制"}
              </button>
            </div>
            <pre className="bg-ink-50 border border-ink-200 rounded p-3 text-[12.5px] whitespace-pre-wrap break-words max-h-72 overflow-auto font-mono">
              {task.prompt_template || "—"}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="label !mb-0">JSON 输出 Schema</div>
              <button
                className="btn-ghost border border-ink-200 !py-1 !text-xs"
                onClick={() => copy(task.json_schema, "schema")}
              >
                {copied === "schema" ? <><IconCheck className="w-3.5 h-3.5" />已复制</> : "复制"}
              </button>
            </div>
            <pre className="bg-ink-50 border border-ink-200 rounded p-3 text-[12.5px] whitespace-pre-wrap break-words max-h-72 overflow-auto font-mono">
              {task.json_schema || "—"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  r, inputCols, parsedKeys, expanded, onToggle, onRetry, retrying,
}: {
  r: ResultOut;
  inputCols: string[];
  parsedKeys: string[];
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const pj = r.parsed_json || {};
  const cell = (v: unknown) => {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return (
    <>
      <tr className="border-t border-ink-200 hover:bg-ink-50/60 transition-colors align-top">
        <td className="px-3 py-2 text-ink-500 tabular-nums">{r.row_index + 1}</td>
        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
        {inputCols.map((c) => (
          <td key={c} className="px-3 py-2 max-w-[200px] truncate" title={cell(r.input_json[c])}>
            {cell(r.input_json[c])}
          </td>
        ))}
        {parsedKeys.map((k) => (
          <td key={k} className="px-3 py-2 max-w-[200px] truncate" title={cell((pj as any)[k])}>
            {cell((pj as any)[k])}
          </td>
        ))}
        <td className="px-3 py-2 text-right text-ink-500 tabular-nums">{r.latency_ms} ms</td>
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <button className="btn-ghost px-1.5 py-1" onClick={onToggle} title="查看原始输出">
              <IconEye className="w-4 h-4" />
            </button>
            <button
              className="btn-ghost px-1.5 py-1"
              onClick={onRetry}
              disabled={retrying}
              title="重试此行"
            >
              <IconRefresh className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-ink-50/70 border-t border-ink-200">
          <td colSpan={3 + inputCols.length + parsedKeys.length}>
            <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="font-semibold text-ink-700 mb-1">原始输出</div>
                <pre className="bg-white border border-ink-200 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap">{r.raw_output || "—"}</pre>
              </div>
              <div>
                <div className="font-semibold text-ink-700 mb-1">解析后 JSON</div>
                <pre className="bg-white border border-ink-200 rounded p-2 max-h-60 overflow-auto">{r.parsed_json ? JSON.stringify(r.parsed_json, null, 2) : "—"}</pre>
                {r.error && <div className="mt-2 text-danger">错误：{r.error}</div>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
