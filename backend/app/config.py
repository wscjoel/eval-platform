"""全局配置：路径、环境变量。"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "eval.db"

for d in (DATA_DIR, UPLOAD_DIR, EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

LLM_GW_URL = os.getenv("LLM_GW_URL", "http://llm-gw.jd.local/v1/chat/completions")
LLM_GW_API_KEY_ENV = "LLM_GW_API_KEY"

EVAL_CONCURRENCY = int(os.getenv("EVAL_CONCURRENCY", "1"))
LLM_MIN_INTERVAL_S = float(os.getenv("LLM_MIN_INTERVAL_S", "1.0"))
EVAL_MAX_ROWS = int(os.getenv("EVAL_MAX_ROWS", "10000"))
EVAL_MAX_FILE_MB = int(os.getenv("EVAL_MAX_FILE_MB", "50"))

MODEL_LIST = [
    "GPT-5.5-joybuilder",
]
DEFAULT_MODEL = MODEL_LIST[0]


def get_api_key(override: str | None = None) -> str | None:
    """返回 API Key：优先使用前端传入的覆盖值，否则读环境变量。"""
    if override and override.strip():
        return override.strip()
    return os.getenv(LLM_GW_API_KEY_ENV)
