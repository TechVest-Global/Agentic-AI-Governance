from app.models.enums import MetricResultStatus, Severity
from app.models.evidence import MetricResult
from app.schemas.governance import FindingCreate


def metric_matches(metric: MetricResult, keywords: tuple[str, ...]) -> bool:
    haystack = f"{metric.metric_id} {metric.dimension} {metric.tool_name}".lower()
    return any(keyword in haystack for keyword in keywords)


def metric_failed(metric: MetricResult) -> bool:
    return (
        metric.status in {MetricResultStatus.failed, MetricResultStatus.error}
        or metric.passed is False
    )


def metric_pending(metric: MetricResult) -> bool:
    return metric.status in {MetricResultStatus.pending, MetricResultStatus.skipped}


def finding(
    *,
    finding_type: str,
    title: str,
    summary: str,
    severity: Severity,
    dimension: str,
    agent_name: str,
    recommended_action: str,
    metric: MetricResult | None = None,
    confidence: float = 0.8,
    tool_calls: list[dict] | None = None,
) -> FindingCreate:
    return FindingCreate(
        finding_type=finding_type,
        title=title,
        summary=summary,
        severity=severity,
        confidence=confidence,
        dimension=dimension,
        evidence_ids=metric.evidence_ids if metric is not None else [],
        agent_name=agent_name,
        recommended_action=recommended_action,
        payload={
            "generated_by": "deterministic_agent",
            "metric_id": metric.metric_id if metric is not None else None,
            "tool_calls": tool_calls or [],
        },
    )
