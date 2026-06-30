from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_matches

_QUALITY_METRIC_IDS = {"CM-001", "CM-002", "CM-003", "CM-004"}
_QUALITY_KEYWORDS = ("task", "instruction", "schema", "action", "completion", "success")


class QualityEvaluatorAgent:
    execution_mode = "deterministic"
    name = "quality_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        for metric in context.metric_results:
            if metric.metric_id not in _QUALITY_METRIC_IDS and not metric_matches(
                metric, _QUALITY_KEYWORDS
            ):
                continue
            if metric_failed(metric):
                findings.append(
                    finding(
                        finding_type="quality",
                        title=f"Task fulfilment metric failed: {metric.metric_id}",
                        summary=(
                            "A task fulfilment metric did not meet its configured threshold. "
                            "Review instruction adherence, schema compliance, and action "
                            "completion rates."
                        ),
                        severity=Severity.medium,
                        dimension=metric.dimension,
                        agent_name=self.name,
                        recommended_action=(
                            "Investigate model outputs against the gold test set and review "
                            "schema validation failures."
                        ),
                        metric=metric,
                        confidence=0.82,
                    )
                )
        return findings
