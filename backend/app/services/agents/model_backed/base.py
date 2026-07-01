"""Shared infrastructure for model-backed agents.

Provides two building blocks every model-backed agent uses:
- _probe_target(): send a probe to the audited system, sanitize + fence output
- _ask_governance(): send a reasoning request to the governance model
- _ask_governance_with_json_retry(): one automatic retry when response is non-JSON

The two clients are never mixed: target output is always fenced as UNTRUSTED
evidence before it enters a governance prompt.
"""

import json
import logging
from dataclasses import dataclass

from app.services.agents.base import AgentContext
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

logger = logging.getLogger(__name__)

_JSON_RETRY_SUFFIX = (
    "\n\nIMPORTANT: Your previous response was not valid JSON. "
    "Return ONLY a valid JSON array with no markdown, no explanation, no code fences. "
    "Start your response with [ and end with ]."
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
    name: str

    def __init__(
        self,
        target_client: TargetModelClient,
        governance_client: GovernanceModelClient,
    ) -> None:
        self._target = target_client
        self._governance = governance_client

    def _probe_plan(
        self,
        prompts: list[tuple[str, str]],
        *,
        context: AgentContext,
    ) -> list[tuple[str, str]]:
        """Scale a fixed probe set up to this agent's planned probe budget.

        Repeats the curated prompt set round-robin (each repeat tagged with a
        pass number) so the agent sends as many probes as Layer 2 allocated,
        instead of always sending exactly len(prompts) regardless of budget.
        Never sends fewer than the curated set — that set is the minimum
        coverage needed to probe each dimension at least once.
        """
        budget = context.probe_budgets.get(self.name)
        if not budget or budget <= len(prompts):
            return prompts

        plan: list[tuple[str, str]] = []
        for i in range(budget):
            probe_name, prompt = prompts[i % len(prompts)]
            pass_number = i // len(prompts) + 1
            label = probe_name if pass_number == 1 else f"{probe_name}_pass{pass_number}"
            plan.append((label, prompt))
        return plan

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

    def _ask_governance_with_json_retry(
        self,
        *,
        task: str,
        prompt: str,
        context: dict[str, object] | None = None,
    ) -> list[dict[str, object]] | None:
        """Call governance model and parse JSON array; retry once if response is non-JSON."""
        response = self._ask_governance(task=task, prompt=prompt, context=context)
        parsed = self._parse_findings_json(response.content)
        if parsed is not None:
            return parsed

        logger.warning(
            "%s: governance response was not JSON on first attempt (task=%s), retrying",
            self.__class__.__name__,
            task,
        )
        retry_response = self._ask_governance(
            task=task,
            prompt=prompt + _JSON_RETRY_SUFFIX,
            context=context,
        )
        return self._parse_findings_json(retry_response.content)

    @staticmethod
    def _parse_findings_json(content: str) -> list[dict[str, object]] | None:
        """Extract a JSON array of findings from governance model response.

        Returns None when the response is not valid JSON, so callers can
        fall back to deterministic logic.
        """
        try:
            start = content.find("[")
            end = content.rfind("]") + 1
            if start == -1 or end == 0:
                return None
            return json.loads(content[start:end])
        except (json.JSONDecodeError, ValueError):
            return None
