"""LLM 原始输出 → JSON 的稳健解析。"""

from __future__ import annotations

import json
import re
from typing import Any


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL | re.IGNORECASE)
_FIRST_OBJ = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)


def extract_json(text: str) -> tuple[dict[str, Any] | None, str]:
    """尝试从文本中提取首个 JSON 对象。

    返回 (parsed_or_None, error_message)。
    """
    if not text:
        return None, "empty output"

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj, ""
        return {"_value": obj}, ""
    except Exception:
        pass

    m = _JSON_BLOCK.search(text)
    if m:
        try:
            obj = json.loads(m.group(1))
            return obj if isinstance(obj, dict) else {"_value": obj}, ""
        except Exception as e:
            return None, f"json code-block parse failed: {e}"

    m = _FIRST_OBJ.search(text)
    if m:
        try:
            obj = json.loads(m.group(1))
            return obj if isinstance(obj, dict) else {"_value": obj}, ""
        except Exception as e:
            return None, f"first json block parse failed: {e}"

    return None, "no JSON found"
