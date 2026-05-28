"""文件解析（excel/csv/txt/md/docx）与 Python 脚本子进程执行。

清洗模块的"内核"。两个能力：

1. parse_file(path, ext)：读入文件并归一为两种 kind
   - "table": 列名 + 行字典
   - "text" : 一整段字符串
2. run_script(code, input_data, mode, timeout_sec)：
   将用户 Python 代码 + 输入数据写到临时目录，用 subprocess 跑一个统一的
   壳脚本（_runner_template）。壳脚本会把 input_text / input_table /
   pd 注入用户代码的命名空间，并要求用户给 output 变量赋值。

不做强沙箱（内网信任环境）；做：30s 超时、代码长度上限、捕获 traceback。
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import pandas as pd

from .io import load_dataframe

MAX_CODE_BYTES = 50 * 1024  # 50KB
DEFAULT_TIMEOUT_SEC = 30


# ---------------- 文件解析 ----------------

_TEXT_EXTS = {".txt", ".md", ".markdown"}
_TABLE_EXTS = {".xlsx", ".xls", ".csv"}
_DOCX_EXTS = {".docx"}
SUPPORTED_EXTS = _TEXT_EXTS | _TABLE_EXTS | _DOCX_EXTS


class ParsedFile(dict):
    """方便类型说明的小别名。"""


def parse_file(path: Path, ext: str | None = None) -> ParsedFile:
    """根据后缀解析文件，返回 {kind, text, table, columns}。"""

    ext = (ext or path.suffix or "").lower()
    if ext in _TABLE_EXTS:
        df = load_dataframe(path)
        return ParsedFile(
            kind="table",
            text="",
            table=df.to_dict(orient="records"),
            columns=list(df.columns),
        )
    if ext in _TEXT_EXTS:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        return ParsedFile(kind="text", text=text, table=None, columns=[])
    if ext in _DOCX_EXTS:
        text = _read_docx(path)
        return ParsedFile(kind="text", text=text, table=None, columns=[])
    raise ValueError(f"unsupported file type: {ext}")


def _read_docx(path: Path) -> str:
    """用 python-docx 抽段落文本；逐段拼接，跳过空段。"""
    try:
        import docx  # type: ignore
    except ImportError as e:  # pragma: no cover - dependency missing fallback
        raise ValueError("python-docx not installed; cannot read .docx") from e

    doc = docx.Document(str(path))
    parts: list[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    # 也抽表格里的文字
    for tb in doc.tables:
        for row in tb.rows:
            cells = [c.text.strip() for c in row.cells]
            line = "\t".join(c for c in cells if c)
            if line:
                parts.append(line)
    return "\n".join(parts)


# ---------------- 脚本执行 ----------------

# 壳脚本：约定输入/输出文件 + 命名空间注入
_RUNNER_TEMPLATE = r"""
import json
import sys
import traceback
from pathlib import Path

try:
    import pandas as pd  # noqa: F401  让用户代码可以直接 import pd
except Exception:
    pd = None

HERE = Path(__file__).resolve().parent
with (HERE / "input.json").open("r", encoding="utf-8") as f:
    _payload = json.load(f)

mode = _payload.get("mode", "text")
input_text = _payload.get("text") or ""
_table_rows = _payload.get("table") or []

if pd is not None:
    input_table = pd.DataFrame(_table_rows)
else:
    input_table = _table_rows  # 退化：list[dict]

output = None  # 用户代码必须赋值

_user_code = (HERE / "user_script.py").read_text(encoding="utf-8")

_user_ns = {
    "__name__": "__cleaning__",
    "input_text": input_text,
    "input_table": input_table,
    "mode": mode,
    "pd": pd,
    "output": None,
}

try:
    exec(compile(_user_code, "<user_script>", "exec"), _user_ns)
    output = _user_ns.get("output")
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(2)

# 归一化 output
def _normalize(out):
    if out is None:
        return {"kind": "text", "text": "", "table": None}
    if pd is not None and isinstance(out, pd.DataFrame):
        return {
            "kind": "table",
            "text": "",
            "table": out.astype(object).where(out.notnull(), "").to_dict(orient="records"),
        }
    if isinstance(out, list):
        if len(out) == 0:
            return {"kind": "table", "text": "", "table": []}
        if all(isinstance(r, dict) for r in out):
            return {"kind": "table", "text": "", "table": out}
        return {"kind": "text", "text": "\n".join(str(x) for x in out), "table": None}
    if isinstance(out, dict):
        return {"kind": "table", "text": "", "table": [out]}
    return {"kind": "text", "text": str(out), "table": None}

