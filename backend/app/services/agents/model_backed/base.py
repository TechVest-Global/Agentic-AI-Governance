"""Shared infrastructure for model-backed agents.

Provides the building blocks every model-backed agent uses:
- _probe_target(): send a probe to the audited system, sanitize + fence output
- _ask_governance(): send a reasoning request to the governance model
- _ask_governance_with_json_retry(): one automatic retry when response is non-JSON
- _call_evidence_tool(): invoke a real evidence tool (garak/presidio/ragas/deepeval)
  for one of this agent's owned metrics, so findings are informed by real tool
  output rather than LLM reasoning alone

The two clients are never mixed: target output is always fenced as UNTRUSTED
evidence before it enters a governance prompt.
"""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from app.services.agents.base import AgentContext
from app.services.agents.probe_library import (
    ProbeSet,
    classify_system,
    probes_for,
    probes_for_endpoint,
)
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelClient,
    TargetModelRequest,
)
from app.services.model_clients.gateway import bind_log_capture, get_log_buffer
from app.services.model_clients.sanitization import (
    SanitizedTargetOutput,
    fence_untrusted_target_output,
    sanitize_target_output,
)

logger = logging.getLogger(__name__)

# Probes are independent HTTP calls to the audited system, each dominated by
# network latency (seconds per call, dozens per agent once the plan's probe
# budget scales the set up). Running them sequentially made the specialist
# agent phase the longest part of an audit. Bounded so the target isn't
# hammered.
_MAX_PROBE_WORKERS = int(os.getenv("AGENT_PROBE_MAX_WORKERS", "6"))


