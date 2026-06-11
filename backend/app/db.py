"""SQLite + SQLAlchemy 引擎与会话工厂。"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DB_PATH

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_session():
    """FastAPI 依赖：每请求一个会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401 触发表注册

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_columns()
    _seed_default_annotation_template()
    _seed_admin_user()


def _migrate_sqlite_columns() -> None:
    """SQLite 不支持 create_all 自动加列，这里手工补齐新增字段。"""
    with engine.connect() as conn:
        cols = {
            r[1] for r in conn.exec_driver_sql("PRAGMA table_info(prompt_templates)")
        }
        if "system_prompt" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE prompt_templates ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''"
            )
            conn.commit()

        # 账号体系：给业务表补 user_id 归属列
        for table in ("datasets", "tasks", "annotation_jobs"):
            tcols = {r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if tcols and "user_id" not in tcols:
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
                conn.commit()


def _seed_admin_user() -> None:
    """首次启动创建初始管理员账号，并把存量无主数据归属给管理员。"""
    import logging

    from .config import ADMIN_PASSWORD, ADMIN_USERNAME
    from .core.security import hash_password
    from .models import AnnotationJob, Dataset, Task, User

    log = logging.getLogger("uvicorn.error")
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        if admin is None:
            admin = User(
                username=ADMIN_USERNAME,
                password_hash=hash_password(ADMIN_PASSWORD),
                display_name="管理员",
                role="admin",
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
            log.warning(
                "已创建初始管理员账号 username=%s（密码来自 ADMIN_PASSWORD 环境变量，"
                "默认 admin123，生产环境请务必修改）",
                ADMIN_USERNAME,
            )
        # 存量无主数据归属管理员
        changed = False
        for model in (Dataset, Task, AnnotationJob):
            n = (
                db.query(model)
                .filter(model.user_id.is_(None))
                .update({"user_id": admin.id}, synchronize_session=False)
            )
            changed = changed or bool(n)
        if changed:
            db.commit()
    finally:
        db.close()


def _seed_default_annotation_template() -> None:
    """若 annotation_templates 为空，写入默认模版A（东东客服助手复用适配评测）。"""
    from .models import AnnotationTemplate

    db = SessionLocal()
    try:
        existing = db.query(AnnotationTemplate).first()
        if existing is not None:
            return
        # 数据列 = 客观信息；批注列 = 留白待填写的人工字段
        data_cols = [
            "query",
            "上文QA",
            "agent response",
            "场景",
            "会话id",
            "消息id",
            "意图",
            "子意图",
        ]
        anno_cols = [
            "P0问题类型",
            "P1问题类型",
            "是否需复核",
            "问题现象描述",
            "修改建议",
            "备注",
        ]
        tpl = AnnotationTemplate(
            name="东东客服助手复用适配评测",
            description="默认内置模版：客服助手评测",
            data_columns=data_cols,
            annotation_columns=anno_cols,
        )
        db.add(tpl)
        db.commit()
    finally:
        db.close()
