type Props = {
  template: string;
  columns: string[];
};

type Segment =
  | { type: "text"; v: string }
  | { type: "var"; v: string; known: boolean };

function parse(template: string, cols: Set<string>): Segment[] {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push({ type: "text", v: template.slice(last, m.index) });
    out.push({ type: "var", v: m[1].trim(), known: cols.has(m[1].trim()) });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push({ type: "text", v: template.slice(last) });
  return out;
}

export function PromptPreview({ template, columns }: Props) {
  const cols = new Set(columns);
  const segs = parse(template, cols);
  const known = segs.filter((s) => s.type === "var" && s.known).length;
  const unknown = segs.filter((s) => s.type === "var" && !s.known).length;

  return (
    <div className="space-y-2">
      <div className="border border-ink-200 rounded-md bg-ink-50 p-3 font-mono text-[12.5px] leading-6 whitespace-pre-wrap break-words min-h-[44px]">
        {segs.length === 0 ? (
          <span className="text-ink-500">预览将在此显示…</span>
        ) : (
          segs.map((s, i) =>
            s.type === "text" ? (
              <span key={i}>{s.v}</span>
            ) : s.known ? (
              <span
                key={i}
                className="mx-0.5 px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-200"
                title="已识别列"
              >
                {s.v}
              </span>
            ) : (
              <span
                key={i}
                className="mx-0.5 px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
                title="数据集中无此列"
              >
                {s.v}
              </span>
            )
          )
        )}
      </div>
      <div className="text-[11px] text-ink-500 flex items-center gap-3">
        <span className="text-green-700">已识别 {known}</span>
        <span className="text-red-600">未知 {unknown}</span>
      </div>
    </div>
  );
}

export function getUsedColumns(template: string): Set<string> {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) out.add(m[1].trim());
  return out;
}
