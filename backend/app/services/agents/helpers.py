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


def coverage_gap_finding(*, agent_name: str, dimension: str, reason: str) -> FindingCreate:
    """An honest 'this agent had nothing appropriate to probe' record.

    Fires when every probe this agent would have sent got caught by the
    fail-closed modality gate (see ModelBackedAgent._execute_probe_plan) — e.g.
    a text-only probe against an image-generation capability. Distinct from a
    failed check: nothing was wrong with the target, this agent simply has no
    probe shaped for it yet. Severity is informational, never a compliance
    verdict on its own.
    """
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} could not be probed for this capability",
        summary=(
            f"Every {dimension} probe for this run was skipped: {reason}. "
            "This is a gap in probe coverage, not a compliance finding — no "
            "conclusion should be drawn about this capability from this dimension."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Register a probe appropriate to this capability's modality/schema, "
            "or extend probe coverage for its system category."
        ),
        payload={"generated_by": "probe_coverage_gate", "reason": reason},
    )
