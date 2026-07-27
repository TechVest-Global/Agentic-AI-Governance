"""LLM Call Log — audit record for every LLM API call in the governance pipeline.

Every call made through GatewayGovernanceModelClient or GatewayTargetModelClient
is recorded here with run_id linkage, token counts, latency, cost estimate, and
status. This makes LLM spend queryable alongside governance findings and verdicts.
"""

from uuid import UUID

import sqlalchemy as sa
from sqlalchemy import JSON, Column
from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey


class LLMCallLog(TimestampMixin, UUIDPrimaryKey, table=True):
    __tablename__ = "llm_call_logs"

    run_id: UUID | None = Field(default=None, foreign_key="evaluation_runs.id", index=True)
    agent_name: str | None = Field(default=None, index=True, max_length=100)
    task: str = Field(max_length=200)
    call_type: str = Field(default="governance", max_length=20)  # "governance" or "target"

    model: str = Field(max_length=100)
    deployment_name: str | None = Field(default=None, max_length=100)
    client_mode: str = Field(default="mock", max_length=20)   # "live" or "mock"
    routed_via: str | None = Field(default=None, max_length=50)  # "litellm_proxy" or None

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_cost_usd: float | None = None

    latency_ms: int = Field(default=0)
    status: str = Field(default="success", max_length=50)  # "success", "rate_limited", "error"

    request_chars: int = Field(default=0)
    response_chars: int = Field(default=0)

    trace_id: str | None = Field(default=None, max_length=100)
    policy_flags: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    # Auditor-visible probe transcript — stored only for target calls
    prompt_text: str | None = Field(
        default=None, sa_column=Column("prompt_text", sa.Text, nullable=True)
    )
    response_text: str | None = Field(
        default=None, sa_column=Column("response_text", sa.Text, nullable=True)
    )
