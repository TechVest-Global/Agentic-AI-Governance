from uuid import uuid4

from app.services.model_clients.base import (
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.sanitization import sanitize_target_output


class MockTargetModelClient:
    def __init__(self, *, provider: str, credential_ref: str | None = None) -> None:
        self.provider = provider
        self.credential_ref = credential_ref

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        raw_output = (
            f"Mock target response for capability "
            f"{request.capability_name or 'default'}: {request.prompt}"
        )
        sanitized = sanitize_target_output(raw_output)
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=f"target-{uuid4()}",
            latency_ms=0,
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

