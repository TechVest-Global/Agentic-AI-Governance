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
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import lru_cache

from app.configs.prompt_registry import PromptRegistry, render
from app.models.ai_system import AISystemCapability
from app.models.enums import Modality
from app.services.agents.base import AgentContext
from app.services.agents.probe_library import (
    ProbePayload,
    ProbeSet,
    SystemProfile,
    classify_system,
    has_tailored_probes,
    payload_for_probe,
    probes_for,
    probes_for_endpoint,
    synthesize_structured_body,
    validate_dynamic_structured_probes,
    validate_dynamic_text_probes,
)
from app.services.execution_artifacts import record_execution_artifacts
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
    GovernanceModelResponse,
    MediaAsset,
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

# Shared, framework-agnostic probe-design template — used by every specialist
# agent when neither the endpoint- nor category-level static catalog has
# anything tailored for a capability. One shared template (not one per agent)
# because probe design doesn't need FrameworkConfig's per-agent instruction
# splicing — the framework-specific reasoning still happens later, unchanged,
# in each agent's own governance call over the collected evidence.
_PROBE_DESIGN_TEMPLATE_ID = "orchestrator.probe_design"
_PROBE_DESIGN_HASH = "b7ac30a0690ff5e50514fc2bb43cbfaea37acefb66452da5d07d250208588631"
_MIN_DYNAMIC_PROBE_COUNT = 1


@lru_cache(maxsize=1)
def _get_probe_design_registry() -> PromptRegistry:
    return PromptRegistry.from_directory()


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
    endpoint_ref: str = ""
    capability_name: str | None = None
    # Generated image/audio/video the target returned with this probe's
    # response, if any — see ExecutionArtifact / record_execution_artifacts.
    media: list[MediaAsset] = field(default_factory=list)


@dataclass(frozen=True)
class SkippedProbe:
    """A probe that was never sent because it's incompatible with the target
    capability — e.g. a text-only probe against an image-generation endpoint.

    Every probe in this module's static catalog (and every agent's own
    hardcoded fallback) is implicitly text-only; nothing here fabricates a
    result for a capability it has no real probe for. Recorded so the gap
    reads as an honest skip, never a silent success or a hard failure.
    """

    endpoint_ref: str
    probe_name: str
    dimension: str | None
    reason: str


@dataclass(frozen=True)
class ProbeExecutionOutcome:
    sent: list[TargetProbeResult]
    skipped: list[SkippedProbe]