result = _normalize(output)
with (HERE / "output.json").open("w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, default=str)
"""


def run_script(
    *,
    code: str,
    input_data: dict[str, Any],
    mode: str,
    timeout_sec: int | None = None,
) -> dict[str, Any]:
    """执行用户脚本并返回标准化结果。

    返回字典：
      ok: bool
      output_kind: "text" | "table"
      output_text: str
      output_table: list[dict] | None
      stdout / stderr / error: str
      duration_ms: int
    """

    if not isinstance(code, str):
        return _err("code must be string")
    code_bytes = code.encode("utf-8")
    if len(code_bytes) > MAX_CODE_BYTES:
        return _err(f"代码过长 (>{MAX_CODE_BYTES // 1024}KB)")
    if mode not in ("text", "table"):
        return _err(f"invalid mode: {mode}")

    timeout = int(timeout_sec or DEFAULT_TIMEOUT_SEC)
    timeout = max(1, min(timeout, 120))

    tmpdir = Path(tempfile.mkdtemp(prefix=f"clean_{uuid.uuid4().hex[:8]}_"))
    started = time.perf_counter()
    try:
        (tmpdir / "user_script.py").write_text(code, encoding="utf-8")
        (tmpdir / "runner.py").write_text(_RUNNER_TEMPLATE, encoding="utf-8")
        payload = {
            "mode": mode,
            "text": input_data.get("text") or "",
            "table": input_data.get("table") or [],
        }
        (tmpdir / "input.json").write_text(
            json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8"
        )

        try:
            proc = subprocess.run(
                [sys.executable, str(tmpdir / "runner.py")],
                cwd=str(tmpdir),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            return {
                "ok": False,
                "output_kind": "text",
                "output_text": "",
                "output_table": None,
                "stdout": (e.stdout or "") if isinstance(e.stdout, str) else "",
                "stderr": (e.stderr or "") if isinstance(e.stderr, str) else "",
                "error": f"脚本运行超时（>{timeout}s）",
                "duration_ms": int((time.perf_counter() - started) * 1000),
            }

        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        duration_ms = int((time.perf_counter() - started) * 1000)

        if proc.returncode != 0:
            return {
                "ok": False,
                "output_kind": "text",
                "output_text": "",
                "output_table": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": stderr.strip().splitlines()[-1] if stderr.strip() else f"exit code {proc.returncode}",
                "duration_ms": duration_ms,
            }

        out_file = tmpdir / "output.json"
        if not out_file.exists():
            return {
                "ok": False,
                "output_kind": "text",
                "output_text": "",
                "output_table": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": "脚本未产出 output（请给 output 变量赋值）",
                "duration_ms": duration_ms,
            }
        result = json.loads(out_file.read_text(encoding="utf-8"))
        return {
            "ok": True,
            "output_kind": result.get("kind", "text"),
            "output_text": result.get("text", "") or "",
            "output_table": result.get("table"),
            "stdout": stdout,
            "stderr": stderr,
            "error": "",
            "duration_ms": duration_ms,
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _err(msg: str) -> dict[str, Any]:
    return {
        "ok": False,
        "output_kind": "text",
        "output_text": "",
        "output_table": None,
        "stdout": "",
        "stderr": "",
        "error": msg,
        "duration_ms": 0,
    }


# ---------------- 输出文件落盘 ----------------

def write_output_file(
    out_path: Path,
    *,
    output_kind: str,
    output_text: str | None,
    output_table: list[dict[str, Any]] | None,
) -> Path:
    """把清洗结果写到文件，返回最终路径。"""
    if output_kind == "table":
        rows = output_table or []
        df = pd.DataFrame(rows) if rows else pd.DataFrame()
        if out_path.suffix.lower() not in (".xlsx", ".xls"):
            out_path = out_path.with_suffix(".xlsx")
        df.to_excel(out_path, index=False)
        return out_path
    text = output_text or ""
    if out_path.suffix.lower() not in (".txt", ".md", ".csv"):
        out_path = out_path.with_suffix(".txt")
    out_path.write_text(text, encoding="utf-8")
    return out_path
