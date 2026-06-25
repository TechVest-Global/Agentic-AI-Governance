from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import LedgerActorType


class AuditLedgerEntry(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "audit_ledger_entries"
    __table_args__ = (UniqueConstraint("run_id", "sequence_number"),)

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True)
    sequence_number: int = Field(index=True, ge=1)
    event_type: str = Field(index=True, min_length=1, max_length=100)
    actor_type: LedgerActorType = Field(default=LedgerActorType.system, index=True)
    actor_id: str | None = Field(default=None, index=True, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    previous_hash: str | None = Field(default=None, max_length=128)
    entry_hash: str = Field(index=True, min_length=1, max_length=128)
