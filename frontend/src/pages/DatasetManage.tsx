import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DatasetOut, datasetsApi } from "../api/client";
import { DatasetPreviewModal } from "../components/DatasetPreviewModal";
import {
  IconBroom,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconX,
} from "../components/Icon";

const ACCEPT_EXTS = [".xlsx", ".xls", ".csv"];

function fmtTime(s: string) {
  const d = new Date(s + "Z");
  return d.toLocaleString();
}

export function DatasetManage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const listQ = useQuery({
    queryKey: ["datasets"],
    queryFn: datasetsApi.list,
  });

  const delMut = useMutation({
    mutationFn: (id: number) => datasetsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] }),
  });

  const downloadMut = useMutation({
    mutationFn: async (ds: DatasetOut) => datasetsApi.download(ds.id, ds.name),
  });

  const datasets = listQ.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">数据集管理</h1>
          <p className="text-sm text-ink-500 mt-1">
            管理评测数据集：上传新数据集、下载本地副本，或进入数据清洗对现有数据集做加工后回写。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost border border-ink-200"
            onClick={() => nav("/cleaning?from=list")}
            title="进入数据清洗工作台"
          >
            <IconBroom className="w-4 h-4" />
            数据清洗
          </button>
          <button className="btn-accent" onClick={() => setShowUpload(true)}>
            <IconPlus className="w-4 h-4" />
            新建数据集
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-700 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">行数</th>
              <th className="px-4 py-3 font-medium">列数</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {!listQ.isLoading && datasets.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-ink-500">
                  暂无数据集，点击右上角「新建数据集」上传 .xlsx / .xls / .csv。
                </td>
              </tr>
            )}
            {datasets.map((d) => (
              <tr
                key={d.id}
                className="border-t border-ink-200 hover:bg-ink-50/60 transition-colors"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-ink-900 font-medium truncate hover:text-accent transition-colors cursor-pointer text-left"
                    title="点击预览数据集"
                    onClick={() => setPreviewId(d.id)}
                  >
                    {d.name}
                  </button>
                  <div className="text-[11px] text-ink-500 mt-0.5 truncate" title={d.columns.join(" / ")}>
                    {d.columns.slice(0, 6).join(" · ")}
                    {d.columns.length > 6 ? ` … +${d.columns.length - 6}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{d.rows}</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{d.columns.length}</td>
                <td className="px-4 py-3 text-ink-500">{fmtTime(d.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5"
                      title="进入数据清洗（带入此数据集）"
                      onClick={() => nav(`/cleaning?dataset_id=${d.id}`)}
                    >
                      <IconBroom className="w-4 h-4" />
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5"
                      title="下载本地"
                      disabled={downloadMut.isPending}
                      onClick={() => downloadMut.mutate(d)}
                    >
                      <IconDownload className="w-4 h-4" />
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-danger hover:bg-red-50"
                      title="删除"
                      onClick={() => {
                        if (confirm(`删除数据集「${d.name}」?`)) delMut.mutate(d.id);
                      }}
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUpload && (
        <UploadDatasetModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["datasets"] });
            setShowUpload(false);
          }}
        />
      )}

      {previewId != null && (
        <DatasetPreviewModal datasetId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}

function UploadDatasetModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");

  const upload = useMutation({
    mutationFn: datasetsApi.upload,
    onSuccess: () => {
      setErr("");
      onSuccess();
    },
    onError: (e: { response?: { data?: { detail?: string } }; message?: string }) => {
      setErr(e?.response?.data?.detail || e?.message || "上传失败");
    },
  });

  const onPick = (f?: File | null) => {
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPT_EXTS.includes(ext)) {
      setErr(`不支持的文件类型：${ext}。请使用 ${ACCEPT_EXTS.join(" / ")}`);
      return;
    }
    upload.mutate(f);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold">新建数据集</div>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-900 cursor-pointer"
            title="关闭"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onPick(e.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
            drag
              ? "border-accent bg-amber-50/40"
              : "border-ink-200 hover:border-ink-700 hover:bg-ink-50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPT_EXTS.join(",")}
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-100 text-ink-700">
            {upload.isPending ? (
              <IconRefresh className="w-5 h-5 animate-spin" />
            ) : (
              <IconUpload className="w-5 h-5" />
            )}
          </span>
          <div className="text-ink-900 font-medium">
            {upload.isPending ? "解析中…" : "点击或拖拽上传 .xlsx / .xls / .csv"}
          </div>
          <div className="text-xs text-ink-500">最大 5MB / 500 行</div>
        </label>

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
