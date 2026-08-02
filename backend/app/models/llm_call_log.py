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

    # WHICH audited surface this call hit (target calls only; None for governance
    # reasoning). A multi-endpoint system is several independent attack surfaces,
    # so "40 probes sent" is not an auditable claim unless it can be split by
    # endpoint — a run that probed /probe/text 40 times and /probe/image zero
    # times reported exactly the same totals as one that split them evenly.
    #
    # The endpoint was known at probe time all along (see the probe_plan tuples
    # in agents/model_backed/base.py) but was only ever smuggled into `task` as
    # a "probe_name@endpoint" string, and only when the system had more than one
    # endpoint — a display hack that existed to keep dict keys unique, not to
    # attribute anything. Indexed because every per-endpoint rollup groups on it.
    endpoint_ref: str | None = Field(default=None, index=True, max_length=500)

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

    # Why a call failed. `status` alone said only "error", so a 502 from the
    # audited app, an expired key, a connection refusal and a malformed response
    # all rendered as the same content-free ERROR row — the reason existed only
    # in the server log, if anywhere. error_detail carries the response body
    # where the target sent one (that is where an audited system explains
    # itself, e.g. "GPT-4o call failed: ..." behind a 502).
    error_type: str | None = Field(default=None, max_length=100)
    error_detail: str | None = Field(
        default=None, sa_column=Column("error_detail", sa.Text, nullable=True)
    )
    # Physical HTTP requests this ONE logical call cost. The Gateway retries
    # transient failures, so a throttled probe can be 3 requests; without this,
    # counting log rows understates real load on the audited system while
    # counting requests would overstate the number of probes. Both numbers are
    # now derivable, and a per-endpoint view can show them separately.
    attempts: int = Field(default=1)

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
