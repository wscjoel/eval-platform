import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, DimensionConfig } from "../api/client";
import { IconX } from "./Icon";

export function DimensionConfigModal({
  templateId,
  dimensionName,
  onClose,
  onSaved,
}: {
  templateId: number;
  dimensionName: string;
  onClose: () => void;
  onSaved?: (cfg: DimensionConfig) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["anno-dim", templateId, dimensionName],
    queryFn: async () =>
      (await api.get<DimensionConfig>(`/anno/templates/${templateId}/dimensions/${encodeURIComponent(dimensionName)}`)).data,
  });

  const [inputType, setInputType] = useState<"options" | "text">("options");
  const [selectMode, setSelectMode] = useState<"single" | "multi">("single");
  const [optionsText, setOptionsText] = useState("");

  useEffect(() => {
    if (data) {
      setInputType(data.input_type);
      setSelectMode((data.select_mode as "single" | "multi") || "single");
      setOptionsText(data.options_text || "");
    }
  }, [data]);

  const options = useMemo(() => parseOptions(optionsText), [optionsText]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        input_type: inputType,
        select_mode: inputType === "options" ? selectMode : null,
        options_text: optionsText,
      };
      const r = await api.put<DimensionConfig>(
        `/anno/templates/${templateId}/dimensions/${encodeURIComponent(dimensionName)}`,
        body,
      );
      return r.data;
    },
    onSuccess: (cfg) => {
      qc.invalidateQueries({ queryKey: ["anno-dim", templateId, dimensionName] });
      qc.invalidateQueries({ queryKey: ["anno-templates"] });
      onSaved?.(cfg);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-soft w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">配置批注维度</h2>
            <div className="text-xs text-ink-500 mt-0.5">维度：<span className="text-ink-900 font-medium">{dimensionName}</span></div>
          </div>
          <button className="btn-ghost px-2 py-1" onClick={onClose}><IconX className="w-4 h-4" /></button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-ink-500 text-sm">加载中…</div>
        ) : (
          <div className="p-6 space-y-5">
            <div>
              <label className="label">输入类型</label>
              <div className="flex items-center gap-2">
                <SegBtn active={inputType === "options"} onClick={() => setInputType("options")}>选项列表</SegBtn>
                <SegBtn active={inputType === "text"} onClick={() => setInputType("text")}>自由文本</SegBtn>
              </div>
            </div>

            {inputType === "options" && (
              <>
                <div>
                  <label className="label">选择模式</label>
                  <div className="flex items-center gap-2">
                    <SegBtn active={selectMode === "single"} onClick={() => setSelectMode("single")}>单选</SegBtn>
                    <SegBtn active={selectMode === "multi"} onClick={() => setSelectMode("multi")}>多选</SegBtn>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">粘贴选项（每行一个）</label>
                    <textarea
                      className="input font-mono text-[13px]"
                      rows={12}
                      value={optionsText}
                      onChange={(e) => setOptionsText(e.target.value)}
                      placeholder={"无问题\n业务应答-基本能力\n人设-非客服助手人格\n…"}
                    />
                    <div className="text-xs text-ink-500 mt-1">共 {options.length} 个有效选项</div>
                  </div>
                  <div>
                    <div className="label">预览</div>
                    <div className="border border-ink-200 rounded-md p-3 max-h-72 overflow-auto space-y-1.5 bg-ink-50/40">
                      {options.length === 0 && <div className="text-xs text-ink-500">（输入选项后此处预览）</div>}
                      {options.map((opt) => (
                        <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white border border-ink-200 cursor-pointer hover:bg-ink-50 transition-colors">
                          <input type={selectMode === "single" ? "radio" : "checkbox"} disabled className="accent-ink-900" />
                          <span className="text-sm text-ink-900">{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {inputType === "text" && (
              <div className="text-sm text-ink-500 bg-ink-50 border border-ink-200 rounded-md p-4">
                选择"自由文本"后，批注界面将提供多行文本框，适合「问题现象描述」「修改建议」「备注」等开放性字段。
              </div>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-ink-200 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            disabled={save.isPending || (inputType === "options" && options.length === 0)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SegBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors cursor-pointer ${
        active
          ? "bg-ink-900 text-white border-ink-900"
          : "bg-white text-ink-700 border-ink-200 hover:bg-ink-50"
      }`}
    >
      {children}
    </button>
  );
}

export function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
