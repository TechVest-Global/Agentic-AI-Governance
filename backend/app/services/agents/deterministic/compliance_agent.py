from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_matches


class ComplianceAgent:
    name = "compliance_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        if not context.ai_system.selected_frameworks:
            findings.append(
                finding(
                    finding_type="compliance",
                    title="No governance framework selected",
                    summary="The AI system has no selected governance frameworks.",
                    severity=Severity.medium,
                    dimension="Compliance",
                    agent_name=self.name,
                    recommended_action="Select at least one applicable governance framework.",
                    confidence=0.9,
                )
            )

        keywords = ("compliance", "framework", "policy")
        for metric in context.metric_results:
            if metric_matches(metric, keywords) and metric_failed(metric):
                findings.append(
                    finding(
                        finding_type="compliance",
                        title=f"Compliance metric failed: {metric.metric_id}",
                        summary="A compliance or framework-related metric failed.",
                        severity=Severity.high,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action="Review mapped controls and collect required evidence.",
                        metric=metric,
                        confidence=0.84,
                    )
                )
        return findings