@dataclass(frozen=True)
class ToolCallResult:
    tool_name: str
    metric_id: str
    formula: str
    status: str
    normalized_score: float | None
    passed: bool | None
    payload: dict[str, object]

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
    # The facet this agent probes ("bias", "misuse", "explainability", ...).
    # Used to pick system-appropriate probes from the probe library. Left as
    # None for agents that have not opted into system-aware probe selection —
    # those keep their own curated probe set unchanged.
    probe_dimension: str | None = None

    def __init__(
        self,
        target_client: TargetModelClient,
        governance_client: GovernanceModelClient,
    ) -> None:
        self._target = target_client
        self._governance = governance_client

    def _choose_probes(self, fallback: ProbeSet, *, context: AgentContext) -> ProbeSet:
        """Pick a system-appropriate probe set (no budget scaling).

        Returns probes tailored to the audited system's category (e.g. a RAG
        assistant gets grounding/injection-via-retrieval probes instead of
        hiring/loan probes) when the agent declares a ``probe_dimension`` and the
        library has a tailored set; otherwise ``fallback``.
        """
        if self.probe_dimension:
            profile = classify_system(getattr(context.ai_system, "system_type", None))
            return probes_for(self.probe_dimension, profile, fallback)
        return fallback

    def _select_probes(
        self,
        fallback: ProbeSet,
        *,
        context: AgentContext,
    ) -> ProbeSet:
        """Choose system-appropriate probes, scale them to the probe budget, and
        record the probe count so run progress can report it.
        """
        chosen = self._choose_probes(fallback, context=context)
        plan = self._scale_to_budget(chosen, context=context)
        # Record the real probe count for this agent (read by agent_execution
        # and surfaced in the SSE "Probes Sent" tile).
        context.probe_counts[self.name] = len(plan)
        return plan

    def _run_probes(
        self,
        fallback: ProbeSet,
        *,
        context: AgentContext,
    ) -> list["TargetProbeResult"]:
        """Send this agent's probes to the in-scope endpoint(s) and return results.

        Whole-application audit (no ``selected_capabilities``): the budget-scaled
        probe set is sent to the system's base endpoint — identical to prior
        behavior. Scoped audit (specific capabilities selected): the curated
        probe set (not budget-scaled, to avoid an N-endpoints x budget blow-up)
        is sent to EACH selected capability endpoint, so an auditor can target
        just parse-resume, rank-candidates, etc. Records the true probe count.
        """
        endpoints = context.probe_endpoints()
        scoped = bool(context.selected_capabilities)
        profile = (
            classify_system(getattr(context.ai_system, "system_type", None))
            if self.probe_dimension
            else None
        )

        # Build the full probe plan first, then execute it concurrently — each
        # probe is an independent HTTP call to the audited system, so ordering
        # only matters for the returned list (executor.map preserves it).
        probe_plan: list[tuple[str, str, str]] = []  # (endpoint_ref, capability_name, prompt)
        if not scoped:
            # Whole application: budget-scaled system-type probes to the base endpoint.
            plan = self._select_probes(fallback, context=context)
            for endpoint_ref in endpoints:
                for probe_name, prompt in plan:
                    probe_plan.append((endpoint_ref, probe_name, prompt))
        else:
            # Scoped: probe each selected function with probes relevant to THAT
            # function (falling back to system-type probes when none tailored).
            for endpoint_ref in endpoints:
                if self.probe_dimension and profile is not None:
                    plan = probes_for_endpoint(
                        self.probe_dimension, endpoint_ref, profile, fallback
                    )
                else:
                    plan = fallback
                for probe_name, prompt in plan:
                    probe_plan.append((endpoint_ref, f"{probe_name}@{endpoint_ref}", prompt))

        results = self._execute_probe_plan(probe_plan, agent_name=self.name)
        context.probe_counts[self.name] = len(results)
        return results

    def _execute_probe_plan(
        self,
        probe_plan: list[tuple[str, str, str]],
        *,
        agent_name: str,
    ) -> list["TargetProbeResult"]:
        """Send the planned probes to the target concurrently, preserving order."""
        if not probe_plan:
            return []
        capture_buffer = get_log_buffer()

        def _send(item: tuple[str, str, str]) -> TargetProbeResult:
            endpoint_ref, capability_name, prompt = item
            # contextvars don't cross thread boundaries — rebind the audit
            # buffer and agent attribution so worker-thread probes are captured.
            bind_log_capture(capture_buffer, agent_name=agent_name)
            return self._probe_target(
                endpoint_ref=endpoint_ref, prompt=prompt, capability_name=capability_name
            )

        if len(probe_plan) == 1:
            return [_send(probe_plan[0])]
        worker_count = max(1, min(_MAX_PROBE_WORKERS, len(probe_plan)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            return list(pool.map(_send, probe_plan))

    def _probe_plan(
        self,
        prompts: list[tuple[str, str]],
        *,
        context: AgentContext,
    ) -> list[tuple[str, str]]:
        """Backward-compatible alias: scale a fixed probe set and record count."""
        plan = self._scale_to_budget(prompts, context=context)
        context.probe_counts[self.name] = len(plan)
        return plan

    def _scale_to_budget(
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

    def _call_evidence_tool(
        self,
        *,
        tool_name: str,
        metric_ids: set[str],
        context: AgentContext,
    ) -> list[ToolCallResult]:
        """Invoke a real evidence-tool evaluator (garak/presidio/ragas/deepeval)
        for each of this agent's owned metrics that has a matching planned
        metric item, so findings are grounded in real tool output.

        Returns one ToolCallResult per metric actually scored. Metrics with no
        matching plan item, or where the tool cleanly skips (e.g. no judge LLM
        configured, no retrieval context seeded), are simply omitted — callers
        should treat an empty list as "no real tool evidence available" and
        fall back to LLM-only reasoning.
        """
        from app.services.evaluators.base import MetricEvaluationInput
        from app.services.evaluators.registry import EVALUATORS

        evaluator = EVALUATORS.get(tool_name)
        if evaluator is None or context.session is None or context.target_client is None:
            return []

        results: list[ToolCallResult] = []
        for plan_item in context.metric_plan_items:
            if plan_item.metric_id not in metric_ids:
                continue
            try:
                evaluation = evaluator.evaluate(
                    MetricEvaluationInput(
                        metric=plan_item,
                        mock_score=0.5,
                        force_status=None,
                        source_name=f"{self.name}_tool_call",
                        session=context.session,
                        ai_system=context.ai_system,
                        target_client=context.target_client,
                    )
                )
            except Exception as exc:
                logger.error(
                    "%s: tool call to %s failed for metric %s: %s",
                    self.__class__.__name__,
                    tool_name,
                    plan_item.metric_id,
                    exc,
                )
                continue

            formula = str(plan_item.scoring_config.get("formula", ""))
            results.append(
                ToolCallResult(
                    tool_name=tool_name,
                    metric_id=plan_item.metric_id,
                    formula=formula,
                    status=str(evaluation.status),
                    normalized_score=evaluation.normalized_score,
                    passed=evaluation.passed,
                    payload=evaluation.payload,
                )
            )
        return results

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
