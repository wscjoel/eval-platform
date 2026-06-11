import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

import {
  cleaningApi,
  CleaningRunResult,
  CleaningScriptTemplate,
  CleaningSource,
  DatasetOut,
  datasetsApi,
} from "../api/client";
import {
  IconArrowLeft,
  IconBroom,
  IconCheck,
  IconCode,
  IconDownload,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconX,
} from "../components/Icon";

type CleanMethod = "script" | "knowledge";
type InputMode = "text" | "table";

const DEFAULT_SCRIPT = `// 可用变量（JavaScript，在浏览器中运行）：
//   input_text  : string   — 上传文件的纯文本内容
//   input_table : object[] — 上传文件的表格内容（数组，每行一个对象）
//   mode        : "text" | "table"
// 请把清洗结果赋值给 output 变量：
//   - 字符串      → 文本结果
//   - 对象数组    → 表格结果

if (mode === "table") {
  // 示例：去除空白并按整行去重
  const seen = new Set();
  output = input_table.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
} else {
  // 示例：按行去空格并去重
  const lines = input_text.split("\\n").map((l) => l.trim()).filter(Boolean);
  output = [...new Set(lines)].join("\\n");
}
`;

export function CleaningWorkspace() {
  const [method, setMethod] = useState<CleanMethod>("script");
  const [params] = useSearchParams();
  const datasetId = params.get("dataset_id");
  const initialDatasetId = datasetId ? Number(datasetId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Link to="/datasets" className="btn-ghost !px-1.5 !py-1 text-ink-500" title="返回数据集管理">
            <IconArrowLeft className="w-4 h-4" />
          </Link>
          <IconBroom className="w-6 h-6 text-accent" />
          数据清洗
        </h1>
        <div className="text-sm text-ink-500 mt-1">
          上传或从已有数据集导入数据（Excel / CSV / TXT / Markdown / Word），通过脚本进行批量清洗，
          可下载到本地或回写到数据集列表。
        </div>
      </div>

      <MethodTabs method={method} onChange={setMethod} />

      {method === "script" ? <ScriptCleaningPanel initialDatasetId={initialDatasetId} /> : null}
    </div>
  );
}

