"""数据集相关路由：上传、列表、详情。"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import EVAL_MAX_FILE_MB, EVAL_MAX_ROWS, UPLOAD_DIR
from ..core.io import df_preview, load_dataframe
from ..db import get_session
from ..models import Dataset
from ..schemas import DatasetDetail, DatasetOut

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
