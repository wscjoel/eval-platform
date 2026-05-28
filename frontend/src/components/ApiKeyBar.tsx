import { useEffect, useState } from "react";
import { apiKeyStore } from "../api/client";
import { IconCheck, IconKey } from "./Icon";

export function ApiKeyBar() {
  const [val, setVal] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setVal(apiKeyStore.get());
  }, []);

  const onSave = () => {
    apiKeyStore.set(val.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <IconKey className="w-4 h-4 text-ink-500" />
      <input
        type="password"
        placeholder="LLM 网关 API Key（仅存浏览器本地）"
        className="input w-72"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button className="btn-primary" onClick={onSave}>
        {saved ? <><IconCheck className="w-4 h-4" />已保存</> : "保存"}
      </button>
    </div>
  );
}