function MethodTabs({
  method,
  onChange,
}: {
  method: CleanMethod;
  onChange: (m: CleanMethod) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-ink-200">
      <TabButton
        active={method === "script"}
        onClick={() => onChange("script")}
        label="脚本清洗"
        icon={<IconCode className="w-4 h-4" />}
      />
      <DisabledTab label="知识清洗" tooltip="开发中..." />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: JSX.Element;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 -mb-px border-b-2 flex items-center gap-2 text-sm transition-colors cursor-pointer ${
        active
          ? "border-ink-900 text-ink-900 font-semibold"
          : "border-transparent text-ink-500 hover:text-ink-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DisabledTab({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="relative group">
      <button
        type="button"
        disabled
        className="px-4 py-2 -mb-px border-b-2 border-transparent flex items-center gap-2 text-sm text-ink-500 opacity-50 cursor-not-allowed"
        title={tooltip}
      >
        <IconBroom className="w-4 h-4" />
        {label}
      </button>
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 rounded bg-ink-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-soft"
        role="tooltip"
      >
        {tooltip}
      </div>
    </div>
  );
}

// ---------------- 脚本清洗主面板 ----------------

function ScriptCleaningPanel({ initialDatasetId }: { initialDatasetId: number | null }) {
  const [source, setSource] = useState<CleaningSource | null>(null);
  const [sourceDatasetId, setSourceDatasetId] = useState<number | null>(null);
  const [code, setCode] = useState<string>(DEFAULT_SCRIPT);
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [runResult, setRunResult] = useState<CleaningRunResult | null>(null);
  const [outputTab, setOutputTab] = useState<"result" | "stdout" | "stderr" | "error">(
    "result"
  );
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showSaveDs, setShowSaveDs] = useState(false);

  const qc = useQueryClient();
  const templatesQ = useQuery({
    queryKey: ["cleaning-templates"],
    queryFn: cleaningApi.listTemplates,
  });

  // 通过 query param 自动从数据集导入
  const autoImportedRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      initialDatasetId &&
      autoImportedRef.current !== initialDatasetId &&
      !source
    ) {
      autoImportedRef.current = initialDatasetId;
      cleaningApi
        .fromDataset(initialDatasetId)
        .then((s) => {
          setSource(s);
          setSourceDatasetId(initialDatasetId);
          setInputMode("table");
          setRunResult(null);
        })
        .catch(() => {
          autoImportedRef.current = null;
        });
    }
  }, [initialDatasetId, source]);

  const runMut = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("请先上传文件");
      return cleaningApi.runScript({
        source_id: source.source_id,
        code,
        input_mode: inputMode,
      });
    },
    onSuccess: (data) => {
      setRunResult(data);
      if (!data.ok) {
        setOutputTab(data.stderr ? "stderr" : "error");
      } else {
        setOutputTab("result");
      }
    },
    onError: (err) => {
      setRunResult({
        ok: false,
        output_kind: "text",
        output_text: "",
        output_table: null,
        stdout: "",
        stderr: "",
        error: String((err as { message?: string }).message || err),
        duration_ms: 0,
      });
      setOutputTab("error");
    },
  });

  const handleSourceUpload = (next: CleaningSource | null) => {
    setSource(next);
    setSourceDatasetId(null);
    if (next) {
      setInputMode(next.kind === "table" ? "table" : "text");
    }
    setRunResult(null);
  };

  const handleDatasetImport = (s: CleaningSource, datasetId: number) => {
    setSource(s);
    setSourceDatasetId(datasetId);
    setInputMode("table");
    setRunResult(null);
  };

  const canSaveAsDataset =
    !!runResult && runResult.ok && runResult.output_kind === "table" && !!runResult.output_table;

  return (
    <div className="space-y-5">
      <UploadCard
        source={source}
        sourceDatasetId={sourceDatasetId}
        onChange={handleSourceUpload}
        onImportDataset={handleDatasetImport}
      />

      <EditorCard
        code={code}
        onCodeChange={setCode}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
        sourceKind={source?.kind ?? null}
        templates={templatesQ.data ?? []}
        onApplyTemplate={(tpl) => {
          setCode(tpl.code);
          setInputMode(tpl.input_mode);
        }}
        onDeleteTemplate={async (id) => {
          await cleaningApi.deleteTemplate(id);
          qc.invalidateQueries({ queryKey: ["cleaning-templates"] });
        }}
        onSaveAsTemplate={() => setShowSaveTpl(true)}
        onRun={() => runMut.mutate()}
        running={runMut.isPending}
        disabled={!source}
      />

      <OutputCard
        result={runResult}
        running={runMut.isPending}
        activeTab={outputTab}
        onTabChange={setOutputTab}
        sourceFilename={source?.filename}
        canSaveAsDataset={canSaveAsDataset}
        onSaveAsDataset={() => setShowSaveDs(true)}
      />

      {showSaveTpl && (
        <SaveTemplateModal
          initialCode={code}
          initialMode={inputMode}
          onClose={() => setShowSaveTpl(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["cleaning-templates"] });
            setShowSaveTpl(false);
          }}
        />
      )}

      {showSaveDs && runResult && runResult.ok && runResult.output_table && (
        <SaveAsDatasetModal
          rows={runResult.output_table}
          defaultDatasetId={sourceDatasetId}
          defaultName={(source?.filename || "cleaned").replace(/\.[^.]+$/, "") + "_cleaned"}
          onClose={() => setShowSaveDs(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["datasets"] });
            setShowSaveDs(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------- 1. 上传卡片 ----------------

const ACCEPT_EXTS = [".xlsx", ".xls", ".csv", ".txt", ".md", ".markdown", ".docx"];

function UploadCard({
  source,
  sourceDatasetId,
  onChange,
  onImportDataset,
}: {
  source: CleaningSource | null;
  sourceDatasetId: number | null;
  onChange: (s: CleaningSource | null) => void;
  onImportDataset: (s: CleaningSource, datasetId: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: cleaningApi.upload,
    onSuccess: (data) => {
      setUploadErr("");
      onChange(data);
    },
    onError: (err: { response?: { data?: { detail?: string } }; message?: string }) => {
      const msg = err?.response?.data?.detail || err?.message || "上传失败";
      setUploadErr(msg);
    },
  });

  const accept = useMemo(() => ACCEPT_EXTS.join(","), []);

  const handleFile = (f: File | undefined | null) => {
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPT_EXTS.includes(ext)) {
      setUploadErr(`不支持的文件类型：${ext}。请使用 ${ACCEPT_EXTS.join(" / ")}`);
      return;
    }
    uploadMut.mutate(f);
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-ink-900 text-white text-xs">
            1
          </span>
          <span className="font-medium">选择数据来源</span>
          {sourceDatasetId != null && (
            <span className="badge bg-amber-50 text-amber-800 ml-1">
              已绑定数据集 #{sourceDatasetId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!source && (
            <button
              onClick={() => setShowPicker(true)}
              className="btn-ghost border border-ink-200 !py-1 !text-xs"
              title="从已有评测数据集导入"
            >
              <IconPlus className="w-3.5 h-3.5" />
              从现有数据集导入
            </button>
          )}
          {source && (
            <button
              onClick={() => {
                onChange(null);
                setUploadErr("");
              }}
              className="btn-ghost border border-ink-200 !py-1 !text-xs"
              title="移除当前文件"
            >
              <IconX className="w-3.5 h-3.5" />
              移除
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {!source && (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              handleFile(file);
            }}
            className={`flex flex-col items-center justify-center gap-2 px-6 py-10 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragging
                ? "border-accent bg-accent/5"
                : "border-ink-200 hover:border-ink-700 hover:bg-ink-50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {uploadMut.isPending ? (
              <>
                <IconRefresh className="w-6 h-6 text-ink-500 animate-spin" />
                <div className="text-sm text-ink-700">上传中…</div>
              </>
            ) : (
              <>
                <IconUpload className="w-6 h-6 text-ink-500" />
                <div className="text-sm text-ink-700">
                  点击或拖拽文件到此处上传
                </div>
                <div className="text-xs text-ink-500">
                  支持 {ACCEPT_EXTS.join(" / ")}，单文件 &lt; 10MB
                </div>
                <div className="text-[11px] text-ink-500 mt-1">
                  或在右上角选择「从现有数据集导入」
                </div>
              </>
            )}
          </label>
        )}

        {uploadErr && (
          <div className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
            {uploadErr}
          </div>
        )}

        {source && <FilePreview source={source} />}
      </div>

      {showPicker && (
        <DatasetPickerModal
          onClose={() => setShowPicker(false)}
          onPicked={(s, id) => {
            onImportDataset(s, id);
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}

function DatasetPickerModal({
  onClose,
  onPicked,
}: {
  onClose: () => void;
  onPicked: (s: CleaningSource, datasetId: number) => void;
}) {
  const listQ = useQuery({ queryKey: ["datasets"], queryFn: datasetsApi.list });
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const handlePick = async (d: DatasetOut) => {
    try {
      setErr("");
      setLoadingId(d.id);
      const s = await cleaningApi.fromDataset(d.id);
      onPicked(s, d.id);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "导入失败");
    } finally {
      setLoadingId(null);
    }
  };

  const datasets = listQ.data || [];

  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold">从现有数据集导入</div>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-900 cursor-pointer"
            title="关闭"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-ink-500">
          选择一个数据集导入到清洗工作台（仅支持表格类）。导入后默认绑定该数据集，运行后可一键覆盖回写。
        </div>

        <div className="border border-ink-200 rounded max-h-[50vh] overflow-auto">
          {listQ.isLoading && (
            <div className="px-3 py-6 text-center text-sm text-ink-500">加载中…</div>
          )}
          {!listQ.isLoading && datasets.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-500">
              暂无数据集
            </div>
          )}
          {datasets.map((d) => (
            <button
              key={d.id}
              onClick={() => handlePick(d)}
              disabled={loadingId === d.id}
              className="w-full text-left px-3 py-2 border-b border-ink-200 last:border-b-0 hover:bg-ink-50 cursor-pointer transition-colors flex items-start justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-900 truncate" title={d.name}>
                  {d.name}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {d.rows} 行 · {d.columns.length} 列
                </div>
              </div>
              <span className="text-[11px] text-ink-500">
                {loadingId === d.id ? (
                  <IconRefresh className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "导入"
                )}
              </span>
            </button>
          ))}
        </div>

        {err && (
          <div className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button className="btn-ghost border border-ink-200" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function FilePreview({ source }: { source: CleaningSource }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="badge bg-ink-100 text-ink-700">{source.kind === "table" ? "表格" : "文本"}</span>
          <span className="text-ink-900 font-medium truncate" title={source.filename}>
            {source.filename}
          </span>
        </div>
        <div className="text-xs text-ink-500 tabular-nums">
          {source.kind === "table"
            ? `${source.total_rows} 行 · ${source.columns.length} 列`
            : `${source.text.length.toLocaleString()} 字符`}
        </div>
      </div>

      {source.kind === "table" ? (
        <div className="border border-ink-200 rounded overflow-hidden">
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-ink-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium w-10 text-ink-500">#</th>
                  {source.columns.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-left font-medium text-ink-700">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {source.preview_table.map((row, i) => (
                  <tr key={i} className="border-t border-ink-200">
                    <td className="px-2 py-1 text-ink-500 tabular-nums">{i + 1}</td>
                    {source.columns.map((c) => {
                      const v = row[c];
                      const text = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
                      return (
                        <td
                          key={c}
                          className="px-2 py-1 max-w-[260px] truncate"
                          title={text}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {source.total_rows > source.preview_table.length && (
            <div className="px-2 py-1 text-[11px] text-ink-500 bg-ink-50 border-t border-ink-200">
              预览前 {source.preview_table.length} 行，共 {source.total_rows} 行
            </div>
          )}
        </div>
      ) : (
        <div className="border border-ink-200 rounded">
          <pre className="bg-ink-50 p-3 text-[12.5px] max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">
            {source.preview_text || "(空文件)"}
          </pre>
          {source.text.length > source.preview_text.length && (
            <div className="px-2 py-1 text-[11px] text-ink-500 bg-ink-50 border-t border-ink-200">
              已截断显示前 {source.preview_text.length.toLocaleString()} 字符，共{" "}
              {source.text.length.toLocaleString()} 字符
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- 2. 编辑卡片 ----------------

function EditorCard({
  code,
  onCodeChange,
  inputMode,
  onInputModeChange,
  sourceKind,
  templates,
  onApplyTemplate,
  onDeleteTemplate,
  onSaveAsTemplate,
  onRun,
  running,
  disabled,
}: {
  code: string;
  onCodeChange: (s: string) => void;
  inputMode: InputMode;
  onInputModeChange: (m: InputMode) => void;
  sourceKind: "table" | "text" | null;
  templates: CleaningScriptTemplate[];
  onApplyTemplate: (t: CleaningScriptTemplate) => void;
  onDeleteTemplate: (id: number) => Promise<void>;
  onSaveAsTemplate: () => void;
  onRun: () => void;
  running: boolean;
  disabled: boolean;
}) {
  const [tplOpen, setTplOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-ink-900 text-white text-xs">
            2
          </span>
          <span className="font-medium">编辑 JavaScript 脚本</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setTplOpen((v) => !v)}
              className="btn-ghost border border-ink-200 !py-1 !text-xs"
            >
              <IconCode className="w-3.5 h-3.5" />
              模版 ({templates.length})
            </button>
            {tplOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-ink-200 rounded-md shadow-soft z-10 max-h-72 overflow-auto">
                {templates.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-ink-500 text-center">
                    暂无模版，点击右侧"保存为模版"添加
                  </div>
                ) : (
                  templates.map((t) => (
                    <div
                      key={t.id}
                      className="px-3 py-2 border-b border-ink-200 last:border-b-0 hover:bg-ink-50 flex items-start justify-between gap-2 group"
                    >
                      <button
                        onClick={() => {
                          onApplyTemplate(t);
                          setTplOpen(false);
                        }}
                        className="flex-1 text-left cursor-pointer"
                      >
                        <div className="text-sm font-medium text-ink-900 truncate" title={t.name}>
                          {t.name}
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">
                          {t.description || "无描述"}
                        </div>
                        <div className="text-[10px] text-ink-500 mt-1">
                          <span className="badge bg-ink-100 text-ink-700 !px-1.5">
                            {t.input_mode === "table" ? "表格" : "文本"}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`确认删除模版 "${t.name}"？`)) return;
                          await onDeleteTemplate(t.id);
                        }}
                        className="text-ink-500 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity p-1 cursor-pointer"
                        title="删除模版"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={onSaveAsTemplate}
            className="btn-ghost border border-ink-200 !py-1 !text-xs"
          >
            保存为模版
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        <div className="border-b lg:border-b-0 lg:border-r border-ink-200">
          <CodeMirror
            value={code}
            height="380px"
            theme={oneDark}
            extensions={[javascript()]}
            onChange={(v) => onCodeChange(v)}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              tabSize: 4,
            }}
          />
        </div>
        <div className="p-4 text-xs text-ink-700 space-y-3">
          <div>
            <div className="label">输入模式</div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="input-mode"
                  checked={inputMode === "text"}
                  onChange={() => onInputModeChange("text")}
                />
                <span>纯文本（input_text）</span>
              </label>
              <label
                className={`flex items-center gap-2 ${
                  sourceKind === "text" ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="input-mode"
                  checked={inputMode === "table"}
                  onChange={() => onInputModeChange("table")}
                  disabled={sourceKind === "text"}
                />
                <span>表格批量（input_table）</span>
              </label>
            </div>
            {sourceKind === "text" && (
              <div className="text-[11px] text-ink-500 mt-1">
                当前文件为纯文本，表格模式不可用
              </div>
            )}
          </div>
          <div className="border-t border-ink-200 pt-3">
            <div className="label">使用说明</div>
            <ul className="space-y-1 leading-relaxed text-[11.5px] text-ink-700">
              <li>· <code className="font-mono bg-ink-100 px-1 rounded">input_text</code> 上传文件的文本内容（string）</li>
              <li>· <code className="font-mono bg-ink-100 px-1 rounded">input_table</code> 上传文件的表格（对象数组）</li>
              <li>· <code className="font-mono bg-ink-100 px-1 rounded">console.log</code> 输出会显示在运行日志中</li>
              <li>· 结果赋值给 <code className="font-mono bg-ink-100 px-1 rounded">output</code>（string / 对象数组）</li>
              <li>· 最大运行 30 秒，代码 ≤ 50KB</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-ink-200 flex items-center justify-between flex-wrap gap-2">
        <div className="text-[11px] text-ink-500">超时 30s · Web Worker 隔离</div>
        <button
          onClick={onRun}
          disabled={disabled || running}
          className="btn-primary"
          title={disabled ? "请先上传文件" : "运行脚本"}
        >
          {running ? (
            <IconRefresh className="w-4 h-4 animate-spin" />
          ) : (
            <IconPlay className="w-4 h-4" />
          )}
          {running ? "运行中…" : "运行"}
        </button>
      </div>
    </div>
  );
}

// ---------------- 3. 输出卡片 ----------------

function OutputCard({
  result,
  running,
  activeTab,
  onTabChange,
  sourceFilename,
  canSaveAsDataset,
  onSaveAsDataset,
}: {
  result: CleaningRunResult | null;
  running: boolean;
  activeTab: "result" | "stdout" | "stderr" | "error";
  onTabChange: (t: "result" | "stdout" | "stderr" | "error") => void;
  sourceFilename?: string;
  canSaveAsDataset?: boolean;
  onSaveAsDataset?: () => void;
}) {
  const downloadMut = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("无结果可下载");
      const base = (sourceFilename || "cleaned").replace(/\.[^.]+$/, "");
      const { blob, filename } = await cleaningApi.download({
        output_kind: result.output_kind,
        output_text: result.output_text,
        output_table: result.output_table,
        filename: `${base}_cleaned`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-ink-900 text-white text-xs">
            3
          </span>
          <span className="font-medium">运行输出</span>
          {result && (
            <span className="text-[11px] text-ink-500 tabular-nums ml-2">
              · 耗时 {result.duration_ms} ms
            </span>
          )}
          {result && (result.ok ? (
            <span className="badge bg-green-50 text-green-700">
              <IconCheck className="w-3 h-3" /> 成功
            </span>
          ) : (
            <span className="badge bg-red-50 text-red-700">
              <IconX className="w-3 h-3" /> 失败
            </span>
          ))}
        </div>
        {result && result.ok && (
          <div className="flex items-center gap-2">
            {canSaveAsDataset && onSaveAsDataset && (
              <button
                onClick={onSaveAsDataset}
                className="btn-ghost border border-ink-200 !py-1.5 !text-xs"
                title="把结果保存到数据集列表"
              >
                <IconPlus className="w-3.5 h-3.5" />
                保存为数据集
              </button>
            )}
            <button
              onClick={() => downloadMut.mutate()}
              disabled={downloadMut.isPending}
              className="btn-accent !py-1.5 !text-xs"
            >
              {downloadMut.isPending ? (
                <IconRefresh className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <IconDownload className="w-3.5 h-3.5" />
              )}
              下载本地（{result.output_kind === "table" ? ".xlsx" : ".txt"}）
            </button>
          </div>
        )}
      </div>

      {!result && !running && (
        <div className="px-5 py-10 text-center text-sm text-ink-500">
          上方完成上传与脚本后点击「运行」查看清洗结果
        </div>
      )}
      {running && !result && (
        <div className="px-5 py-10 text-center text-sm text-ink-500 flex items-center justify-center gap-2">
          <IconRefresh className="w-4 h-4 animate-spin" />
          脚本运行中…
        </div>
      )}

      {result && (
        <>
          <div className="px-5 border-b border-ink-200 flex items-center gap-1 flex-wrap">
            {[
              { v: "result", label: "清洗结果" },
              { v: "stdout", label: "stdout" },
              { v: "stderr", label: "stderr" },
              { v: "error", label: "报错" },
            ].map((t) => {
              const active = activeTab === (t.v as typeof activeTab);
              return (
                <button
                  key={t.v}
                  onClick={() => onTabChange(t.v as typeof activeTab)}
                  className={`px-3 py-2 -mb-px text-xs border-b-2 transition-colors cursor-pointer ${
                    active
                      ? "border-ink-900 text-ink-900 font-semibold"
                      : "border-transparent text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="p-5">
            {activeTab === "result" && <ResultPreview result={result} />}
            {activeTab === "stdout" && <LogPane text={result.stdout || "(无输出)"} />}
            {activeTab === "stderr" && (
              <LogPane text={result.stderr || "(无 stderr)"} tone={result.stderr ? "warn" : "muted"} />
            )}
            {activeTab === "error" && (
              <LogPane
                text={result.error || "(无错误)"}
                tone={result.error ? "danger" : "muted"}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ResultPreview({ result }: { result: CleaningRunResult }) {
  if (!result.ok) {
    return (
      <div className="text-sm text-ink-500">
        脚本运行失败，请到 stderr / 报错 标签查看详情。
      </div>
    );
  }
  if (result.output_kind === "table") {
    const rows = result.output_table || [];
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    if (rows.length === 0) {
      return <div className="text-sm text-ink-500">(空表格)</div>;
    }
    return (
      <div className="border border-ink-200 rounded overflow-hidden">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-ink-50 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-10 text-ink-500">#</th>
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-left font-medium text-ink-700">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-ink-200">
                  <td className="px-2 py-1 text-ink-500 tabular-nums">{i + 1}</td>
                  {cols.map((c) => {
                    const v = row[c];
                    const text = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
                    return (
                      <td key={c} className="px-2 py-1 max-w-[260px] truncate" title={text}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-2 py-1 text-[11px] text-ink-500 bg-ink-50 border-t border-ink-200">
          共 {rows.length} 行 · {cols.length} 列
        </div>
      </div>
    );
  }
  return (
    <pre className="bg-ink-50 border border-ink-200 rounded p-3 text-[12.5px] whitespace-pre-wrap break-words max-h-[60vh] overflow-auto font-mono">
      {result.output_text || "(空文本)"}
    </pre>
  );
}

function LogPane({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" | "danger" }) {
  const cls =
    tone === "danger"
      ? "bg-red-50 border-red-200 text-red-700"
      : tone === "warn"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-ink-50 border-ink-200 text-ink-700";
  return (
    <pre
      className={`border rounded p-3 text-[12.5px] whitespace-pre-wrap break-words max-h-[50vh] overflow-auto font-mono ${cls}`}
    >
      {text}
    </pre>
  );
}

// ---------------- 保存为数据集弹窗 ----------------

function SaveAsDatasetModal({
  rows,
  defaultDatasetId,
  defaultName,
  onClose,
  onSaved,
}: {
  rows: Record<string, unknown>[];
  defaultDatasetId: number | null;
  defaultName: string;
  onClose: () => void;
  onSaved: (ds: { id: number; name: string }) => void;
}) {
  const nav = useNavigate();
  const [mode, setMode] = useState<"overwrite" | "new">(
    defaultDatasetId != null ? "overwrite" : "new"
  );
  const [overwriteId, setOverwriteId] = useState<number | null>(defaultDatasetId);
  const [name, setName] = useState(defaultName);
  const [err, setErr] = useState("");

  const listQ = useQuery({ queryKey: ["datasets"], queryFn: datasetsApi.list });

  const mut = useMutation({
    mutationFn: async () => {
      if (mode === "overwrite") {
        if (overwriteId == null) throw new Error("请选择要覆盖的数据集");
        return datasetsApi.replace(overwriteId, { rows });
      }
      const trimmed = name.trim();
      if (!trimmed) throw new Error("请输入新数据集名称");
      return datasetsApi.createFromCleaning({ name: trimmed, rows });
    },
    onSuccess: (data) => {
      onSaved({ id: data.id, name: data.name });
    },
    onError: (e: { response?: { data?: { detail?: string } }; message?: string }) => {
      setErr(e?.response?.data?.detail || e?.message || "保存失败");
    },
  });

  const datasets = listQ.data || [];

  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold">保存清洗结果为数据集</div>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-900 cursor-pointer"
            title="关闭"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-ink-500">
          清洗结果 {rows.length} 行 · {rows.length > 0 ? Object.keys(rows[0]).length : 0} 列
        </div>

        <div className="space-y-2">
          <label
            className={`block border rounded-md p-3 cursor-pointer transition-colors ${
              mode === "overwrite"
                ? "border-ink-900 bg-ink-50"
                : "border-ink-200 hover:border-ink-700"
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="save-mode"
                checked={mode === "overwrite"}
                onChange={() => setMode("overwrite")}
              />
              <span className="font-medium">覆盖已有数据集</span>
            </div>
            {mode === "overwrite" && (
              <div className="mt-2">
                <select
                  className="input"
                  value={overwriteId ?? ""}
                  onChange={(e) =>
                    setOverwriteId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">请选择数据集…</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{d.rows} 行 · {d.columns.length} 列）
                    </option>
                  ))}
                </select>
                <div className="text-[11px] text-ink-500 mt-1.5">
                  注意：已被评测任务引用的数据集无法直接覆盖，请使用「另存为新数据集」。
                </div>
              </div>
            )}
          </label>

          <label
            className={`block border rounded-md p-3 cursor-pointer transition-colors ${
              mode === "new"
                ? "border-ink-900 bg-ink-50"
                : "border-ink-200 hover:border-ink-700"
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="save-mode"
                checked={mode === "new"}
                onChange={() => setMode("new")}
              />
              <span className="font-medium">另存为新数据集</span>
            </div>
            {mode === "new" && (
              <div className="mt-2">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="新数据集名称"
                  autoFocus
                />
              </div>
            )}
          </label>
        </div>

        {err && (
          <div className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            className="btn-ghost border border-ink-200"
            onClick={() => {
              onClose();
              nav("/datasets");
            }}
          >
            前往数据集管理
          </button>
          <button
            className="btn-primary"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <IconRefresh className="w-4 h-4 animate-spin" />
            ) : (
              <IconCheck className="w-4 h-4" />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 保存模版弹窗 ----------------

function SaveTemplateModal({
  initialCode,
  initialMode,
  onClose,
  onSaved,
}: {
  initialCode: string;
  initialMode: InputMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("请填写模版名称");
      return cleaningApi.createTemplate({
        name: name.trim(),
        description: description.trim(),
        code: initialCode,
        input_mode: initialMode,
      });
    },
    onSuccess: onSaved,
    onError: (e: { response?: { data?: { detail?: string } }; message?: string }) => {
      setErr(e?.response?.data?.detail || e?.message || "保存失败");
    },
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold">保存为脚本模版</div>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
        <div>
          <div className="label">名称 *</div>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：去重并 trim"
            autoFocus
          />
        </div>
        <div>
          <div className="label">描述</div>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选：写一句话说明这个脚本干什么"
          />
        </div>
        <div className="text-[11px] text-ink-500">
          输入模式：{initialMode === "table" ? "表格批量" : "纯文本"}
        </div>
        {err && (
          <div className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost border border-ink-200">
            取消
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="btn-primary"
          >
            {mut.isPending ? <IconRefresh className="w-4 h-4 animate-spin" /> : <IconCheck className="w-4 h-4" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
