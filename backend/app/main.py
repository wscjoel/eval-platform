"""FastAPI 入口。"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import admin as admin_api
from .api import annotations as annotations_api
from .api import auth as auth_api
from .api import cleaning as cleaning_api
from .api import datasets as datasets_api
from .api import prompts as prompts_api
from .api import tasks as tasks_api
from .config import LLM_GW_API_KEY_ENV
from .db import init_db
from .deps import get_current_user

app = FastAPI(title="客服AI评测台", version="0.2.0")

# Cookie 会话依赖同源凭证；本地 Vite 代理与生产同源部署均不跨域。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_api.router)
app.include_router(admin_api.router)

# 业务路由统一要求登录
_auth_required = [Depends(get_current_user)]
app.include_router(datasets_api.router, dependencies=_auth_required)
app.include_router(tasks_api.router, dependencies=_auth_required)
app.include_router(prompts_api.router, dependencies=_auth_required)
app.include_router(annotations_api.router, dependencies=_auth_required)
app.include_router(cleaning_api.router, dependencies=_auth_required)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "has_env_api_key": bool(os.getenv(LLM_GW_API_KEY_ENV)),
    }


# ---------------- 前端静态资源托管 ----------------
# 生产部署时把前端 `npm run build` 产物输出到 backend/app/static/
# FastAPI 直接托管该目录，SPA 路由全部回退到 index.html。
STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_FILE = STATIC_DIR / "index.html"
ASSETS_DIR = STATIC_DIR / "assets"

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str, request: Request):
    """SPA fallback：非 /api 路径全部返回 index.html，让前端路由接管。"""
    if full_path.startswith("api/") or full_path == "api":
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    if full_path:
        candidate = (STATIC_DIR / full_path).resolve()
        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            candidate = None
        if candidate and candidate.is_file():
            return FileResponse(str(candidate))

    if INDEX_FILE.is_file():
        return FileResponse(str(INDEX_FILE))
    return JSONResponse(
        {
            "detail": "Frontend not built. Run `cd frontend && npm run build` to generate static assets.",
        },
        status_code=503,
    )