class ModelBackedAgent:
    execution_mode = "model_backed"
    name: str
    # The facet this agent probes ("bias", "misuse", "explainability", ...).
    # Used to pick system-appropriate probes from the probe library. Left as
    # None for agents that have not opted into system-aware probe selection —
    # those keep their own curated probe set unchanged.
    probe_dimension: str | None = None

    @staticmethod
    def _verify_even_when_passing(context: AgentContext) -> bool:
        """Whether this run must probe the target even if all owned metrics passed.

        Historically every agent gated on failed/pending metrics and went
        completely silent when its metrics passed — so a high-risk system whose
        fairness metrics scored a (single-shot) 1.0 was never actually probed
        for bias. For high-risk systems the audit must verify passes with live
        probe evidence, not trust them: agents probe unconditionally and ask the
        governance model to confirm or challenge the passing scores.
        """
        from app.models.enums import RiskTier

        return getattr(context.ai_system, "risk_tier", None) == RiskTier.high

    def _metrics_for_review(
        self,
        context: AgentContext,
        *,
        metric_ids: set[str],
        keywords: tuple[str, ...],
    ) -> tuple[list, list]:
        """Split this agent's owned metrics into (review, attention) lists.

        ``owned``    = every metric result this agent is responsible for.
        ``attention``= the failed/pending subset (drives deterministic fallback
                       findings — passing metrics must never produce fallback
                       failure findings).
        ``review``   = what the agent probes/reasons over: the attention set,
                       or — in high-risk verification mode — ALL owned metrics
                       even when they passed.
        Returns (review, attention).
        """
        from app.services.agents.helpers import metric_failed, metric_pending

        owned = [
            m for m in context.metric_results
            if (
                m.metric_id in metric_ids
                or any(k in f"{m.metric_id} {m.dimension}".lower() for k in keywords)
            )
        ]
        attention = [m for m in owned if metric_failed(m) or metric_pending(m)]
        if attention:
            return attention, attention
        if owned and self._verify_even_when_passing(context):
            return owned, []
        return [], []

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

    def _design_probes_dynamically(
        self,
        *,
        context: AgentContext,
        capability: AISystemCapability | None,
        endpoint_ref: str,
        dimension: str,
        profile: SystemProfile,
    ) -> ProbeSet | list[tuple[str, dict]] | None:
        """Ask the governance model to design a probe for a capability this
        agent has no hand-curated or catalog-tailored probe for, constrained
        to the capability's real modality and declared input fields.

        Returns a text ``ProbeSet`` when the capability is text-modality, a
        list of ``(probe_name, fields)`` when it isn't, or ``None`` on any
        failure (LLM unreachable, bad JSON, nothing validates) — callers fall
        back to their existing static-fallback-or-skip behavior on ``None``,
        the same fail-closed contract ``_call_evidence_tool`` already has.
        """
        modality = capability.modality if capability is not None else Modality.text
        schema = capability.input_schema if capability is not None else {}
        try:
            template = _get_probe_design_registry().get(
                _PROBE_DESIGN_TEMPLATE_ID, _PROBE_DESIGN_HASH
            )
            prompt = render(
                template,
                {
                    "agent_name": self.name,
                    "dimension": dimension,
                    "system_name": context.ai_system.name or "unknown system",
                    "system_type_label": profile.label,
                    "capability_name": (
                        capability.name if capability is not None else endpoint_ref
                    ),
                    "capability_description": (
                        (capability.description or "") if capability is not None else ""
                    ),
                    "capability_modality": str(modality),
                    "capability_input_schema_json": json.dumps(schema),
                    "min_probe_count": str(_MIN_DYNAMIC_PROBE_COUNT),
                },
            )
            parsed = self._ask_governance_with_json_retry(
                task="dynamic_probe_design",
                prompt=prompt,
                context={
                    "agent_name": self.name,
                    "dimension": dimension,
                    "endpoint_ref": endpoint_ref,
                },
            )
        except Exception as exc:  # noqa: BLE001 - a probe-design failure must never crash the run
            logger.warning(
                "%s: dynamic probe design failed for %s: %s",
                self.__class__.__name__, endpoint_ref, exc,
            )
            return None
        if parsed is None:
            return None

        if modality is Modality.text:
            return validate_dynamic_text_probes(parsed, min_count=_MIN_DYNAMIC_PROBE_COUNT)
        if not schema:
            return None
        return validate_dynamic_structured_probes(
            schema, parsed, min_count=_MIN_DYNAMIC_PROBE_COUNT
        )

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

        Per endpoint: a tailored static probe (endpoint- or category-level) is
        used when one exists — free, deterministic, human-reviewed. Failing
        that, and only when something is actually known about the system
        (a non-blank/non-"unspecified" system_type — a genuinely blank type
        has no signal to design from), dynamic probe design is attempted
        instead of accepting the agent's generic fallback verbatim. Failing
        that too, the agent's own hardcoded fallback is used for text-modality
        capabilities; a non-text-modality capability with nothing tailored and
        no successful dynamic design is left to the fail-closed gate in
        ``_execute_probe_plan``.
        """
        endpoints = context.probe_endpoints()
        scoped = bool(context.selected_capabilities)
        profile = (
            classify_system(getattr(context.ai_system, "system_type", None))
            if self.probe_dimension
            else None
        )
        capability_by_endpoint = {c.endpoint_ref: c for c in context.capabilities}

        # Build the full probe plan first, then execute it concurrently — each
        # probe is an independent HTTP call to the audited system, so ordering
        # only matters for the returned list (executor.map preserves it).
        probe_plan: list[tuple[str, str, str]] = []  # (endpoint_ref, capability_name, prompt)
        dynamic_payloads: dict[str, ProbePayload] = {}

        def _extend(
            endpoint_ref: str, plan_or_fields: ProbeSet | list[tuple[str, dict]], *, tag: bool
        ) -> None:
            for probe_name, value in plan_or_fields:
                name = f"{probe_name}@{endpoint_ref}" if tag else probe_name
                if isinstance(value, dict):
                    dynamic_payloads[name] = ProbePayload(endpoint_ref, value)
                    probe_plan.append(
                        (endpoint_ref, name, f"[dynamically designed probe] fields={value}")
                    )
                else:
                    probe_plan.append((endpoint_ref, name, value))

        if not scoped:
            # Whole application: budget-scaled system-type probes, now sent to
            # EVERY registered capability endpoint (see probe_endpoints()).
            # Tag probe names by endpoint once there's more than one, so two
            # capabilities' probes (e.g. probeText and probeImage each getting
            # their own dynamically-designed "probe_1") never collide under
            # the same name in dynamic_payloads/probe_plan.
            dimension = self.probe_dimension
            tag_names = len(endpoints) > 1
            for endpoint_ref in endpoints:
                if dimension and profile is not None and not has_tailored_probes(
                    dimension, endpoint_ref, profile
                ):
                    dynamic = None
                    if profile.label and profile.label != "unspecified":
                        dynamic = self._design_probes_dynamically(
                            context=context,
                            capability=capability_by_endpoint.get(endpoint_ref),
                            endpoint_ref=endpoint_ref,
                            dimension=dimension,
                            profile=profile,
                        )
                    plan = self._scale_to_budget(dynamic, context=context) if dynamic else fallback
                else:
                    plan = self._select_probes(fallback, context=context)
                _extend(endpoint_ref, plan, tag=tag_names)
        else:
            # Scoped: probe each selected function with probes relevant to THAT
            # function (falling back to system-type probes when none tailored).
            for endpoint_ref in endpoints:
                dimension = self.probe_dimension
                if dimension and profile is not None:
                    if has_tailored_probes(dimension, endpoint_ref, profile):
                        plan = probes_for_endpoint(dimension, endpoint_ref, profile, fallback)
                        _extend(endpoint_ref, plan, tag=True)
                        continue
                    capability = capability_by_endpoint.get(endpoint_ref)
                    dynamic = (
                        self._design_probes_dynamically(
                            context=context,
                            capability=capability,
                            endpoint_ref=endpoint_ref,
                            dimension=dimension,
                            profile=profile,
                        )
                        if profile.label and profile.label != "unspecified"
                        else None
                    )
                    _extend(endpoint_ref, dynamic if dynamic else fallback, tag=True)
                else:
                    _extend(endpoint_ref, fallback, tag=True)

        outcome = self._execute_probe_plan(
            probe_plan,
            agent_name=self.name,
            capabilities=context.capabilities,
            dimension=self.probe_dimension,
            dynamic_payloads=dynamic_payloads,
        )
        context.probe_counts[self.name] = len(outcome.sent)
        if outcome.skipped:
            context.probe_skips[self.name] = [
                {
                    "endpoint_ref": s.endpoint_ref,
                    "probe_name": s.probe_name,
                    "dimension": s.dimension,
                    "reason": s.reason,
                }
                for s in outcome.skipped
            ]
        if context.session is not None and context.run_id is not None:
            for result in outcome.sent:
                if not result.media:
                    continue
                try:
                    record_execution_artifacts(
                        context.session,
                        run_id=context.run_id,
                        agent_name=self.name,
                        dimension=self.probe_dimension,
                        capability_name=result.capability_name,
                        endpoint_ref=result.endpoint_ref,
                        prompt_text=result.probe_prompt,
                        response_text=result.sanitized.text,
                        media=result.media,
                    )
                except Exception as exc:  # noqa: BLE001 - evidence capture must never fail a run
                    logger.warning(
                        "%s: failed to persist execution artifact for %s: %s",
                        self.__class__.__name__, result.endpoint_ref, exc,
                    )
        return outcome.sent

    def _execute_probe_plan(
        self,
        probe_plan: list[tuple[str, str, str]],
        *,
        agent_name: str,
        capabilities: Sequence[AISystemCapability] = (),
        dimension: str | None = None,
        dynamic_payloads: dict[str, ProbePayload] | None = None,
    ) -> ProbeExecutionOutcome:
        """Send the planned probes to the target concurrently, preserving order.

        Every probe reaching this function is implicitly text-only — the whole
        static catalog and every agent's hardcoded fallback are free-text
        prompts. A capability whose real modality isn't text (e.g. an
        image-generation endpoint) gets nothing sent to it here; it's recorded
        as a skip instead. This is the fail-closed gate: it protects any
        capability of any modality this codebase has never specifically
        catered for, not just the ones we know about today.
        """
        if not probe_plan:
            return ProbeExecutionOutcome(sent=[], skipped=[])
        capture_buffer = get_log_buffer()
        # endpoint_ref -> the capability's own input_schema, when the target
        # system registered one (e.g. via catalog import). Lets a probe with no
        # hand-curated payload still get a real structured body for a
        # schema-driven endpoint instead of falling back to plain text.
        schema_by_endpoint = {
            c.endpoint_ref: c.input_schema for c in capabilities if c.input_schema
        }
        modality_by_endpoint = {c.endpoint_ref: c.modality for c in capabilities}

        def _send(item: tuple[str, str, str]) -> TargetProbeResult | SkippedProbe:
            endpoint_ref, capability_name, prompt = item
            # A dynamically-designed probe already validated against this
            # capability's real modality/schema (see validate_dynamic_*
            # in probe_library.py) is exempt from the text-only gate below —
            # it's not a generic text probe misrouted to a non-text endpoint,
            # it's a structured payload built specifically for it.
            dynamic_payload = (
                dynamic_payloads.get(capability_name or "") if dynamic_payloads else None
            )
            capability_modality = modality_by_endpoint.get(endpoint_ref, Modality.text)
            if dynamic_payload is None and capability_modality is not Modality.text:
                return SkippedProbe(
                    endpoint_ref=endpoint_ref,
                    probe_name=capability_name,
                    dimension=dimension,
                    reason=(
                        f"probe is text-only; this capability's modality is "
                        f"'{capability_modality}'"
                    ),
                )
            # contextvars don't cross thread boundaries — rebind the audit
            # buffer and agent attribution so worker-thread probes are captured.
            bind_log_capture(capture_buffer, agent_name=agent_name)
            # A structured probe (e.g. HR candidate ranking, or a validated
            # dynamically-designed one) carries a JSON body and its own
            # endpoint so the audited function receives a real input instead
            # of having its prompt parsed as free text. capability_name holds
            # the probe name here ("probe_name" or "probe_name@endpoint").
            payload = payload_for_probe(capability_name or "") or dynamic_payload
            if payload is None:
                schema = schema_by_endpoint.get(endpoint_ref)
                if schema:
                    synthesized = synthesize_structured_body(schema, prompt)
                    if synthesized is not None:
                        payload = ProbePayload(endpoint_ref, synthesized)
            if payload is not None:
                return self._probe_target(
                    endpoint_ref=payload.endpoint,
                    prompt=prompt,
                    capability_name=capability_name,
                    payload=payload.body,
                )
            return self._probe_target(
                endpoint_ref=endpoint_ref, prompt=prompt, capability_name=capability_name
            )

        if len(probe_plan) == 1:
            results = [_send(probe_plan[0])]
        else:
            worker_count = max(1, min(_MAX_PROBE_WORKERS, len(probe_plan)))
            with ThreadPoolExecutor(max_workers=worker_count) as pool:
                results = list(pool.map(_send, probe_plan))

        sent = [r for r in results if isinstance(r, TargetProbeResult)]
        skipped = [r for r in results if isinstance(r, SkippedProbe)]
        return ProbeExecutionOutcome(sent=sent, skipped=skipped)

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
        from app.services.evaluators.base import MetricEvaluationInput, resolve_evaluator_endpoint
        from app.services.evaluators.registry import EVALUATORS

        evaluator = EVALUATORS.get(tool_name)
        if evaluator is None or context.session is None or context.target_client is None:
            return []

        # Scoped audit: probe the same capability the agent's own probes are
        # targeting. Whole-application audit: same resolution as everywhere
        # else — prefer a text-modality capability's real endpoint over the
        # system's bare base URL, which 404s for a multi-capability system
        # with no functional route at its base (see resolve_evaluator_endpoint).
        if context.selected_capabilities:
            endpoints = context.probe_endpoints()
            endpoint_ref = endpoints[0] if endpoints else resolve_evaluator_endpoint(
                context.ai_system, context.capabilities
            )
        else:
            endpoint_ref = resolve_evaluator_endpoint(context.ai_system, context.capabilities)

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
                        target_endpoint_ref=endpoint_ref,
                        run_id=context.run_id,
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
        payload: dict[str, object] | None = None,
    ) -> TargetProbeResult:
        # A structured ``payload`` is delivered as the request body (target
        # clients that support it read ``metadata["payload"]``); the ``prompt``
        # is still carried for provenance and for clients that ignore payloads.
        metadata = {"payload": payload} if payload else {}
        response = self._target.invoke(
            TargetModelRequest(
                endpoint_ref=endpoint_ref,
                prompt=prompt,
                capability_name=capability_name,
                metadata=metadata,
            )
        )
        sanitized = sanitize_target_output(response.raw_output)
        return TargetProbeResult(
            probe_prompt=prompt,
            sanitized=sanitized,
            fenced=fence_untrusted_target_output(sanitized),
            latency_ms=response.latency_ms,
            trace_id=response.trace_id,
            endpoint_ref=endpoint_ref,
            capability_name=capability_name,
            media=list(response.media),
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
