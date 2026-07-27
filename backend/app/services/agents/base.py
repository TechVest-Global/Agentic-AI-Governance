from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from sqlmodel import Session

from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.schemas.governance import FindingCreate, MetricPlanItem
from app.services.evaluators.base import resolve_evaluator_endpoint

if TYPE_CHECKING:
    from app.services.model_clients.base import TargetModelClient


@dataclass(frozen=True)
class AgentContext:
    ai_system: AISystem
    context_profile: ApplicationContextProfile | None
    capabilities: list[AISystemCapability]
    evidence: list[EvidenceRecord]
    metric_results: list[MetricResult]
    existing_findings: list[Finding]
    # The run this context belongs to — lets a probe that receives generated
    # media (image/audio/video) persist it as an ExecutionArtifact. None for
    # any caller that builds a context outside a real run (e.g. some tests).
    run_id: UUID | None = None
    # metric_id -> normalized_score from the most recent prior completed run
    prior_metric_scores: dict[str, float | None] = None  # type: ignore[assignment]
    # agent_name -> probes allocated by the Layer 2 evaluation plan (adaptive_orchestrator).
    # Model-backed agents scale their probe count to this budget instead of a fixed count.
    probe_budgets: dict[str, int] = None  # type: ignore[assignment]
    # Full metric plan items (real threshold_rules/scoring_config), so agents can
    # invoke a real evidence-tool evaluator (garak/presidio/ragas/deepeval) directly
    # instead of only reasoning over pre-computed metric_results.
    metric_plan_items: list[MetricPlanItem] = None  # type: ignore[assignment]
    session: Session | None = None
    target_client: "TargetModelClient | None" = None
    # agent_name -> number of probes the agent actually sent this run. Model-backed
    # agents record their probe count here so the SSE progress endpoint can report
    # a real "Probes Sent" figure instead of a hardcoded 0.
    probe_counts: dict[str, int] = None  # type: ignore[assignment]
    # agent_name -> probes it declined to send this run (capability modality
    # didn't match), each a dict with endpoint_ref/probe_name/dimension/reason.
    # An honest record of coverage gaps, never a fabricated result — see
    # ModelBackedAgent._execute_probe_plan's fail-closed modality gate.
    probe_skips: dict[str, list[dict]] = None  # type: ignore[assignment]
    # Audit scope: capability endpoint_refs to probe (e.g. ["parse-resume"]).
    # Empty = whole application (probe the system's base endpoint).
    selected_capabilities: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        # default to empty dict so agents can always do .get() safely
        if self.prior_metric_scores is None:
            object.__setattr__(self, "prior_metric_scores", {})
        if self.probe_budgets is None:
            object.__setattr__(self, "probe_budgets", {})
        if self.metric_plan_items is None:
            object.__setattr__(self, "metric_plan_items", [])
        if self.probe_counts is None:
            object.__setattr__(self, "probe_counts", {})
        if self.probe_skips is None:
            object.__setattr__(self, "probe_skips", {})
        if self.selected_capabilities is None:
            object.__setattr__(self, "selected_capabilities", [])

    def probe_endpoints(self) -> list[str]:
        """Endpoint refs a model-backed agent should probe.

        When the run scoped the audit to specific capabilities, return those
        endpoint_refs (resolving each selected capability to its real
        endpoint_ref). Otherwise probe EVERY registered capability — unlike
        evaluator tool calls (garak/presidio/ragas/deepeval), which only ever
        send free text and so are correctly restricted to a single
        text-modality endpoint (see resolve_evaluator_endpoint), a
        specialist agent can design a real structured probe for a non-text
        capability too (see ModelBackedAgent._design_probes_dynamically +
        the fail-closed modality gate in _execute_probe_plan). Collapsing to
        one endpoint here meant image/video capabilities were never even
        attempted during a whole-application audit — not skipped-with-a-
        reason, simply never in the list of endpoints considered.

        A system with no registered capabilities at all still falls back to
        the single best default (its own base URL, or "default").
        """
        base = (
            getattr(self.ai_system, "target_endpoint_ref", None)
            or getattr(self.ai_system, "name", None)
            or "default"
        )
        if not self.selected_capabilities:
            if self.capabilities:
                resolved: list[str] = []
                for capability in self.capabilities:
                    if capability.endpoint_ref not in resolved:
                        resolved.append(capability.endpoint_ref)
                return resolved
            return [resolve_evaluator_endpoint(self.ai_system, self.capabilities)]

        # Map selected values (endpoint_ref or capability name) to endpoint_refs.
        by_ref = {c.endpoint_ref: c.endpoint_ref for c in self.capabilities}
        by_name = {c.name: c.endpoint_ref for c in self.capabilities}
        resolved: list[str] = []
        for selected in self.selected_capabilities:
            ref = by_ref.get(selected) or by_name.get(selected) or selected
            if ref not in resolved:
                resolved.append(ref)
        return resolved or [base]


class GovernanceAgent(Protocol):
    name: str
    execution_mode: str  # "deterministic" or "model_backed"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        """Return findings that should be persisted for this run."""
