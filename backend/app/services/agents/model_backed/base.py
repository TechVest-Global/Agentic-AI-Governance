"""Shared infrastructure for model-backed agents.

Provides two building blocks every model-backed agent uses:
- _probe_target(): send a probe to the audited system, sanitize + fence output
- _ask_governance(): send a reasoning request to the governance model

The two clients are never mixed: target output is always fenced as UNTRUSTED
evidence before it enters a governance prompt.
"""

import json
from dataclasses import dataclass, field

from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelClient,
    TargetModelRequest,
)
from app.services.model_clients.sanitization import (
    SanitizedTargetOutput,
    fence_untrusted_target_output,
    sanitize_target_output,
)


@dataclass(frozen=True)
class TargetProbeResult:
    probe_prompt: str
    sanitized: SanitizedTargetOutput
    fenced: str
    latency_ms: int
    trace_id: str


class ModelBackedAgent:
    execution_mode = "model_backed"

    def __init__(
        self,
        target_client: TargetModelClient,
        governance_client: GovernanceModelClient,
    ) -> None:
        self._target = target_client
        self._governance = governance_client

    def _probe_target(
        self,
        *,
        endpoint_ref: str,
        prompt: str,
        capability_name: str | None = None,
    ) -> TargetProbeResult:
        response = self._target.invoke(
            TargetModelRequest(
                endpoint_ref=endpoint_ref,
                prompt=prompt,
                capability_name=capability_name,
            )
        )
        sanitized = sanitize_target_output(response.raw_output)
        return TargetProbeResult(
            probe_prompt=prompt,
            sanitized=sanitized,
            fenced=fence_untrusted_target_output(sanitized),
            latency_ms=response.latency_ms,
            trace_id=response.trace_id,
        )

    def _ask_governance(
        self,
        *,
        task: str,
        prompt: str,
        context: dict[str, object] | None = None,
    ) -> GovernanceModelResponse:
        return self._governance.complete(
            GovernanceModelRequest(
                task=task,
                prompt=prompt,
                context=context or {},
            )
        )

    @staticmethod
    def _parse_findings_json(content: str) -> list[dict[str, object]] | None:
        """Extract a JSON array of findings from governance model response.

        Returns None when the response is not valid JSON (e.g. mock mode),
        so callers can fall back to deterministic logic.
        """
        try:
            start = content.find("[")
            end = content.rfind("]") + 1
            if start == -1 or end == 0:
                return None
            return json.loads(content[start:end])
        except (json.JSONDecodeError, ValueError):
            return None
