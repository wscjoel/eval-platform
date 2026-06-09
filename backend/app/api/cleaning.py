"""数据/知识清洗：文件上传 + Python 脚本运行 + 模板 CRUD。

上传文件保存到 data/cleaning/uploads/<source_id>.<ext>，source_id 即 uuid。
为简化，元数据（kind/text/table）落 JSON 镜像，避免每次再次重解析。
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import DATA_DIR, UPLOAD_DIR as EVAL_UPLOAD_DIR
from ..core.cleaning import (
    SUPPORTED_EXTS,
    parse_file,
    run_script,
    write_output_file,
)
from ..core.io import load_dataframe
from ..db import get_session
from ..models import CleaningScriptTemplate, Dataset
from ..schemas import (
    CleaningDownloadRequest,
    CleaningRunRequest,
    CleaningRunResponse,
    CleaningScriptTemplateCreate,
    CleaningScriptTemplateOut,
    CleaningScriptTemplateUpdate,
    CleaningSourceOut,
)

router = APIRouter(prefix="/api/cleaning", tags=["cleaning"])

CLEANING_DIR = DATA_DIR / "cleaning"
UPLOAD_DIR = CLEANING_DIR / "uploads"
META_DIR = CLEANING_DIR / "meta"
EXPORT_DIR = CLEANING_DIR / "exports"
for d in (CLEANING_DIR, UPLOAD_DIR, META_DIR, EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = 10
PREVIEW_TEXT_CHARS = 5000
PREVIEW_TABLE_ROWS = 50


# ---------------- 上传 / 预览 ----------------

def _build_source_out(source_id: str, filename: str, parsed: dict[str, Any]) -> CleaningSourceOut:
    kind = parsed.get("kind") or "text"
    text = parsed.get("text") or ""
    table = parsed.get("table") or []
    columns = parsed.get("columns") or []
    preview_text = text[:PREVIEW_TEXT_CHARS]
    preview_table = list(table[:PREVIEW_TABLE_ROWS]) if isinstance(table, list) else []
    return CleaningSourceOut(
        source_id=source_id,
        filename=filename,
        kind=kind,
        columns=columns,
        total_rows=len(table) if isinstance(table, list) else 0,
        text=text,
        table=table if isinstance(table, list) else [],
        preview_text=preview_text,
        preview_table=preview_table,
    )


def _meta_path(source_id: str) -> Path:
    return META_DIR / f"{source_id}.json"


@router.post("/upload", response_model=CleaningSourceOut)
async def upload(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "missing filename")
    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(400, f"unsupported file type: {ext}")

    source_id = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{source_id}{ext}"
    size = 0
    with dest.open("wb") as fout:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                fout.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, f"文件过大 (>{MAX_UPLOAD_MB}MB)")
            fout.write(chunk)

    try:
        parsed = parse_file(dest, ext)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"解析失败: {e}")

    out = _build_source_out(source_id, file.filename, parsed)
    # 镜像元数据，方便 run-script 直接读取避免重复解析
    _meta_path(source_id).write_text(
        json.dumps(
            {
                "filename": file.filename,
                "ext": ext,
                "kind": parsed.get("kind"),
                "text": parsed.get("text") or "",
                "table": parsed.get("table") or [],
                "columns": parsed.get("columns") or [],
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    return out


@router.post("/from-dataset/{dataset_id}", response_model=CleaningSourceOut)
def from_dataset(dataset_id: int, db: Session = Depends(get_session)):
    """把已有的评测数据集导入为一个清洗 source，避免重新上传。"""
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    src = EVAL_UPLOAD_DIR / ds.filename
    if not src.exists():
        raise HTTPException(404, "dataset file missing on server")
    try:
        df = load_dataframe(src)
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}")

    table = df.to_dict(orient="records")
    columns = list(df.columns)
    source_id = uuid.uuid4().hex
    parsed = {
        "kind": "table",
        "text": "",
        "table": table,
        "columns": columns,
    }
    out = _build_source_out(source_id, ds.name, parsed)
    _meta_path(source_id).write_text(
        json.dumps(
            {
                "filename": ds.name,
                "ext": Path(ds.filename).suffix.lower(),
                "kind": "table",
                "text": "",
                "table": table,
                "columns": columns,
                "from_dataset_id": ds.id,
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    return out


@router.get("/preview/{source_id}", response_model=CleaningSourceOut)
def preview(source_id: str):
    meta_p = _meta_path(source_id)
    if not meta_p.exists():
        raise HTTPException(404, "source not found")
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    return _build_source_out(source_id, meta.get("filename", ""), meta)


# ---------------- 运行脚本 ----------------

@router.post("/run-script", response_model=CleaningRunResponse)
def run(req: CleaningRunRequest):
    meta_p = _meta_path(req.source_id)
    if not meta_p.exists():
        raise HTTPException(404, "source not found")
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    input_data = {
        "text": meta.get("text") or "",
        "table": meta.get("table") or [],
    }
    res = run_script(
        code=req.code,
        input_data=input_data,
        mode=req.input_mode,
        timeout_sec=req.timeout_sec,
    )
    return CleaningRunResponse(**res)


# ---------------- 下载 ----------------

@router.post("/download")
def download(req: CleaningDownloadRequest):
    base_name = (req.filename or "cleaned").strip() or "cleaned"
    base_name = base_name.replace("/", "_").replace("\\", "_")[:80]
    out_name = f"{base_name}_{uuid.uuid4().hex[:6]}"
    out_path = EXPORT_DIR / out_name
    final = write_output_file(
        out_path,
        output_kind=req.output_kind,
        output_text=req.output_text,
        output_table=req.output_table,
    )
    media = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if final.suffix.lower() == ".xlsx"
        else "text/plain"
    )
    return FileResponse(final, media_type=media, filename=final.name)


# ---------------- 脚本模版 ----------------

@router.get("/script-templates", response_model=list[CleaningScriptTemplateOut])
def list_templates(db: Session = Depends(get_session)):
    rows = db.execute(
        select(CleaningScriptTemplate).order_by(desc(CleaningScriptTemplate.updated_at))
    ).scalars().all()
    return [CleaningScriptTemplateOut.model_validate(r) for r in rows]


@router.post("/script-templates", response_model=CleaningScriptTemplateOut)
def create_template(payload: CleaningScriptTemplateCreate, db: Session = Depends(get_session)):
    existing = db.execute(
        select(CleaningScriptTemplate).where(CleaningScriptTemplate.name == payload.name)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, f"name already exists: {payload.name}")
    tpl = CleaningScriptTemplate(**payload.model_dump())
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return CleaningScriptTemplateOut.model_validate(tpl)


@router.put("/script-templates/{tpl_id}", response_model=CleaningScriptTemplateOut)
def update_template(
    tpl_id: int, payload: CleaningScriptTemplateUpdate, db: Session = Depends(get_session)
):
    tpl = db.get(CleaningScriptTemplate, tpl_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] and data["name"] != tpl.name:
        dupe = db.execute(
            select(CleaningScriptTemplate).where(CleaningScriptTemplate.name == data["name"])
        ).scalar_one_or_none()
        if dupe is not None:
            raise HTTPException(409, f"name already exists: {data['name']}")
    for k, v in data.items():
        if v is not None:
            setattr(tpl, k, v)
    tpl.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tpl)
    return CleaningScriptTemplateOut.model_validate(tpl)


@router.delete("/script-templates/{tpl_id}")
def delete_template(tpl_id: int, db: Session = Depends(get_session)):
    tpl = db.get(CleaningScriptTemplate, tpl_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    db.delete(tpl)
    db.commit()
    return {"ok": True}


# 防止异常残留：暂未实现的清理函数（可手动调）
def _purge_dir(path: Path) -> int:
    if not path.exists():
        return 0
    n = 0
    for p in path.iterdir():
        try:
            if p.is_file():
                p.unlink()
                n += 1
            elif p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
                n += 1
        except Exception:
            continue
    return n
