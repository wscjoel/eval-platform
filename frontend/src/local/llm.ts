/**
 * 浏览器直连 LLM 网关（OpenAI Chat Completions 协议）。
 * 移植自后端 core/llm.py + core/parser.py：1s 节流、5xx 指数退避重试、JSON 稳健提取。
 */

import { settings } from "./settings";

export class LLMError extends Error {
  noRetry: boolean;
  constructor(message: string, noRetry = false) {
    super(message);
    this.noRetry = noRetry;
  }
}

const MIN_INTERVAL_MS = 1000;
let lastDispatch = 0;
let throttleChain: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  // 串行链保证任意两次请求发起间隔 >= MIN_INTERVAL_MS
  const p = throttleChain.then(async () => {
    const wait = lastDispatch + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDispatch = Date.now();
  });
  throttleChain = p.catch(() => {});
  return p;
}

function extractText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);
  const choices = (data as Record<string, unknown>).choices;
  if (Array.isArray(choices) && choices.length) {
    const msg = (choices[0]?.message ?? {}) as Record<string, unknown>;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) return content;
  }
  return "";
}

export async function callLLM(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{ text: string; latencyMs: number }> {
  const { apiKey, model, systemPrompt, userPrompt } = opts;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;
  if (!apiKey) throw new LLMError("缺少 API Key：请在顶部设置中填写");

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });
  const payload = { model, messages, stream: false };
  const url = settings.gatewayUrl();

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttle();
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = Math.round(performance.now() - t0);
      const bodyText = await resp.text();

      if (resp.status >= 500) throw new LLMError(`HTTP ${resp.status}: ${bodyText.slice(0, 300)}`);
      if (resp.status >= 400)
        throw new LLMError(`HTTP ${resp.status}: ${bodyText.slice(0, 300)}`, true);

      let text = bodyText;
      try {
        text = extractText(JSON.parse(bodyText)) || bodyText;
      } catch {
        /* 非 JSON 响应，原样返回 */
      }
      return { text, latencyMs };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      // 浏览器跨域/网络不通时是 TypeError: Failed to fetch，补充提示
      if (err.name === "TypeError" || err.name === "AbortError") {
        lastErr = new LLMError(
          `网络请求失败（${err.message}）。最常见原因：本机转发小工具没启动。` +
            `请先运行 proxy/ 目录下的转发程序，并在「设置」里把网关地址填成 ` +
            `http://127.0.0.1:8787/v1/chat/completions（详见 proxy/README.md）。`
        );
      } else {
        lastErr = err;
      }
      if (lastErr instanceof LLMError && lastErr.noRetry) break;
      if (attempt >= maxRetries) break;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(3, attempt))); // 1s, 3s
    }
  }
  throw new LLMError(`LLM 调用失败（已重试）: ${lastErr?.message ?? "unknown"}`);
}

// ---------------- JSON 稳健解析（移植 parser.py） ----------------

const JSON_BLOCK = /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/i;
const FIRST_OBJ = /(\{[\s\S]*\}|\[[\s\S]*\])/;

export function extractJson(text: string): { parsed: Record<string, unknown> | null; error: string } {
  if (!text) return { parsed: null, error: "empty output" };

  const tryParse = (s: string): Record<string, unknown> | null => {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
    return { _value: obj } as Record<string, unknown>;
  };

  try {
    return { parsed: tryParse(text), error: "" };
  } catch {
    /* 继续尝试 */
  }

  const mBlock = JSON_BLOCK.exec(text);
  if (mBlock) {
    try {
      return { parsed: tryParse(mBlock[1]), error: "" };
    } catch (e) {
      return { parsed: null, error: `json code-block parse failed: ${e}` };
    }
  }

  const mFirst = FIRST_OBJ.exec(text);
  if (mFirst) {
    try {
      return { parsed: tryParse(mFirst[1]), error: "" };
    } catch (e) {
      return { parsed: null, error: `first json block parse failed: ${e}` };
    }
  }

  return { parsed: null, error: "no JSON found" };
}

export function systemPromptFromSchema(schema: string): string {
  const s = (schema || "").trim();
  if (!s) {
    return (
      "You are a strict evaluator. Respond ONLY with a valid JSON object, " +
      "no prose, no markdown fences."
    );
  }
  return (
    "You are a strict evaluator. You MUST respond with a single JSON object " +
    "that conforms to the following user-defined schema. Output ONLY the JSON, " +
    "no prose, no markdown fences.\n\n" +
    `Schema:\n${s}`
  );
}

export function renderPrompt(template: string, row: Record<string, string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, key: string) => {
    const k = key.trim();
    return k in row ? String(row[k]) : m;
  });
}
