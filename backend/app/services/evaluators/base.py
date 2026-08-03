from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from sqlmodel import Session

from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import MetricResultStatus, Modality
from app.schemas.governance import MetricPlanItem

if TYPE_CHECKING:
    from app.services.model_clients.base import TargetModelClient


def resolve_evaluator_endpoint(
    ai_system: AISystem,
    capabilities: Sequence[AISystemCapability],
    selected_capabilities: Sequence[str] = (),
) -> str:
    """Best endpoint for a real-tool evaluator (garak/presidio/ragas/deepeval)
    to probe with a free-text prompt.

    ``ai_system.target_endpoint_ref`` is correct for a single-endpoint system,
    but has no functional route at all for a system whose capabilities live
    under their own distinct paths (e.g. separate image/video/text generation
    endpoints registered under one AI system) — the bare base URL 404s.

    A scoped audit (``selected_capabilities`` set — an auditor picked a
    specific capability, e.g. an image-generation endpoint) probes THAT
    endpoint: these evaluators only ever send free text, never a capability's
    structured input schema, but a plain "prompt" field is still a valid
    generation request for most endpoints, so scoping still exercises the
    endpoint the auditor actually selected instead of silently substituting
    the system's text capability. Only when nothing was selected (a
    whole-application audit) does it fall back to preferring a text-modality
    capability's own endpoint_ref.
    """
    if selected_capabilities:
        by_ref = {c.endpoint_ref: c.endpoint_ref for c in capabilities}
        by_name = {c.name: c.endpoint_ref for c in capabilities}
        for selected in selected_capabilities:
            ref = by_ref.get(selected) or by_name.get(selected)
            if ref:
                return ref

    base = ai_system.target_endpoint_ref or ai_system.name or "default"
    for capability in capabilities:
        if capability.modality == Modality.text:
            return capability.endpoint_ref
    return base


def probe_endpoint(evaluation_input: "MetricEvaluationInput") -> str:
    """The endpoint this evaluator should actually probe.

    Use this rather than reading ``ai_system.target_endpoint_ref`` directly.
    The caller has already resolved a functional endpoint for this run (see
    resolve_evaluator_endpoint, called from metric_execution), honouring a scoped
    audit's selected capability and otherwise preferring a text capability's
    own path.

    Reading the bare base URL instead is not a harmless fallback: a system
    whose capabilities each live under their own path — separate image/text/
    video generation endpoints under one registration — serves nothing at its
    base URL, so every probe 404s and the metric reports the target as broken
    when it is fine. Observed live: pyrit_jailbreak_success_rate sent 10 probes
    to http://localhost:8001 and got 10 404s, while probes that used the
    resolved endpoint succeeded 23 times against the same system.

    The ai_system fallbacks below only apply when the caller resolved nothing
    at all, which is the single-endpoint case where the base URL is correct.
    """
    return (
        evaluation_input.target_endpoint_ref
        or evaluation_input.ai_system.target_endpoint_ref
        or evaluation_input.ai_system.name
        or "default"
    )


@dataclass(frozen=True)
class MetricEvaluationInput:
    metric: MetricPlanItem
    mock_score: float
    force_status: MetricResultStatus | None
    source_name: str
    # Real-tool evaluators (garak, presidio, ragas, deepeval) need these to
    # produce genuine evidence instead of a derived/placeholder score.
    session: Session
    ai_system: AISystem
    target_client: "TargetModelClient"
    # The specific endpoint these evaluators should probe. Callers resolve
    # this (see ModelBackedAgent._call_evidence_tool) rather than evaluators
    # defaulting to ai_system.target_endpoint_ref themselves — that default is
    # only correct for a single-endpoint system; a multi-capability system
    # (e.g. separate image/video/text generation endpoints under one
    # registration) has no functional route at its bare base URL at all.
    target_endpoint_ref: str
    # The system's registered capabilities — lets an evaluator that designs its
    # own test prompts (see deepeval_evaluator._design_prompt) describe what
    # this specific system actually does, instead of guessing from system_type
    # alone. Optional: evaluators that don't design prompts ignore it, and
    # every existing call site predates this field, so it defaults to empty.
    capabilities: Sequence[AISystemCapability] = ()
    # The run this evaluation belongs to — lets an evaluator that receives
    # generated media (e.g. VisionEvaluator) persist it as an
    # ExecutionArtifact. None for the standalone Security Tools button, which
    # probes ad hoc, outside of any evaluation run.
    run_id: UUID | None = None


@dataclass(frozen=True)
class MetricEvaluationResult:
    source_type: str
    tool_name: str
    raw_score: float | None
    normalized_score: float | None
    threshold: float | None
    passed: bool | None
    status: MetricResultStatus
    payload: dict[str, object]


class MetricEvaluator(Protocol):
    name: str

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        """Evaluate one planned metric and return normalized evidence/result data."""
