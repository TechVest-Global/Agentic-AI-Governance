from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from sqlmodel import Session

from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.schemas.governance import FindingCreate, MetricPlanItem

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


class GovernanceAgent(Protocol):
    name: str
    execution_mode: str  # "deterministic" or "model_backed"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        """Return findings that should be persisted for this run."""
