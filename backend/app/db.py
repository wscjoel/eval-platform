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
