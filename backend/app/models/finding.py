from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import FindingStatus, Severity


class Finding(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "findings"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    ai_system_capability_id: UUID | None = Field(
        default=None,
        foreign_key="ai_system_capabilities.id",
        index=True,
    )
    finding_type: str = Field(index=True, min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(min_length=1)
    severity: Severity = Field(default=Severity.medium, index=True)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    dimension: str = Field(index=True, min_length=1, max_length=200)
    framework_refs: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    evidence_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    agent_name: str | None = Field(default=None, index=True, max_length=100)
    recommended_action: str | None = None
    status: FindingStatus = Field(default=FindingStatus.open, index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
