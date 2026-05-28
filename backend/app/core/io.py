"""Excel/CSV 读写。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


def load_dataframe(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=str, keep_default_na=False)
    elif suffix == ".csv":
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
    df.columns = [str(c).strip() for c in df.columns]
    return df.fillna("")


def df_preview(df: pd.DataFrame, n: int = 10) -> list[dict[str, Any]]:
    return df.head(n).to_dict(orient="records")


def write_results_xlsx(out_path: Path, df_input: pd.DataFrame, results: list[dict[str, Any]]) -> None:
    """合并原始列 + 评测结果列，导出 xlsx。"""
    parsed_keys: list[str] = []
    seen: set[str] = set()
    for r in results:
        pj = r.get("parsed_json") or {}
        if isinstance(pj, dict):
            for k in pj.keys():
                if k not in seen:
                    seen.add(k)
                    parsed_keys.append(k)

    rows: list[dict[str, Any]] = []
    for i in range(len(df_input)):
        base = df_input.iloc[i].to_dict()
        r = next((x for x in results if x["row_index"] == i), None)
        if r is None:
            rows.append(base)
            continue
        out = dict(base)
        pj = r.get("parsed_json") or {}
        for k in parsed_keys:
            v = pj.get(k) if isinstance(pj, dict) else None
            if isinstance(v, (dict, list)):
                import json
                v = json.dumps(v, ensure_ascii=False)
            out[f"eval_{k}"] = v
        out["eval_status"] = r.get("status", "")
        out["eval_raw_output"] = r.get("raw_output", "")
        out["eval_error"] = r.get("error", "")
        out["eval_latency_ms"] = r.get("latency_ms", 0)
        rows.append(out)

    pd.DataFrame(rows).to_excel(out_path, index=False)
