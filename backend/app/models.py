"""SQLAlchemy ORM 模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")  # admin / user
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    login_records: Mapped[List["LoginRecord"]] = relationship(back_populates="user")


class LoginRecord(Base):
    __tablename__ = "login_records"
    __table_args__ = (Index("ix_login_records_user_time", "user_id", "login_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    username: Mapped[str] = mapped_column(String(64), default="")  # 登录时输入的用户名（失败时也记录）
    success: Mapped[bool] = mapped_column(default=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    login_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped[Optional["User"]] = relationship(back_populates="login_records")


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(512))
    rows: Mapped[int] = mapped_column(Integer)
    columns_json: Mapped[List[str]] = mapped_column(JSON)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    tasks: Mapped[List["Task"]] = relationship(back_populates="dataset", cascade="all,delete")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    model: Mapped[str] = mapped_column(String(128))
    prompt_template: Mapped[str] = mapped_column(Text)
    json_schema: Mapped[str] = mapped_column(Text, default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending/running/done/failed
    total: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    succeeded: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    dataset: Mapped["Dataset"] = relationship(back_populates="tasks")
    results: Mapped[List["Result"]] = relationship(back_populates="task", cascade="all,delete")


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str] = mapped_column(String(1024), default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    prompt_template: Mapped[str] = mapped_column(Text)
    json_schema: Mapped[str] = mapped_column(Text, default="")
    default_model: Mapped[str] = mapped_column(String(128), default="")
    default_temperature: Mapped[float] = mapped_column(Float, default=0.2)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Result(Base):
    __tablename__ = "results"
    __table_args__ = (Index("ix_results_task_row", "task_id", "row_index", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    row_index: Mapped[int] = mapped_column(Integer)
    input_json: Mapped[dict] = mapped_column(JSON)
    raw_output: Mapped[str] = mapped_column(Text, default="")
    parsed_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    parse_ok: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending/success/parse_error/failed
    error: Mapped[str] = mapped_column(Text, default="")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    task: Mapped["Task"] = relationship(back_populates="results")


class AnnotationTemplate(Base):
    __tablename__ = "annotation_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str] = mapped_column(String(1024), default="")
    data_columns: Mapped[List[str]] = mapped_column(JSON, default=list)
    annotation_columns: Mapped[List[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    dimensions: Mapped[List["AnnotationDimensionConfig"]] = relationship(
        back_populates="template", cascade="all,delete"
    )
    jobs: Mapped[List["AnnotationJob"]] = relationship(back_populates="template")


class AnnotationDimensionConfig(Base):
    __tablename__ = "annotation_dimension_configs"
    __table_args__ = (
        UniqueConstraint("template_id", "dimension_name", name="uq_dim_template_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("annotation_templates.id", ondelete="CASCADE")
    )
    dimension_name: Mapped[str] = mapped_column(String(255))
    input_type: Mapped[str] = mapped_column(String(16), default="options")  # 'options' | 'text'
    select_mode: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)  # 'single' | 'multi'
    options_text: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    template: Mapped["AnnotationTemplate"] = relationship(back_populates="dimensions")


class AnnotationJob(Base):
    __tablename__ = "annotation_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    template_id: Mapped[int] = mapped_column(
        ForeignKey("annotation_templates.id", ondelete="CASCADE")
    )
    source_filename: Mapped[str] = mapped_column(String(512))  # 原始上传文件名
    source_path: Mapped[str] = mapped_column(String(512))  # 服务器上保存的文件名
    source_columns: Mapped[List[str]] = mapped_column(JSON, default=list)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    column_mapping: Mapped[dict] = mapped_column(JSON, default=dict)  # 模版字段->上传列名
    selected_dimensions: Mapped[List[str]] = mapped_column(JSON, default=list)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    template: Mapped["AnnotationTemplate"] = relationship(back_populates="jobs")
    annotations: Mapped[List["Annotation"]] = relationship(
        back_populates="job", cascade="all,delete"
    )


class CleaningScriptTemplate(Base):
    __tablename__ = "cleaning_script_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str] = mapped_column(String(1024), default="")
    code: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[str] = mapped_column(String(16), default="text")  # 'text' | 'table'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Annotation(Base):
    __tablename__ = "annotations"
    __table_args__ = (
        UniqueConstraint("job_id", "row_index", "dimension_name", name="uq_anno_job_row_dim"),
        Index("ix_anno_job_row", "job_id", "row_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("annotation_jobs.id", ondelete="CASCADE"))
    row_index: Mapped[int] = mapped_column(Integer)
    dimension_name: Mapped[str] = mapped_column(String(255))
    value: Mapped[str] = mapped_column(Text, default="")  # 多选用 JSON 序列化
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    job: Mapped["AnnotationJob"] = relationship(back_populates="annotations")
