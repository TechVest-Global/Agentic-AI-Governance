from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import AgentExecutionStatus


class AgentExecution(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "agent_executions"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    agent_name: str = Field(index=True, min_length=1, max_length=100)
    status: AgentExecutionStatus = Field(
        default=AgentExecutionStatus.pending,
        index=True,
    )
    finding_count: int = Field(default=0, ge=0)
    started_at: datetime | None = Field(default=None, index=True)
    completed_at: datetime | None = Field(default=None, index=True)
    error_summary: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    metadata_json: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata_json", JSON, nullable=False),
    )
