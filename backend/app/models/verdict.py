from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import ActionTier


class Verdict(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "verdicts"

    run_id: UUID = Field(foreign_key="evaluation_runs.id", index=True, unique=True)
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    action_tier: ActionTier = Field(default=ActionTier.human_review, index=True)
    label: str = Field(index=True, min_length=1, max_length=100)
    synthesis: str | None = None
    objections: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    reasoning: str | None = None
    required_actions: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
