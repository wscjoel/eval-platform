"""Pydantic v2 schemas（请求/响应）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DatasetOut(BaseModel):
    id: int
    name: str
    filename: str
    rows: int
    columns: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class DatasetDetail(DatasetOut):
    preview: list[dict[str, Any]]


class TaskCreate(BaseModel):
    dataset_id: int
    name: str = Field(min_length=1, max_length=255)
    model: str
    prompt_template: str = Field(min_length=1)
    json_schema: str = ""
    temperature: float = 0.2
    api_key: str | None = None  # 前端可覆盖；否则用环境变量


class TaskOut(BaseModel):
    id: int
    dataset_id: int
    name: str
    model: str
    prompt_template: str
    json_schema: str
    temperature: float
    status: str
    total: int
    processed: int
    succeeded: int
    failed: int
    error: str
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class ResultOut(BaseModel):
    id: int
    task_id: int
    row_index: int
    input_json: dict[str, Any]
    raw_output: str
    parsed_json: dict[str, Any] | None
    parse_ok: bool
    status: str
    error: str
    latency_ms: int

    model_config = {"from_attributes": True}


class ResultsPage(BaseModel):
    total: int
    items: list[ResultOut]
    parsed_keys: list[str]  # 所有结果中出现过的解析字段，用于前端动态列


class TrialRequest(BaseModel):
    dataset_id: int
    model: str
    prompt_template: str
    json_schema: str = ""
    temperature: float = 0.2
    row_index: int = 0
    api_key: str | None = None


class TrialResponse(BaseModel):
    raw_output: str
    parsed_json: dict[str, Any] | None
    parse_ok: bool
    error: str
    latency_ms: int


class PromptTemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    system_prompt: str = ""
    prompt_template: str = Field(min_length=1)
    json_schema: str = ""
    default_model: str = ""
    default_temperature: float = 0.2


class PromptTemplateCreate(PromptTemplateBase):
    pass


class PromptTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    prompt_template: str | None = None
    json_schema: str | None = None
    default_model: str | None = None
    default_temperature: float | None = None


class PromptTemplateOut(PromptTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------- 人工批注 ----------------


class AnnotationTemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    data_columns: list[str] = []
    annotation_columns: list[str] = []


class AnnotationTemplateCreate(AnnotationTemplateBase):
    pass


class AnnotationTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data_columns: list[str] | None = None
    annotation_columns: list[str] | None = None


class DimensionConfigOut(BaseModel):
    dimension_name: str
    input_type: str  # 'options' | 'text'
    select_mode: str | None = None  # 'single' | 'multi'
    options_text: str = ""

    model_config = {"from_attributes": True}


class DimensionConfigUpdate(BaseModel):
    input_type: str
    select_mode: str | None = None
    options_text: str = ""


class AnnotationTemplateOut(AnnotationTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime
    dimensions: list[DimensionConfigOut] = []

    model_config = {"from_attributes": True}


class UploadParseResponse(BaseModel):
    """上传后预解析返回，用于映射步骤。"""

    source_path: str  # 服务器临时保存名
    source_filename: str  # 原始名
    columns: list[str]
    total_rows: int
    suggested_mapping: dict[str, str]  # 模版字段 -> 上传列名（猜测）
    empty_columns: list[str]  # 所有行都为空的列


class JobCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    template_id: int
    source_path: str
    source_filename: str
    column_mapping: dict[str, str]
    selected_dimensions: list[str]


class JobOut(BaseModel):
    id: int
    name: str
    template_id: int
    source_filename: str
    total_rows: int
    selected_dimensions: list[str]
    column_mapping: dict[str, str]
    annotated_rows: int = 0
    pending_rows: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobDetail(JobOut):
    source_columns: list[str] = []
    template: AnnotationTemplateOut | None = None


class RowSummary(BaseModel):
    row_index: int
    annotated: bool
    preview: str  # 数据列摘要文本


class RowsResponse(BaseModel):
    total: int
    items: list[RowSummary]


class RowDetail(BaseModel):
    row_index: int
    data: dict[str, str]  # 模版数据字段 -> 当前行内容
    annotations: dict[str, str]  # 维度名 -> 当前值（多选已 JSON 字符串）


class SaveAnnotationsIn(BaseModel):
    annotations: dict[str, str]  # 维度名 -> 值（多选传 JSON 字符串）


# ---------------- 数据清洗 ----------------


class CleaningSourceOut(BaseModel):
    """上传待清洗文件后的返回。"""

    source_id: str
    filename: str
    kind: str  # 'table' | 'text'
    columns: list[str] = []
    total_rows: int = 0
    text: str = ""
    table: list[dict[str, Any]] = []
    preview_text: str = ""  # 文本预览（截断）
    preview_table: list[dict[str, Any]] = []  # 表格预览（前 N 行）


class CleaningRunRequest(BaseModel):
    source_id: str
    code: str = Field(min_length=1)
    input_mode: str = Field(pattern="^(text|table)$")
    timeout_sec: int | None = None


class CleaningRunResponse(BaseModel):
    ok: bool
    output_kind: str = "text"
    output_text: str = ""
    output_table: list[dict[str, Any]] | None = None
    stdout: str = ""
    stderr: str = ""
    error: str = ""
    duration_ms: int = 0


class CleaningDownloadRequest(BaseModel):
    output_kind: str = Field(pattern="^(text|table)$")
    output_text: str | None = None
    output_table: list[dict[str, Any]] | None = None
    filename: str | None = None


class CleaningScriptTemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    code: str = Field(min_length=1)
    input_mode: str = Field(default="text", pattern="^(text|table)$")


class CleaningScriptTemplateCreate(CleaningScriptTemplateBase):
    pass


class CleaningScriptTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    code: str | None = None
    input_mode: str | None = None


class CleaningScriptTemplateOut(CleaningScriptTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
