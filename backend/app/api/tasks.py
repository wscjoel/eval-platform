"""任务相关路由：创建/查询/重试/导出/试运行。"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..config import EXPORT_DIR, MODEL_LIST, UPLOAD_DIR, get_api_key
from ..core.io import load_dataframe, write_results_xlsx
from ..core.runner import request_cancel, retry_row, run_task, trial_run_one
from ..db import get_session
from ..models import Dataset, Result, Task
from ..schemas import (
    ResultOut,
    ResultsPage,
    TaskCreate,
    TaskOut,
    TrialRequest,
    TrialResponse,
)

router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/models")
def list_models():
    return {"models": MODEL_LIST}


@router.post("/tasks/trial", response_model=TrialResponse)
async def trial(req: TrialRequest):
    api_key = get_api_key(req.api_key)
    if not api_key:
        raise HTTPException(400, "Missing API key (set LLM_GW_API_KEY env or provide api_key)")
    if req.model not in MODEL_LIST:
        raise HTTPException(400, "invalid model")
    try:
        res = await trial_run_one(
            api_key=api_key,
            dataset_id=req.dataset_id,
            model=req.model,
            prompt_template=req.prompt_template,
            json_schema=req.json_schema,
            temperature=req.temperature,
            row_index=req.row_index,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return TrialResponse(**res)


@router.post("/tasks", response_model=TaskOut)
def create_task(
    payload: TaskCreate,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
    if payload.model not in MODEL_LIST:
        raise HTTPException(400, "invalid model")
    api_key = get_api_key(payload.api_key)
    if not api_key:
        raise HTTPException(400, "Missing API key (set LLM_GW_API_KEY env or provide api_key)")

    ds = db.get(Dataset, payload.dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")

    running = db.execute(
        select(func.count(Task.id)).where(Task.status == "running")
    ).scalar_one()
    if running and running > 0:
        raise HTTPException(409, "another task is running, please wait")

    task = Task(
        dataset_id=payload.dataset_id,
        name=payload.name,
        model=payload.model,
        prompt_template=payload.prompt_template,
        json_schema=payload.json_schema,
        temperature=payload.temperature,
        status="pending",
        total=ds.rows,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    bg.add_task(_run_task_bg, task.id, api_key)
    return TaskOut.model_validate(task)


def _run_task_bg(task_id: int, api_key: str) -> None:
    """BackgroundTasks 调用的同步入口，内部跑 asyncio.run。"""
    asyncio.run(run_task(task_id, api_key))


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(db: Session = Depends(get_session)):
    rows = db.execute(select(Task).order_by(desc(Task.created_at))).scalars().all()
    return [TaskOut.model_validate(r) for r in rows]


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_session)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "task not found")
    return TaskOut.model_validate(t)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_session)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "task not found")
    if t.status in ("running", "stopping"):
        raise HTTPException(400, "cannot delete a running task")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/tasks/{task_id}/stop", response_model=TaskOut)
def stop_task(task_id: int, db: Session = Depends(get_session)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "task not found")
    if t.status not in ("running", "pending"):
        raise HTTPException(400, f"cannot stop a task in status: {t.status}")
    request_cancel(task_id)
    t.status = "stopping"
    db.commit()
    db.refresh(t)
    return TaskOut.model_validate(t)


@router.get("/tasks/{task_id}/results", response_model=ResultsPage)
def get_results(
    task_id: int,
    status: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_session),
):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "task not found")

    stmt = select(Result).where(Result.task_id == task_id)
    if status:
        stmt = stmt.where(Result.status == status)
    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()

    rows = db.execute(
        stmt.order_by(Result.row_index).offset(offset).limit(limit)
    ).scalars().all()

    all_results = db.execute(
        select(Result.parsed_json).where(Result.task_id == task_id, Result.parse_ok.is_(True))
    ).scalars().all()
    parsed_keys: list[str] = []
    seen: set[str] = set()
    for pj in all_results:
        if isinstance(pj, dict):
            for k in pj.keys():
                if k not in seen:
                    seen.add(k)
                    parsed_keys.append(k)

    return ResultsPage(
        total=total,
        items=[ResultOut.model_validate(r) for r in rows],
        parsed_keys=parsed_keys,
    )


@router.post("/tasks/{task_id}/retry/{row_index}", response_model=ResultOut)
async def retry_one(
    task_id: int,
    row_index: int,
    api_key: str | None = None,
    db: Session = Depends(get_session),
):
    key = get_api_key(api_key)
    if not key:
        raise HTTPException(400, "Missing API key")
    try:
        await retry_row(task_id, row_index, key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    r = db.execute(
        select(Result).where(Result.task_id == task_id, Result.row_index == row_index)
    ).scalar_one()
    return ResultOut.model_validate(r)


@router.get("/tasks/{task_id}/export.xlsx")
def export_xlsx(task_id: int, db: Session = Depends(get_session)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "task not found")
    ds = db.get(Dataset, t.dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset missing")

    df = load_dataframe(UPLOAD_DIR / ds.filename)
    results = db.execute(
        select(Result).where(Result.task_id == task_id).order_by(Result.row_index)
    ).scalars().all()
    payload = [
        {
            "row_index": r.row_index,
            "parsed_json": r.parsed_json,
            "raw_output": r.raw_output,
            "status": r.status,
            "error": r.error,
            "latency_ms": r.latency_ms,
        }
        for r in results
    ]

    safe_name = f"task_{task_id}_{t.name.replace('/', '_')[:60]}.xlsx"
    out_path = EXPORT_DIR / safe_name
    write_results_xlsx(out_path, df, payload)
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=safe_name,
    )
