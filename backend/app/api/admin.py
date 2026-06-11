"""管理后台接口：用户管理 / 登录记录 / 全员评测数据总览。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..core.security import hash_password
from ..db import get_session
from ..deps import require_admin
from ..models import AnnotationJob, Dataset, LoginRecord, Task, User
from ..schemas import (
    DatasetOut,
    JobOut,
    LoginRecordOut,
    LoginRecordsPage,
    TaskOut,
    UserCreateRequest,
    UserDataDetail,
    UserDataStats,
    UserOut,
    UserUpdateRequest,
)

router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)


# ---------------- 用户管理 ----------------


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_session)):
    rows = db.execute(select(User).order_by(User.created_at)).scalars().all()
    return [UserOut.model_validate(u) for u in rows]


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreateRequest, db: Session = Depends(get_session)):
    exists = db.execute(
        select(User).where(User.username == payload.username)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, f"用户名已存在: {payload.username}")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or payload.username,
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "用户不存在")
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        if user.id == admin.id and payload.is_active is False:
            raise HTTPException(400, "不能禁用自己的账号")
        user.is_active = payload.is_active
    if payload.role is not None:
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(400, "不能取消自己的管理员权限")
        user.role = payload.role
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "用户不存在")
    if user.id == admin.id:
        raise HTTPException(400, "不能删除自己的账号")
    has_data = (
        db.execute(
            select(func.count(Dataset.id)).where(Dataset.user_id == user_id)
        ).scalar_one()
        or db.execute(
            select(func.count(Task.id)).where(Task.user_id == user_id)
        ).scalar_one()
        or db.execute(
            select(func.count(AnnotationJob.id)).where(AnnotationJob.user_id == user_id)
        ).scalar_one()
    )
    if has_data:
        raise HTTPException(400, "该用户名下仍有评测数据，建议改用「禁用」而非删除")
    db.delete(user)
    db.commit()
    return {"ok": True}


# ---------------- 登录记录 ----------------


@router.get("/login-records", response_model=LoginRecordsPage)
def login_records(
    user_id: int | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session),
):
    stmt = select(LoginRecord)
    if user_id is not None:
        stmt = stmt.where(LoginRecord.user_id == user_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        db.execute(stmt.order_by(desc(LoginRecord.login_at)).offset(offset).limit(limit))
        .scalars()
        .all()
    )
    return LoginRecordsPage(
        total=total, items=[LoginRecordOut.model_validate(r) for r in rows]
    )


# ---------------- 全员评测数据总览 ----------------


@router.get("/overview", response_model=list[UserDataStats])
def overview(db: Session = Depends(get_session)):
    users = db.execute(select(User).order_by(User.created_at)).scalars().all()

    def _count(model, uid: int) -> int:
        return db.execute(
            select(func.count(model.id)).where(model.user_id == uid)
        ).scalar_one()

    out: list[UserDataStats] = []
    for u in users:
        login_count = db.execute(
            select(func.count(LoginRecord.id)).where(
                LoginRecord.user_id == u.id, LoginRecord.success.is_(True)
            )
        ).scalar_one()
        out.append(
            UserDataStats(
                user=UserOut.model_validate(u),
                dataset_count=_count(Dataset, u.id),
                task_count=_count(Task, u.id),
                anno_job_count=_count(AnnotationJob, u.id),
                login_count=login_count,
            )
        )
    return out


@router.get("/users/{user_id}/data", response_model=UserDataDetail)
def user_data(user_id: int, db: Session = Depends(get_session)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "用户不存在")
    datasets = (
        db.execute(
            select(Dataset).where(Dataset.user_id == user_id).order_by(desc(Dataset.created_at))
        )
        .scalars()
        .all()
    )
    tasks = (
        db.execute(
            select(Task).where(Task.user_id == user_id).order_by(desc(Task.created_at))
        )
        .scalars()
        .all()
    )
    jobs = (
        db.execute(
            select(AnnotationJob)
            .where(AnnotationJob.user_id == user_id)
            .order_by(desc(AnnotationJob.created_at))
        )
        .scalars()
        .all()
    )
    return UserDataDetail(
        user=UserOut.model_validate(user),
        datasets=[
            DatasetOut(
                id=d.id,
                name=d.name,
                filename=d.filename,
                rows=d.rows,
                columns=d.columns_json or [],
                created_at=d.created_at,
            )
            for d in datasets
        ],
        tasks=[TaskOut.model_validate(t) for t in tasks],
        anno_jobs=[
            JobOut(
                id=j.id,
                name=j.name,
                template_id=j.template_id,
                source_filename=j.source_filename,
                total_rows=j.total_rows,
                selected_dimensions=list(j.selected_dimensions or []),
                column_mapping=dict(j.column_mapping or {}),
                created_at=j.created_at,
                updated_at=j.updated_at,
            )
            for j in jobs
        ],
    )
