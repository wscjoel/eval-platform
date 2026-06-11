"""全局配置：路径、环境变量。"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
# DATA_DIR 可用环境变量覆盖：PaaS 部署时把持久化卷挂载到该路径（如 /data）
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
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

# ---------------- 账号与会话 ----------------

AUTH_COOKIE_NAME = "eval_session"
AUTH_TOKEN_TTL_S = int(os.getenv("AUTH_TOKEN_TTL_S", str(7 * 24 * 3600)))  # 默认 7 天

# 初始管理员账号（首次启动自动创建，之后修改环境变量不会覆盖已有账号）
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

_SECRET_FILE = DATA_DIR / ".secret_key"


def _load_secret_key() -> str:
    """会话签名密钥：优先环境变量；否则生成并持久化到文件，保证重启后会话不失效。"""
    env_val = os.getenv("SECRET_KEY")
    if env_val:
        return env_val
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_text(encoding="utf-8").strip()
    import secrets as _secrets

    key = _secrets.token_hex(32)
    _SECRET_FILE.write_text(key, encoding="utf-8")
    return key


SECRET_KEY = _load_secret_key()


def get_api_key(override: str | None = None) -> str | None:
    """返回 API Key：优先使用前端传入的覆盖值，否则读环境变量。"""
    if override and override.strip():
        return override.strip()
    return os.getenv(LLM_GW_API_KEY_ENV)
