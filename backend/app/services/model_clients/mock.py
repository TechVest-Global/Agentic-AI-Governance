from uuid import uuid4

from app.services.model_clients.base import (
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.sanitization import sanitize_target_output


class MockTargetModelClient:
    # Echoes back whatever media it was given, so vision/audio evaluators have
    # a real (if trivial) media-capable client to exercise in tests/local dev.
    supports_media = True

    def __init__(self, *, provider: str, credential_ref: str | None = None) -> None:
        self.provider = provider
        self.credential_ref = credential_ref

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        media_note = f" [received {len(request.media)} media asset(s)]" if request.media else ""
        raw_output = (
            f"Mock target response for capability "
            f"{request.capability_name or 'default'}: {request.prompt}{media_note}"
        )
        sanitized = sanitize_target_output(raw_output)
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=f"target-{uuid4()}",
            latency_ms=0,
            media=list(request.media),
            metadata={
                "client_mode": "mock",
                "credential_ref": self.credential_ref,
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
                "warnings": sanitized.warnings,
            },
        )


class MockGovernanceModelClient:
    def __init__(
        self,
        *,
        provider: str,
        deployment_name: str | None = None,
        credential_ref: str | None = None,
    ) -> None:
        self.provider = provider
        self.deployment_name = deployment_name
        self.credential_ref = credential_ref

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        return GovernanceModelResponse(
            provider=self.provider,
            deployment_name=self.deployment_name,
            content=(
                f"Mock governance response for task '{request.task}'. "
                "Real Azure AI Foundry execution is intentionally not wired yet."
            ),
            trace_id=f"governance-{uuid4()}",
            latency_ms=0,
            metadata={
                "client_mode": "mock",
                "credential_ref": self.credential_ref,
                "context_keys": sorted(request.context),
            },
        )



def is_mock_governance_client(client: object) -> bool:
    """Whether this client is a mock rather than a real governance model.

    Checks past the Gateway wrapper, which every registry-built client is
    wrapped in, so the mock is still detected once wrapped.

    Callers use this for two different things: recording that a verdict is
    non-evidential, and deciding whether re-asking the model could plausibly
    change its answer. A mock returns the same canned response every time, so
    a retry against one only burns a call.
    """
    inner = getattr(client, "_inner", client)
    return isinstance(inner, MockGovernanceModelClient) or "Mock" in type(inner).__name__
