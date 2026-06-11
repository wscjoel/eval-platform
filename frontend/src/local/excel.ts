/**
 * 浏览器内 Excel/CSV/文本 解析与导出（SheetJS），替代原后端 pandas io。
 */

import * as XLSX from "xlsx";
import type { Row } from "./db";

export const TABLE_EXTS = [".xlsx", ".xls", ".csv"];
export const TEXT_EXTS = [".txt", ".md", ".markdown"];

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** 解析表格文件 → 列名 + 全字符串行（与后端 dtype=str, fillna("") 行为一致）。 */
export async function parseTableFile(file: File): Promise<{ columns: string[]; rows: Row[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { columns: [], rows: [] };
  return sheetToRows(ws);
}

function sheetToRows(ws: XLSX.WorkSheet): { columns: string[]; rows: Row[] } {
  // header:1 取首行作为列名，保证列顺序稳定；defval 补空串
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  if (aoa.length === 0) return { columns: [], rows: [] };
  const rawHeader = aoa[0] as unknown[];
  const columns: string[] = [];
  const seen = new Set<string>();
  rawHeader.forEach((h, i) => {
    let name = String(h ?? "").trim() || `Unnamed: ${i}`;
    while (seen.has(name)) name = `${name}.1`;
    seen.add(name);
    columns.push(name);
  });
  const rows: Row[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const arr = aoa[r] as unknown[];
    // 跳过完全空行
    if (!arr || arr.every((v) => String(v ?? "").trim() === "")) continue;
    const row: Row = {};
    columns.forEach((c, i) => {
      row[c] = String(arr[i] ?? "");
    });
    rows.push(row);
  }
  return { columns, rows };
}

/** rows → xlsx Blob */
export function rowsToXlsxBlob(rows: Row[] | Record<string, unknown>[], columns?: string[]): Blob {
  const cols = columns && columns.length ? columns : inferColumns(rows);
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function inferColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 读取文本文件（txt/md） */
export async function readTextFile(file: File): Promise<string> {
  return await file.text();
}
