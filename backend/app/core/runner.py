"""异步评测任务执行器：读取数据集 → 渲染提示词 → 调 LLM → 解析 → 写库。"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select

from ..config import EVAL_CONCURRENCY, UPLOAD_DIR
from ..db import SessionLocal
from ..models import Dataset, Result, Task
from .io import load_dataframe
from .llm import LLMError, call_llm
from .parser import extract_json


_PLACEHOLDER = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


# 任务级取消事件注册表（由 run_task 写入，HTTP 路由 set，_eval_row 检查）
_CANCEL_EVENTS: dict[int, asyncio.Event] = {}


def register_cancel(task_id: int) -> asyncio.Event:
    ev = asyncio.Event()
    _CANCEL_EVENTS[task_id] = ev
    return ev


def request_cancel(task_id: int) -> bool:
    """请求停止某任务；返回是否找到事件（任务正在跑）。"""
    ev = _CANCEL_EVENTS.get(task_id)
    if ev is None:
        return False
    ev.set()
    return True


def _unregister_cancel(task_id: int) -> None:
    _CANCEL_EVENTS.pop(task_id, None)


def render_prompt(template: str, row: dict[str, Any]) -> str:
    """安全地把 {{列名}} 替换为该行的值；未知列保留原样。"""

    def _sub(m: re.Match[str]) -> str:
        key = m.group(1).strip()
        if key in row:
            return str(row[key])
        return m.group(0)

    return _PLACEHOLDER.sub(_sub, template)


def _system_prompt_from_schema(schema: str) -> str:
    schema = (schema or "").strip()
    if not schema:
        return (
            "You are a strict evaluator. Respond ONLY with a valid JSON object, "
            "no prose, no markdown fences."
        )
    return (
        "You are a strict evaluator. You MUST respond with a single JSON object "
        "that conforms to the following user-defined schema. Output ONLY the JSON, "
        "no prose, no markdown fences.\n\n"
        f"Schema:\n{schema}"
    )


async def _eval_row(
    sem: asyncio.Semaphore,
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    template: str,
    row: dict[str, Any],
    temperature: float,
    cancel_event: asyncio.Event | None = None,
) -> dict[str, Any]:
    user_prompt = render_prompt(template, row)
    async with sem:
        # 软停止：进入业务前若已触发取消，直接返回 stopped，不再调外部
        if cancel_event is not None and cancel_event.is_set():
            return {
                "raw_output": "",
                "parsed_json": None,
                "parse_ok": False,
                "status": "stopped",
                "error": "任务已手动停止",
                "latency_ms": 0,
            }
        try:
            text, latency = await call_llm(
                api_key=api_key,
                model=model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
            )
        except LLMError as e:
            return {
                "raw_output": "",
                "parsed_json": None,
                "parse_ok": False,
                "status": "failed",
                "error": str(e),
                "latency_ms": 0,
            }

    parsed, perr = extract_json(text)
    if parsed is None:
        return {
            "raw_output": text,
            "parsed_json": None,
            "parse_ok": False,
            "status": "parse_error",
            "error": perr,
            "latency_ms": latency,
        }
    return {
        "raw_output": text,
        "parsed_json": parsed,
        "parse_ok": True,
        "status": "success",
        "error": "",
        "latency_ms": latency,
    }


async def trial_run_one(
    *,
    api_key: str,
    dataset_id: int,
    model: str,
    prompt_template: str,
    json_schema: str,
    temperature: float,
    row_index: int,
) -> dict[str, Any]:
    """对数据集第 row_index 行执行单次试运行（不写库）。"""
    with SessionLocal() as db:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            raise ValueError("dataset not found")
        path = UPLOAD_DIR / ds.filename

    df = load_dataframe(path)
    if row_index < 0 or row_index >= len(df):
        raise ValueError("row_index out of range")
    row = df.iloc[row_index].to_dict()

    sem = asyncio.Semaphore(1)
    return await _eval_row(
        sem,
        api_key=api_key,
        model=model,
        system_prompt=_system_prompt_from_schema(json_schema),
        template=prompt_template,
        row=row,
        temperature=temperature,
    )


async def run_task(task_id: int, api_key: str) -> None:
    """后台跑一个任务的全部行。状态/进度实时更新到 DB。"""
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        if task is None:
            return
        ds = db.get(Dataset, task.dataset_id)
        if ds is None:
            task.status = "failed"
            task.error = "dataset missing"
            db.commit()
            return
        path = UPLOAD_DIR / ds.filename
        template = task.prompt_template
        model = task.model
        schema = task.json_schema
        temperature = task.temperature

    try:
        df = load_dataframe(path)
    except Exception as e:
        with SessionLocal() as db:
            t = db.get(Task, task_id)
            if t:
                t.status = "failed"
                t.error = f"load file failed: {e}"
                t.finished_at = datetime.utcnow()
                db.commit()
        return

    total = len(df)
    with SessionLocal() as db:
        t = db.get(Task, task_id)
        if t:
            t.status = "running"
            t.total = total
            t.processed = 0
            t.succeeded = 0
            t.failed = 0
            db.execute(delete(Result).where(Result.task_id == task_id))
            db.commit()

    sem = asyncio.Semaphore(max(1, EVAL_CONCURRENCY))
    system_prompt = _system_prompt_from_schema(schema)
    cancel_event = register_cancel(task_id)

    async def _one(idx: int, row: dict[str, Any]) -> None:
        res = await _eval_row(
            sem,
            api_key=api_key,
            model=model,
            system_prompt=system_prompt,
            template=template,
            row=row,
            temperature=temperature,
            cancel_event=cancel_event,
        )
        with SessionLocal() as db:
            db.add(
                Result(
                    task_id=task_id,
                    row_index=idx,
                    input_json=row,
                    raw_output=res["raw_output"],
                    parsed_json=res["parsed_json"],
                    parse_ok=res["parse_ok"],
                    status=res["status"],
                    error=res["error"],
                    latency_ms=res["latency_ms"],
                )
            )
            t = db.get(Task, task_id)
            if t:
                t.processed += 1
                if res["status"] == "success":
                    t.succeeded += 1
                elif res["status"] != "stopped":
                    t.failed += 1
            db.commit()

    tasks = [_one(i, df.iloc[i].to_dict()) for i in range(total)]
    try:
        await asyncio.gather(*tasks)
        with SessionLocal() as db:
            t = db.get(Task, task_id)
            if t:
                t.status = "stopped" if cancel_event.is_set() else "done"
                t.finished_at = datetime.utcnow()
                db.commit()
    except Exception as e:
        with SessionLocal() as db:
            t = db.get(Task, task_id)
            if t:
                t.status = "failed"
                t.error = str(e)
                t.finished_at = datetime.utcnow()
                db.commit()
    finally:
        _unregister_cancel(task_id)


async def retry_row(task_id: int, row_index: int, api_key: str) -> dict[str, Any]:
    """重试单行；写回 Result 并刷新任务计数。"""
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        if task is None:
            raise ValueError("task not found")
        ds = db.get(Dataset, task.dataset_id)
        if ds is None:
            raise ValueError("dataset missing")
        path = UPLOAD_DIR / ds.filename
        template = task.prompt_template
        model = task.model
        schema = task.json_schema
        temperature = task.temperature

    df = load_dataframe(path)
    if row_index < 0 or row_index >= len(df):
        raise ValueError("row_index out of range")
    row = df.iloc[row_index].to_dict()

    sem = asyncio.Semaphore(1)
    res = await _eval_row(
        sem,
        api_key=api_key,
        model=model,
        system_prompt=_system_prompt_from_schema(schema),
        template=template,
        row=row,
        temperature=temperature,
    )

    with SessionLocal() as db:
        existing = db.execute(
            select(Result).where(Result.task_id == task_id, Result.row_index == row_index)
        ).scalar_one_or_none()
        was_success = existing.status == "success" if existing else False
        if existing:
            existing.raw_output = res["raw_output"]
            existing.parsed_json = res["parsed_json"]
            existing.parse_ok = res["parse_ok"]
            existing.status = res["status"]
            existing.error = res["error"]
            existing.latency_ms = res["latency_ms"]
            existing.input_json = row
        else:
            db.add(
                Result(
                    task_id=task_id,
                    row_index=row_index,
                    input_json=row,
                    raw_output=res["raw_output"],
                    parsed_json=res["parsed_json"],
                    parse_ok=res["parse_ok"],
                    status=res["status"],
                    error=res["error"],
                    latency_ms=res["latency_ms"],
                )
            )

        t = db.get(Task, task_id)
        if t and existing:
            now_success = res["status"] == "success"
            if was_success and not now_success:
                t.succeeded -= 1
                t.failed += 1
            elif not was_success and now_success:
                t.succeeded += 1
                t.failed = max(0, t.failed - 1)
        db.commit()

    return res
