from dataclasses import dataclass
from typing import Protocol

from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.schemas.governance import FindingCreate


@dataclass(frozen=True)
class AgentContext:
    ai_system: AISystem
    context_profile: ApplicationContextProfile | None
    capabilities: list[AISystemCapability]
    evidence: list[EvidenceRecord]
    metric_results: list[MetricResult]
    existing_findings: list[Finding]


class GovernanceAgent(Protocol):
    name: str
    execution_mode: str  # "deterministic" or "model_backed"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        """Return findings that should be persisted for this run."""
