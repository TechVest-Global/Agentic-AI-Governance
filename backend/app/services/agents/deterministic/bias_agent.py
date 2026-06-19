from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_matches


class BiasAgent:
    name = "bias_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        keywords = ("bias", "fairness", "demographic")
        for metric in context.metric_results:
            if metric_matches(metric, keywords) and metric_failed(metric):
                findings.append(
                    finding(
                        finding_type="bias",
                        title=f"Bias metric failed: {metric.metric_id}",
                        summary="A fairness or bias-related metric failed during evaluation.",
                        severity=Severity.high,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action=(
                            "Review fairness test cases, protected-class coverage, "
                            "and mitigation strategy before approval."
                        ),
                        metric=metric,
                        confidence=0.86,
                    )
                )
        return findings
