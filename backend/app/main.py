"""FastAPI 入口。"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import annotations as annotations_api
from .api import cleaning as cleaning_api
from .api import datasets as datasets_api
from .api import prompts as prompts_api
from .api import tasks as tasks_api
from .config import LLM_GW_API_KEY_ENV
from .db import init_db

app = FastAPI(title="客服AI评测台", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets_api.router)
app.include_router(tasks_api.router)
app.include_router(prompts_api.router)
app.include_router(annotations_api.router)
app.include_router(cleaning_api.router)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "has_env_api_key": bool(os.getenv(LLM_GW_API_KEY_ENV)),
    }
