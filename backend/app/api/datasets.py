"""数据集相关路由：上传、列表、详情、下载、覆盖、从清洗结果创建。"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import EVAL_MAX_FILE_MB, EVAL_MAX_ROWS, UPLOAD_DIR
from ..core.io import df_preview, load_dataframe
from ..db import get_session
from ..models import Dataset
from ..schemas import (
    DatasetDetail,
    DatasetFromCleaningRequest,
    DatasetOut,
    DatasetReplaceRequest,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

_ALLOWED_SUFFIX = {".xlsx", ".xls", ".csv"}


@router.post("", response_model=DatasetDetail)
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    if not file.filename:
        raise HTTPException(400, "missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _ALLOWED_SUFFIX:
        raise HTTPException(400, f"unsupported file type: {suffix}")

    safe_name = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / safe_name
    size = 0
    with dest.open("wb") as fout:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > EVAL_MAX_FILE_MB * 1024 * 1024:
                fout.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, f"file too large (>{EVAL_MAX_FILE_MB}MB)")
            fout.write(chunk)

    try:
        df = load_dataframe(dest)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"parse failed: {e}")

    if len(df) > EVAL_MAX_ROWS:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"too many rows: {len(df)} > {EVAL_MAX_ROWS}")

    columns = list(df.columns)
    ds = Dataset(
        name=file.filename,
        filename=safe_name,
        rows=len(df),
        columns_json=columns,
    )
    db.add(ds)
    db.commit()
    db.refresh(ds)

    return DatasetDetail(
        id=ds.id,
        name=ds.name,
        filename=ds.filename,
        rows=ds.rows,
        columns=columns,
        created_at=ds.created_at,
        preview=df_preview(df, len(df)),
    )


@router.get("", response_model=list[DatasetOut])
def list_datasets(db: Session = Depends(get_session)):
    rows = db.execute(select(Dataset).order_by(desc(Dataset.created_at))).scalars().all()
    return [
        DatasetOut(
            id=r.id,
            name=r.name,
            filename=r.filename,
            rows=r.rows,
            columns=r.columns_json or [],
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: int, db: Session = Depends(get_session)):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    df = load_dataframe(UPLOAD_DIR / ds.filename)
    return DatasetDetail(
        id=ds.id,
        name=ds.name,
        filename=ds.filename,
        rows=ds.rows,
        columns=list(df.columns),
        created_at=ds.created_at,
        preview=df_preview(df, len(df)),
    )


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_session)):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    if ds.tasks:
        raise HTTPException(400, "dataset has tasks, delete tasks first")
    (UPLOAD_DIR / ds.filename).unlink(missing_ok=True)
    db.delete(ds)
    db.commit()
    return {"ok": True}


@router.get("/{dataset_id}/download")
def download_dataset(dataset_id: int, db: Session = Depends(get_session)):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    src = UPLOAD_DIR / ds.filename
    if not src.exists():
        raise HTTPException(404, "file missing on server")
    suffix = Path(ds.filename).suffix.lower()
    if suffix == ".csv":
        media = "text/csv"
    elif suffix in (".xlsx", ".xls"):
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        media = "application/octet-stream"
    return FileResponse(src, media_type=media, filename=ds.name)


def _write_rows_to_file(rows: list[dict], dest: Path) -> tuple[int, list[str]]:
    """根据 dest 后缀写文件，返回 (行数, 列名)。"""
    df = pd.DataFrame(rows)
    df = df.fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    suffix = dest.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        df.to_excel(dest, index=False)
    elif suffix == ".csv":
        df.to_csv(dest, index=False)
    else:
        raise HTTPException(400, f"unsupported target file type: {suffix}")
    return len(df), list(df.columns)


@router.put("/{dataset_id}/replace", response_model=DatasetDetail)
def replace_dataset(
    dataset_id: int,
    payload: DatasetReplaceRequest,
    db: Session = Depends(get_session),
):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    if ds.tasks:
        raise HTTPException(
            409,
            "数据集已被评测任务引用，无法直接覆盖。请使用「另存为新数据集」。",
        )
    if not payload.rows:
        raise HTTPException(400, "rows is empty")
    if len(payload.rows) > EVAL_MAX_ROWS:
        raise HTTPException(400, f"too many rows: {len(payload.rows)} > {EVAL_MAX_ROWS}")

    dest = UPLOAD_DIR / ds.filename
    try:
        rows_count, columns = _write_rows_to_file(payload.rows, dest)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"write failed: {e}")

    ds.rows = rows_count
    ds.columns_json = columns
    if payload.name and payload.name.strip():
        ds.name = payload.name.strip()
    db.commit()
    db.refresh(ds)

    df = load_dataframe(dest)
    return DatasetDetail(
        id=ds.id,
        name=ds.name,
        filename=ds.filename,
        rows=ds.rows,
        columns=list(df.columns),
        created_at=ds.created_at,
        preview=df_preview(df, len(df)),
    )


@router.post("/from-cleaning", response_model=DatasetDetail)
def create_from_cleaning(
    payload: DatasetFromCleaningRequest,
    db: Session = Depends(get_session),
):
    if not payload.rows:
        raise HTTPException(400, "rows is empty")
    if len(payload.rows) > EVAL_MAX_ROWS:
        raise HTTPException(400, f"too many rows: {len(payload.rows)} > {EVAL_MAX_ROWS}")

    suffix = ".xlsx"
    safe_name = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / safe_name
    try:
        rows_count, columns = _write_rows_to_file(payload.rows, dest)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"write failed: {e}")

    display_name = payload.name.strip()
    if not display_name.lower().endswith((".xlsx", ".xls", ".csv")):
        display_name = f"{display_name}.xlsx"

    ds = Dataset(
        name=display_name,
        filename=safe_name,
        rows=rows_count,
        columns_json=columns,
    )
    db.add(ds)
    db.commit()
    db.refresh(ds)

    df = load_dataframe(dest)
    return DatasetDetail(
        id=ds.id,
        name=ds.name,
        filename=ds.filename,
        rows=ds.rows,
        columns=list(df.columns),
        created_at=ds.created_at,
        preview=df_preview(df, len(df)),
    )
