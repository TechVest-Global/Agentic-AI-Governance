from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey


class GovernanceStateEntry(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "governance_state_entries"
    __table_args__ = (UniqueConstraint("run_id", "sequence_number"),)

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    sequence_number: int = Field(index=True, ge=1)
    entry_type: str = Field(index=True, min_length=1, max_length=100)
    source: str = Field(index=True, min_length=1, max_length=100)
    phase: str = Field(index=True, min_length=1, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    previous_hash: str | None = Field(default=None, max_length=128)
    entry_hash: str = Field(index=True, min_length=1, max_length=128)
