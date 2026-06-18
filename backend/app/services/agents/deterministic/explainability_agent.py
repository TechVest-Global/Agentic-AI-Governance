from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_matches


class ExplainabilityAgent:
    name = "explainability_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        keywords = ("explain", "rationale", "transparency")
        for metric in context.metric_results:
            if metric_matches(metric, keywords) and metric_failed(metric):
                findings.append(
                    finding(
                        finding_type="explainability",
                        title=f"Explainability metric failed: {metric.metric_id}",
                        summary="The system did not meet explainability expectations.",
                        severity=Severity.medium,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action=(
                            "Improve rationale generation, citations, or user-facing "
                            "explanation controls."
                        ),
                        metric=metric,
                        confidence=0.82,
                    )
                )
        return findings
