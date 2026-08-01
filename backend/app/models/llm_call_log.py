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
    # Which pipeline layer made the call (adaptive_orchestrator, metric_execution,
    # specialist_agents, deliberation_council). Without it a run's calls are one
    # flat list and an evaluator's probe is indistinguishable from an agent's.
    phase: str | None = Field(default=None, index=True, max_length=50)
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
    # Auditor-visible transcript. Recorded for BOTH call types — a finding's
    # governance reasoning shouldn't get less audit rigor than the probe
    # evidence it reasoned over — and on failed calls too, where the prompt is
    # kept even though no response came back.
    prompt_text: str | None = Field(
        default=None, sa_column=Column("prompt_text", sa.Text, nullable=True)
    )
    response_text: str | None = Field(
        default=None, sa_column=Column("response_text", sa.Text, nullable=True)
    )
    # Why a non-success call failed. Without this a failed probe shows a prompt,
    # a red "error" pill, and no explanation — leaving a reviewer unable to tell
    # a rate limit from an auth failure from a malformed request.
    error_text: str | None = Field(
        default=None, sa_column=Column("error_text", sa.Text, nullable=True)
    )
