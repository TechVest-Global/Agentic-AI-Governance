from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class TargetModelRequest:
    endpoint_ref: str
    prompt: str
    capability_name: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


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

