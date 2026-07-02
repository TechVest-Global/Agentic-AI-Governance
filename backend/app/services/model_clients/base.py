from dataclasses import dataclass, field
from typing import Literal, Protocol

# Model tier for a governance call. "premium" → the main judge model (all
# specialist reasoning, council deliberation, verdicts). "cheap" → a cheaper
# deployment reserved for future lightweight helper tasks (summaries, field
# extraction, formatting). No existing agent uses "cheap".
ModelTier = Literal["premium", "cheap"]


@dataclass(frozen=True)
class TargetModelRequest:
    endpoint_ref: str
    prompt: str
    capability_name: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)
    # Optional per-request auth/shape overrides. When set (by a resolved
    # per-endpoint config), the HTTP target client uses these instead of its
    # constructor defaults, so one client instance can serve many endpoints
    # that each carry their own credentials and request/response field names.
    auth: "TargetAuth | None" = None


@dataclass(frozen=True)
class TargetAuth:
    """Per-endpoint auth + request shape resolved from a registered endpoint."""

    api_key: str | None = None
    auth_header: str = "Authorization"
    auth_scheme: str = "Bearer"
    request_field: str = "message"
    response_field: str = "response"
    timeout: float | None = None


@dataclass(frozen=True)
class TargetModelResponse:
    provider: str
    endpoint_ref: str
    raw_output: str
    sanitized_output: str
    trace_id: str
    latency_ms: int
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class GovernanceModelRequest:
    task: str
    prompt: str
    context: dict[str, object] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)
    # Routing tier. Defaults to premium so every current call (all agents,
    # council, verdict) uses the main judge model. Set "cheap" only for future
    # lightweight helper tasks.
    tier: ModelTier = "premium"


@dataclass(frozen=True)
class GovernanceModelResponse:
    provider: str
    deployment_name: str | None
    content: str
    trace_id: str
    latency_ms: int
    metadata: dict[str, object] = field(default_factory=dict)


class TargetModelClient(Protocol):
    provider: str
    credential_ref: str | None

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        """Call the audited application or model through an isolated target boundary."""


class GovernanceModelClient(Protocol):
    provider: str
    credential_ref: str | None

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        """Call the approved governance reasoning model."""

