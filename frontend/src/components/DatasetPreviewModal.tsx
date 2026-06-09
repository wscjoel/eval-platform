import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { datasetsApi } from "../api/client";
import { IconCheck, IconDoc, IconX } from "./Icon";

type CellRef = { col: string; value: string; row: number };

export function DatasetPreviewModal({
  datasetId,
  onClose,
}: {
  datasetId: number;
  onClose: () => void;
}) {
  const [cell, setCell] = useState<CellRef | null>(null);

  const detailQ = useQuery({
    queryKey: ["dataset-preview", datasetId],
    queryFn: () => datasetsApi.get(datasetId),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cell) setCell(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cell, onClose]);

  const ds = detailQ.data;

  return (
    <div
      className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-soft border border-ink-200 w-full max-w-5xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-200">
          <div className="flex items-center gap-2 min-w-0 pr-3">
            <IconDoc className="w-4 h-4 text-ink-500 shrink-0" />
            <div className="text-sm font-semibold text-ink-900 truncate" title={ds?.name}>
              {ds?.name || "数据集预览"}
            </div>
            {ds && (
              <span className="text-xs text-ink-500 shrink-0">
                · {ds.rows} 行 · {ds.columns.length} 列
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-ink-500 hover:text-ink-900 cursor-pointer transition-colors shrink-0"
            onClick={onClose}
            aria-label="关闭"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {detailQ.isLoading && (
            <div className="px-3 py-12 text-center text-sm text-ink-500">加载中…</div>
          )}
          {detailQ.isError && (
            <div className="px-3 py-12 text-center text-sm text-danger">
              加载失败：
              {(detailQ.error as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail || String(detailQ.error)}
            </div>
          )}
          {ds && (
            <>
              <div className="text-[11px] text-ink-500 mb-2">点击单元格可查看完整内容并复制</div>
              <table className="w-full text-[12px]">
                <thead className="text-ink-500 sticky top-0 bg-white z-10">
                  <tr className="border-b border-ink-200">
                    <th className="px-2 py-1 text-left font-medium w-10">#</th>
                    {ds.columns.map((c) => (
                      <th key={c} className="px-2 py-1 text-left font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ds.preview.map((row, i) => (
                    <tr key={i} className="border-t border-ink-200">
                      <td className="px-2 py-1 align-top text-ink-400 tabular-nums">{i + 1}</td>
                      {ds.columns.map((c) => {
                        const v = String((row as Record<string, unknown>)[c] ?? "");
                        return (
                          <td
                            key={c}
                            className="px-2 py-1 align-top text-ink-700 max-w-[200px] truncate cursor-pointer hover:bg-ink-100 transition-colors"
                            title={v}
                            onClick={() => setCell({ col: c, value: v, row: i })}
                          >
                            {v || <span className="text-ink-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {ds.preview.length === 0 && (
                    <tr>
                      <td
                        colSpan={ds.columns.length + 1}
                        className="px-2 py-12 text-center text-ink-500"
                      >
                        （无预览数据）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {cell && (
        <FieldDetailModal
          title={`第 ${cell.row + 1} 行 · ${cell.col}`}
          value={cell.value}
          onClose={() => setCell(null)}
        />
      )}
    </div>
  );
}

function FieldDetailModal({
  title,
  value,
  onClose,
}: {
  title: string;
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-soft border border-ink-200 w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200 gap-3">
          <div className="text-sm font-semibold text-ink-900 truncate">{title}</div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn-ghost border border-ink-200 !py-1 !text-xs"
              onClick={copy}
              title="复制内容"
            >
              {copied ? (
                <>
                  <IconCheck className="w-3.5 h-3.5 text-success" />
                  已复制
                </>
              ) : (
                "复制"
              )}
            </button>
            <button
              type="button"
              className="text-ink-500 hover:text-ink-900 cursor-pointer transition-colors"
              onClick={onClose}
              aria-label="关闭"
            >
              <IconX className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-4 py-3 overflow-auto text-[12px] text-ink-800 whitespace-pre-wrap break-all">
          {value || <span className="text-ink-400">（空）</span>}
        </div>
      </div>
    </div>
  );
}
