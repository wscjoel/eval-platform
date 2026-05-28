import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, PromptTemplate, PromptTemplateInput } from "../api/client";
import { IconX } from "./Icon";

type Props = {
  open: boolean;
  initial?: Partial<PromptTemplateInput> & { id?: number };
  onClose: () => void;
  onSaved?: (p: PromptTemplate) => void;
};

const EMPTY: PromptTemplateInput = {
  name: "",
  description: "",
  system_prompt: "",
  prompt_template: "",
  json_schema: "",
  default_model: "",
  default_temperature: 0.2,
};

export function PromptEditor({ open, initial, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const editId = initial?.id;
  const [form, setForm] = useState<PromptTemplateInput>(EMPTY);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, ...(initial || {}) });
      setErr("");
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await api.get<{ models: string[] }>("/models")).data.models,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: async () => {
      const url = editId ? `/prompts/${editId}` : "/prompts";
      const method = editId ? "put" : "post";
      const r = await api.request<PromptTemplate>({ url, method, data: form });
      return r.data;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      onSaved?.(p);
      onClose();
    },
    onError: (e: any) => setErr(e?.response?.data?.detail || String(e)),
  });

  if (!open) return null;
  const canSave = form.name.trim() && form.prompt_template.trim();

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-soft border border-ink-200 w-full max-w-3xl max-h-[90vh] overflow-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink-200 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">{editId ? "编辑提示词模板" : "新建提示词模板"}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5" title="关闭"><IconX className="w-4 h-4" /></button>
        </header>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">模板名称 *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：商品标题吸引力评测"
              />
            </div>
            <div>
              <label className="label">描述</label>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="可选"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">默认模型</label>
              <select
                className="input"
                value={form.default_model}
                onChange={(e) => setForm({ ...form, default_model: e.target.value })}
              >
                <option value="">未指定</option>
                {(models.data || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">默认 Temperature</label>
              <input
                type="number" min={0} max={2} step={0.1}
                className="input"
                value={form.default_temperature}
                onChange={(e) => setForm({ ...form, default_temperature: parseFloat(e.target.value || "0") })}
              />
            </div>
          </div>

          <div>
            <label className="label">System Prompt（角色、规则、输出约束）</label>
            <textarea
              className="input font-mono text-[13px]"
              rows={5}
              value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder={"# Role: 资深评测专家\n你的任务是…"}
            />
          </div>

          <div>
            <label className="label">
              User Prompt 模板 *（用 <code className="px-1 py-0.5 bg-ink-100 rounded text-ink-900">{"{{列名}}"}</code> 引用 Excel 列）
            </label>
            <textarea
              className="input font-mono text-[13px]"
              rows={8}
              value={form.prompt_template}
              onChange={(e) => setForm({ ...form, prompt_template: e.target.value })}
              placeholder={"请评测以下商品标题与描述：\n标题：{{title}}\n描述：{{description}}"}
            />
          </div>

          <div>
            <label className="label">JSON 输出 Schema</label>
            <textarea
              className="input font-mono text-[13px]"
              rows={6}
              value={form.json_schema}
              onChange={(e) => setForm({ ...form, json_schema: e.target.value })}
              placeholder={`{\n  "score": "1-5 的整数",\n  "reason": "≤50字"\n}`}
            />
          </div>

          {err && <div className="text-sm text-danger">{err}</div>}
        </div>

        <footer className="px-6 py-3 border-t border-ink-200 flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
