"""人工批注相关路由：模版 / 维度配置 / 任务 / 单行读写 / 导出。"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..config import EVAL_MAX_FILE_MB, EVAL_MAX_ROWS, EXPORT_DIR, UPLOAD_DIR
from ..core.io import load_dataframe
from ..db import get_session
from ..deps import ensure_owner, get_current_user, is_admin
from ..models import (
    Annotation,
    AnnotationDimensionConfig,
    AnnotationJob,
    AnnotationTemplate,
    Dataset,
    User,
)
from ..schemas import (
    AnnotationTemplateCreate,
    AnnotationTemplateOut,
    AnnotationTemplateUpdate,
    DimensionConfigOut,
    DimensionConfigUpdate,
    JobCreate,
    JobDetail,
    JobFromDatasetRequest,
    JobOut,
    RowDetail,
    RowSummary,
    RowsResponse,
    SaveAnnotationsIn,
    UploadParseResponse,
)

router = APIRouter(prefix="/api/anno", tags=["annotations"])

_ALLOWED_SUFFIX = {".xlsx", ".xls", ".csv"}


# ---------------- 模版 ----------------


def _tpl_to_out(tpl: AnnotationTemplate) -> AnnotationTemplateOut:
    dims = [DimensionConfigOut.model_validate(d) for d in tpl.dimensions]
    return AnnotationTemplateOut(
        id=tpl.id,
        name=tpl.name,
        description=tpl.description,
        data_columns=list(tpl.data_columns or []),
        annotation_columns=list(tpl.annotation_columns or []),
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
        dimensions=dims,
    )


@router.get("/templates", response_model=list[AnnotationTemplateOut])
def list_templates(db: Session = Depends(get_session)):
    rows = (
        db.execute(select(AnnotationTemplate).order_by(desc(AnnotationTemplate.updated_at)))
        .scalars()
        .all()
    )
    return [_tpl_to_out(t) for t in rows]


@router.post("/templates", response_model=AnnotationTemplateOut)
def create_template(payload: AnnotationTemplateCreate, db: Session = Depends(get_session)):
    exists = db.execute(
        select(AnnotationTemplate).where(AnnotationTemplate.name == payload.name)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, f"template name exists: {payload.name}")
    tpl = AnnotationTemplate(
        name=payload.name,
        description=payload.description,
        data_columns=payload.data_columns,
        annotation_columns=payload.annotation_columns,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _tpl_to_out(tpl)


@router.get("/templates/{template_id}", response_model=AnnotationTemplateOut)
def get_template(template_id: int, db: Session = Depends(get_session)):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    return _tpl_to_out(tpl)


@router.put("/templates/{template_id}", response_model=AnnotationTemplateOut)
def update_template(
    template_id: int,
    payload: AnnotationTemplateUpdate,
    db: Session = Depends(get_session),
):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] and data["name"] != tpl.name:
        clash = db.execute(
            select(AnnotationTemplate).where(AnnotationTemplate.name == data["name"])
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(409, f"name exists: {data['name']}")
    for k, v in data.items():
        if v is not None:
            setattr(tpl, k, v)
    db.commit()
    db.refresh(tpl)
    return _tpl_to_out(tpl)


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_session)):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    if tpl.jobs:
        raise HTTPException(400, "template has jobs, delete jobs first")
    db.delete(tpl)
    db.commit()
    return {"ok": True}


# ---------------- 维度配置 ----------------


@router.get(
    "/templates/{template_id}/dimensions/{name}",
    response_model=DimensionConfigOut,
)
def get_dimension(template_id: int, name: str, db: Session = Depends(get_session)):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    cfg = db.execute(
        select(AnnotationDimensionConfig).where(
            AnnotationDimensionConfig.template_id == template_id,
            AnnotationDimensionConfig.dimension_name == name,
        )
    ).scalar_one_or_none()
    if cfg is None:
        # 返回默认空配置（前端按需保存即生效）
        return DimensionConfigOut(
            dimension_name=name, input_type="options", select_mode="single", options_text=""
        )
    return DimensionConfigOut.model_validate(cfg)


@router.put(
    "/templates/{template_id}/dimensions/{name}",
    response_model=DimensionConfigOut,
)
def upsert_dimension(
    template_id: int,
    name: str,
    payload: DimensionConfigUpdate,
    db: Session = Depends(get_session),
):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    if payload.input_type not in ("options", "text"):
        raise HTTPException(400, "input_type must be 'options' or 'text'")
    if payload.input_type == "options":
        if payload.select_mode not in ("single", "multi"):
            raise HTTPException(400, "select_mode must be 'single' or 'multi' when input_type=options")
    cfg = db.execute(
        select(AnnotationDimensionConfig).where(
            AnnotationDimensionConfig.template_id == template_id,
            AnnotationDimensionConfig.dimension_name == name,
        )
    ).scalar_one_or_none()
    if cfg is None:
        cfg = AnnotationDimensionConfig(
            template_id=template_id,
            dimension_name=name,
            input_type=payload.input_type,
            select_mode=payload.select_mode if payload.input_type == "options" else None,
            options_text=payload.options_text or "",
        )
        db.add(cfg)
    else:
        cfg.input_type = payload.input_type
        cfg.select_mode = payload.select_mode if payload.input_type == "options" else None
        cfg.options_text = payload.options_text or ""
    db.commit()
    db.refresh(cfg)
    return DimensionConfigOut.model_validate(cfg)


# ---------------- 上传 & 任务 ----------------


def _save_upload(file: UploadFile) -> tuple[Path, int]:
    if not file.filename:
        raise HTTPException(400, "missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _ALLOWED_SUFFIX:
        raise HTTPException(400, f"unsupported file type: {suffix}")
    safe_name = f"anno_{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / safe_name
    size = 0
    with dest.open("wb") as fout:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > EVAL_MAX_FILE_MB * 1024 * 1024:
                fout.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, f"file too large (>{EVAL_MAX_FILE_MB}MB)")
            fout.write(chunk)
    return dest, size


def _build_parse_response(
    df: pd.DataFrame,
    tpl: AnnotationTemplate,
    source_path: str,
    source_filename: str,
) -> UploadParseResponse:
    columns = list(df.columns)
    template_fields = list((tpl.data_columns or [])) + list((tpl.annotation_columns or []))
    suggested = {field: field for field in template_fields if field in columns}
    empty_cols = [c for c in columns if (df[c].astype(str).str.strip() == "").all()]
    return UploadParseResponse(
        source_path=source_path,
        source_filename=source_filename,
        columns=columns,
        total_rows=len(df),
        suggested_mapping=suggested,
        empty_columns=empty_cols,
    )


@router.post("/jobs/upload", response_model=UploadParseResponse)
def upload_and_parse(
    template_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    tpl = db.get(AnnotationTemplate, template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    dest, _ = _save_upload(file)
    try:
        df = load_dataframe(dest)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"parse failed: {e}")
    if len(df) > EVAL_MAX_ROWS:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"too many rows: {len(df)} > {EVAL_MAX_ROWS}")

    return _build_parse_response(df, tpl, dest.name, file.filename or dest.name)


@router.post("/jobs/from-dataset", response_model=UploadParseResponse)
def from_dataset(
    payload: JobFromDatasetRequest,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """从已有评测数据集创建批注源：复制数据集文件后预解析。

    复制（而非直接引用）数据集文件，避免删除批注任务时误删原数据集文件。
    """
    tpl = db.get(AnnotationTemplate, payload.template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    ds = db.get(Dataset, payload.dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    ensure_owner(user, ds.user_id)
    src = UPLOAD_DIR / ds.filename
    if not src.exists():
        raise HTTPException(404, "dataset file missing on server")

    suffix = Path(ds.filename).suffix.lower()
    safe_name = f"anno_{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / safe_name
    try:
        shutil.copyfile(src, dest)
        df = load_dataframe(dest)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"parse failed: {e}")
    if len(df) > EVAL_MAX_ROWS:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"too many rows: {len(df)} > {EVAL_MAX_ROWS}")

    return _build_parse_response(df, tpl, dest.name, ds.name)


def _job_progress(db: Session, job: AnnotationJob) -> tuple[int, int]:
    """返回 (已批注行数, 未批注行数)。已批注定义：选中的任一维度有非空值。"""
    if not job.selected_dimensions:
        return 0, job.total_rows
    rows = (
        db.execute(
            select(Annotation.row_index)
            .where(
                Annotation.job_id == job.id,
                Annotation.dimension_name.in_(job.selected_dimensions),
                Annotation.value != "",
            )
            .distinct()
        )
        .scalars()
        .all()
    )
    annotated = len(set(rows))
    return annotated, max(0, job.total_rows - annotated)


def _job_to_out(db: Session, job: AnnotationJob) -> JobOut:
    annotated, pending = _job_progress(db, job)
    return JobOut(
        id=job.id,
        name=job.name,
        template_id=job.template_id,
        source_filename=job.source_filename,
        total_rows=job.total_rows,
        selected_dimensions=list(job.selected_dimensions or []),
        column_mapping=dict(job.column_mapping or {}),
        annotated_rows=annotated,
        pending_rows=pending,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.post("/jobs", response_model=JobOut)
def create_job(
    payload: JobCreate,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    tpl = db.get(AnnotationTemplate, payload.template_id)
    if tpl is None:
        raise HTTPException(404, "template not found")
    src = UPLOAD_DIR / payload.source_path
    if not src.exists():
        raise HTTPException(400, "source file not found, please re-upload")
    try:
        df = load_dataframe(src)
    except Exception as e:
        raise HTTPException(400, f"parse failed: {e}")

    job = AnnotationJob(
        name=payload.name,
        template_id=payload.template_id,
        source_filename=payload.source_filename,
        source_path=payload.source_path,
        source_columns=list(df.columns),
        total_rows=len(df),
        column_mapping=payload.column_mapping,
        selected_dimensions=payload.selected_dimensions,
        user_id=user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_to_out(db, job)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(AnnotationJob).order_by(desc(AnnotationJob.created_at))
    if not is_admin(user):
        stmt = stmt.where(AnnotationJob.user_id == user.id)
    rows = db.execute(stmt).scalars().all()
    return [_job_to_out(db, j) for j in rows]


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(
    job_id: int,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    out = _job_to_out(db, job)
    tpl = job.template
    return JobDetail(
        **out.model_dump(),
        source_columns=list(job.source_columns or []),
        template=_tpl_to_out(tpl) if tpl else None,
    )


@router.delete("/jobs/{job_id}")
def delete_job(
    job_id: int,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    # 删除源文件
    (UPLOAD_DIR / job.source_path).unlink(missing_ok=True)
    db.delete(job)
    db.commit()
    return {"ok": True}


# ---------------- 行 ----------------


def _load_job_df(job: AnnotationJob) -> pd.DataFrame:
    src = UPLOAD_DIR / job.source_path
    if not src.exists():
        raise HTTPException(400, "source file missing")
    return load_dataframe(src)


def _row_preview(row: dict[str, Any], data_field_to_col: dict[str, str]) -> str:
    """优先用第一个映射上的数据字段作为摘要。"""
    parts: list[str] = []
    for _, col in data_field_to_col.items():
        v = str(row.get(col, "") or "").strip().replace("\n", " ")
        if v:
            parts.append(v[:40])
            if len(parts) >= 2:
                break
    return " · ".join(parts) or "(空行)"


@router.get("/jobs/{job_id}/rows", response_model=RowsResponse)
def list_rows(
    job_id: int,
    status: str = "all",  # all | annotated | pending
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    df = _load_job_df(job)
    tpl = job.template
    data_fields = list(tpl.data_columns or []) if tpl else []
    mapping = dict(job.column_mapping or {})
    data_field_to_col = {f: mapping[f] for f in data_fields if f in mapping}

    # 取所有已有非空批注的 row_index 集合
    annotated_rows = set(
        db.execute(
            select(Annotation.row_index).where(
                Annotation.job_id == job_id,
                Annotation.dimension_name.in_(job.selected_dimensions or []),
                Annotation.value != "",
            )
        ).scalars()
    )

    items: list[RowSummary] = []
    for i in range(len(df)):
        is_annotated = i in annotated_rows
        if status == "annotated" and not is_annotated:
            continue
        if status == "pending" and is_annotated:
            continue
        row = df.iloc[i].to_dict()
        items.append(
            RowSummary(
                row_index=i,
                annotated=is_annotated,
                preview=_row_preview(row, data_field_to_col),
            )
        )
    return RowsResponse(total=len(items), items=items)


@router.get("/jobs/{job_id}/rows/{row_index}", response_model=RowDetail)
def get_row(
    job_id: int,
    row_index: int,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    df = _load_job_df(job)
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(404, "row out of range")
    tpl = job.template
    data_fields = list(tpl.data_columns or []) if tpl else []
    mapping = dict(job.column_mapping or {})
    row = df.iloc[row_index].to_dict()
    data: dict[str, str] = {}
    for f in data_fields:
        col = mapping.get(f)
        if col and col in row:
            data[f] = str(row[col] or "")
        else:
            data[f] = ""
    annos = db.execute(
        select(Annotation).where(
            Annotation.job_id == job_id, Annotation.row_index == row_index
        )
    ).scalars().all()
    ann_map = {a.dimension_name: a.value for a in annos}
    return RowDetail(row_index=row_index, data=data, annotations=ann_map)


@router.put("/jobs/{job_id}/rows/{row_index}")
def save_row(
    job_id: int,
    row_index: int,
    payload: SaveAnnotationsIn,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    if row_index < 0 or row_index >= job.total_rows:
        raise HTTPException(404, "row out of range")
    existing = db.execute(
        select(Annotation).where(
            Annotation.job_id == job_id, Annotation.row_index == row_index
        )
    ).scalars().all()
    existing_map = {a.dimension_name: a for a in existing}
    for dim, value in payload.annotations.items():
        v = value or ""
        if dim in existing_map:
            existing_map[dim].value = v
        else:
            db.add(
                Annotation(
                    job_id=job_id,
                    row_index=row_index,
                    dimension_name=dim,
                    value=v,
                )
            )
    db.commit()
    annotated, pending = _job_progress(db, job)
    return {"ok": True, "annotated_rows": annotated, "pending_rows": pending}


# ---------------- 导出 ----------------


def _stringify(v: str) -> str:
    """多选 JSON 字符串导出时还原成 ; 拼接。"""
    if not v:
        return ""
    s = v.strip()
    if s.startswith("[") and s.endswith("]"):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return ";".join(str(x) for x in arr)
        except Exception:
            pass
    return v


@router.get("/jobs/{job_id}/export.xlsx")
def export_job(
    job_id: int,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = db.get(AnnotationJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    ensure_owner(user, job.user_id)
    df = _load_job_df(job)
    tpl = job.template
    if tpl is None:
        raise HTTPException(400, "template missing")

    # 取所有批注
    rows = db.execute(
        select(Annotation).where(Annotation.job_id == job_id)
    ).scalars().all()
    by_row: dict[int, dict[str, str]] = {}
    for a in rows:
        by_row.setdefault(a.row_index, {})[a.dimension_name] = _stringify(a.value)

    mapping = dict(job.column_mapping or {})
    out_df = df.copy()
    for dim in job.selected_dimensions or []:
        target_col = mapping.get(dim, dim)
        if target_col not in out_df.columns:
            out_df[target_col] = ""
        for i in range(len(out_df)):
            v = by_row.get(i, {}).get(dim, "")
            if v:
                out_df.at[i, target_col] = v

    safe_name = f"anno_{job_id}_{uuid.uuid4().hex[:8]}.xlsx"
    out_path = EXPORT_DIR / safe_name
    out_df.to_excel(out_path, index=False)
    download_name = f"{Path(job.source_filename).stem}_annotated.xlsx"
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=download_name,
    )
