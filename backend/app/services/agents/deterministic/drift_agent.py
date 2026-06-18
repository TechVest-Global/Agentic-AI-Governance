from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_matches, metric_pending


class DriftAgent:
    name = "drift_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        for metric in context.metric_results:
            if not metric_matches(metric, ("drift", "stability", "monitoring")):
                continue
            if metric_failed(metric):
                findings.append(
                    finding(
                        finding_type="drift",
                        title=f"Drift metric failed: {metric.metric_id}",
                        summary="A drift or stability monitoring metric failed.",
                        severity=Severity.high,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action="Review monitoring data and retraining triggers.",
                        metric=metric,
                        confidence=0.84,
                    )
                )
            elif metric_pending(metric):
                findings.append(
                    finding(
                        finding_type="drift",
                        title=f"Drift metric needs review: {metric.metric_id}",
                        summary="A drift or stability metric is pending or skipped.",
                        severity=Severity.medium,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action="Complete drift monitoring before final approval.",
                        metric=metric,
                        confidence=0.78,
                    )
                )
        return findings
