from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from sqlmodel import Session

from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import Modality, MetricResultStatus
from app.schemas.governance import MetricPlanItem

if TYPE_CHECKING:
    from app.services.model_clients.base import TargetModelClient


def resolve_evaluator_endpoint(
    ai_system: AISystem, capabilities: Sequence[AISystemCapability]
) -> str:
    """Best endpoint for a real-tool evaluator (garak/presidio/ragas/deepeval)
    to probe with a free-text prompt.

    ``ai_system.target_endpoint_ref`` is correct for a single-endpoint system,
    but has no functional route at all for a system whose capabilities live
    under their own distinct paths (e.g. separate image/video/text generation
    endpoints registered under one AI system) — the bare base URL 404s.
    Prefer a text-modality capability's own endpoint_ref when one is
    registered; these evaluators only ever send free text, never a
    capability's structured input schema.
    """
    base = ai_system.target_endpoint_ref or ai_system.name or "default"
    for capability in capabilities:
        if capability.modality == Modality.text:
            return capability.endpoint_ref
    return base


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
