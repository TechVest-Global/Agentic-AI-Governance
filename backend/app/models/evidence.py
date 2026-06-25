from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import MetricResultStatus


class EvidenceRecord(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "evidence_records"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    ai_system_capability_id: UUID | None = Field(
        default=None,
        foreign_key="ai_system_capabilities.id",
        index=True,
    )
    source_type: str = Field(index=True, min_length=1, max_length=100)
    source_name: str = Field(index=True, min_length=1, max_length=200)
    tool_name: str | None = Field(default=None, max_length=100)
    tool_version: str | None = Field(default=None, max_length=100)
    input_ref: str | None = Field(default=None, max_length=500)
    output_ref: str | None = Field(default=None, max_length=500)
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    trace_id: str | None = Field(default=None, index=True, max_length=200)
    sensitivity: str = Field(default="internal", index=True, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class MetricResult(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "metric_results"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    ai_system_capability_id: UUID | None = Field(
        default=None,
        foreign_key="ai_system_capabilities.id",
        index=True,
    )
    metric_id: str = Field(index=True, min_length=1, max_length=100)
    dimension: str = Field(index=True, min_length=1, max_length=200)
    tool_name: str = Field(index=True, min_length=1, max_length=100)
    status: MetricResultStatus = Field(default=MetricResultStatus.pending, index=True)
    raw_score: float | None = None
    normalized_score: float | None = None
    threshold: float | None = None
    passed: bool | None = None
    evidence_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
