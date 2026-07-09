from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import RunPhase, RunStatus


class EvaluationRun(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "evaluation_runs"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    status: RunStatus = Field(default=RunStatus.created, index=True)
    current_phase: RunPhase = Field(default=RunPhase.created, index=True)
    selected_frameworks: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    selected_metrics: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    # Audit scope: capability endpoint_refs to probe (e.g. ["parse-resume",
    # "rank-candidates"]). Empty = audit the whole application (base endpoint).
    selected_capabilities: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_by: str | None = Field(default=None, max_length=200)
    result_summary: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    error_summary: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
