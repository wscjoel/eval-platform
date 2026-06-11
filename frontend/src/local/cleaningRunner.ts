/**
 * 浏览器内清洗脚本执行（Web Worker 跑 JavaScript）。
 *
 * 替代原后端 subprocess 跑 Python 的方案。约定与原来对齐：
 * - 注入 input_text（字符串）、input_table（数组 of 对象）、mode
 * - 用户脚本给 `output` 赋值：字符串 → 文本输出；数组 of 对象 → 表格输出
 * - console.log 输出收集为 stdout；超时强制终止 Worker
 */

export type CleaningRunOutput = {
  ok: boolean;
  output_kind: "text" | "table";
  output_text: string;
  output_table: Record<string, unknown>[] | null;
  stdout: string;
  stderr: string;
  error: string;
  duration_ms: number;
};

const MAX_CODE_BYTES = 50 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

// Worker 内执行的壳代码（Blob URL 方式创建，避免单独文件与打包路径问题）
const WORKER_SOURCE = `
self.onmessage = function (ev) {
  var payload = ev.data;
  var logs = [];
  var origLog = console.log;
  console.log = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      try {
        parts.push(typeof a === "string" ? a : JSON.stringify(a));
      } catch (e) {
        parts.push(String(a));
      }
    }
    logs.push(parts.join(" "));
  };

  function normalize(out) {
    if (out === null || out === undefined) return { kind: "text", text: "", table: null };
    if (Array.isArray(out)) {
      if (out.length === 0) return { kind: "table", text: "", table: [] };
      var allObj = out.every(function (r) { return r && typeof r === "object" && !Array.isArray(r); });
      if (allObj) return { kind: "table", text: "", table: out };
      return { kind: "text", text: out.map(function (x) { return String(x); }).join("\\n"), table: null };
    }
    if (typeof out === "object") return { kind: "table", text: "", table: [out] };
    return { kind: "text", text: String(out), table: null };
  }

  try {
    var fn = new Function(
      "input_text", "input_table", "mode",
      '"use strict";\\nvar output = null;\\n' + payload.code + '\\n;return output;'
    );
    var output = fn(payload.text || "", payload.table || [], payload.mode);
    var result = normalize(output);
    console.log = origLog;
    self.postMessage({ ok: true, result: result, stdout: logs.join("\\n") });
  } catch (e) {
    console.log = origLog;
    self.postMessage({
      ok: false,
      error: (e && e.message) ? e.message : String(e),
      stack: (e && e.stack) ? String(e.stack) : "",
      stdout: logs.join("\\n")
    });
  }
};
`;

export async function runCleaningScript(opts: {
  code: string;
  text: string;
  table: Record<string, unknown>[];
  mode: "text" | "table";
  timeoutSec?: number | null;
}): Promise<CleaningRunOutput> {
  const started = performance.now();
  const fail = (error: string, stdout = "", stderr = ""): CleaningRunOutput => ({
    ok: false,
    output_kind: "text",
    output_text: "",
    output_table: null,
    stdout,
    stderr,
    error,
    duration_ms: Math.round(performance.now() - started),
  });

  if (new Blob([opts.code]).size > MAX_CODE_BYTES) {
    return fail(`代码过长 (>${MAX_CODE_BYTES / 1024}KB)`);
  }
  const timeoutMs = Math.max(1, Math.min(opts.timeoutSec || 30, 120)) * 1000 || DEFAULT_TIMEOUT_MS;

  const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(blobUrl);

  try {
    const result = await new Promise<CleaningRunOutput>((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(fail(`脚本运行超时（>${Math.round(timeoutMs / 1000)}s）`));
      }, timeoutMs);

      worker.onmessage = (ev) => {
        clearTimeout(timer);
        const data = ev.data as {
          ok: boolean;
          result?: { kind: "text" | "table"; text: string; table: Record<string, unknown>[] | null };
          stdout?: string;
          error?: string;
          stack?: string;
        };
        if (!data.ok) {
          resolve(fail(data.error || "脚本执行失败", data.stdout || "", data.stack || ""));
          return;
        }
        const r = data.result!;
        resolve({
          ok: true,
          output_kind: r.kind,
          output_text: r.text || "",
          output_table: r.table,
          stdout: data.stdout || "",
          stderr: "",
          error: "",
          duration_ms: Math.round(performance.now() - started),
        });
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        resolve(fail(e.message || "Worker error"));
      };

      worker.postMessage({
        code: opts.code,
        text: opts.text,
        table: opts.table,
        mode: opts.mode,
      });
    });
    return result;
  } finally {
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  }
}
