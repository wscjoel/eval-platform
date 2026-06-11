/**
 * 本地设置：LLM 网关地址、模型列表、API Key。全部存 localStorage。
 */

const KEY_GW_URL = "llm_gw_url";
const KEY_MODELS = "llm_models";
const KEY_API_KEY = "llm_gw_api_key"; // 与原 apiKeyStore 同一个 key，平滑迁移

export const DEFAULT_GW_URL = "http://llm-gw.jd.local/v1/chat/completions";
export const DEFAULT_MODELS = ["GPT-5.5-joybuilder"];

export const settings = {
  gatewayUrl(): string {
    return localStorage.getItem(KEY_GW_URL) || DEFAULT_GW_URL;
  },
  setGatewayUrl(v: string) {
    if (v.trim()) localStorage.setItem(KEY_GW_URL, v.trim());
    else localStorage.removeItem(KEY_GW_URL);
  },
  models(): string[] {
    const raw = localStorage.getItem(KEY_MODELS);
    if (!raw) return [...DEFAULT_MODELS];
    const arr = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : [...DEFAULT_MODELS];
  },
  setModels(lines: string) {
    const arr = lines
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (arr.length) localStorage.setItem(KEY_MODELS, arr.join("\n"));
    else localStorage.removeItem(KEY_MODELS);
  },
  apiKey(): string {
    return localStorage.getItem(KEY_API_KEY) || "";
  },
  setApiKey(v: string) {
    if (v) localStorage.setItem(KEY_API_KEY, v);
    else localStorage.removeItem(KEY_API_KEY);
  },
};
