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
    evidence_ids: list[str] | None = None,
) -> FindingCreate:
    """Build a Finding, always with real evidence_ids when any exist.

    Precedence: an explicit ``evidence_ids`` override wins (e.g. a governance-
    authored finding not tied to one single metric, but backed by several
    reviewed metrics' combined evidence); otherwise falls back to the single
    matched ``metric``'s own evidence_ids. Without this, any finding built
    without a matched metric — the common case on the governance-JSON path
    whenever the LLM's cited metric_id doesn't match anything — would report
    empty evidence_ids even when real evidence informed it, breaking the
    council's ability to trace a verdict back to a specific evidence record.
    """
    resolved_evidence_ids = (
        list(evidence_ids)
        if evidence_ids is not None
        else (metric.evidence_ids if metric is not None else [])
    )
    return FindingCreate(
        finding_type=finding_type,
        title=title,
        summary=summary,
        severity=severity,
        confidence=confidence,
        dimension=dimension,
        evidence_ids=resolved_evidence_ids,
        agent_name=agent_name,
        recommended_action=recommended_action,
        payload={
            "generated_by": "deterministic_agent",
            "metric_id": metric.metric_id if metric is not None else None,
            "tool_calls": tool_calls or [],
        },
    )


def dimension_not_probed_finding(
    *, agent_name: str, dimension: str, reason: str
) -> FindingCreate:
    """An honest 'this dimension was never actively probed' record.

    Fires when an agent exits without probing because none of its owned metrics
    needed attention and the system's risk tier does not require verifying
    passes with live evidence (see ModelBackedAgent._verify_even_when_passing).

    Without this the agent returns nothing at all, so the run reads as "agent
    completed, 0 findings" — indistinguishable from "this dimension was probed
    and nothing was wrong". Those are very different governance claims and only
    the second is evidence of safety. Recording the distinction is what lets a
    report state its own coverage limits instead of implying clean results.

    Shares finding_type "coverage_gap" with coverage_gap_finding above so
    existing report and UI handling covers it; the payload's generated_by
    distinguishes the two causes.
    """
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} was not actively probed in this run",
        summary=(
            f"No {dimension} probes were sent to the target: {reason}. This is a limit on "
            f"what this run verified, not a compliance finding — no conclusion should be "
            f"drawn about the system's {dimension} behaviour from this run."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Register the system at 'high' risk tier to force live verification of passing "
            f"metrics, or select {dimension} metrics for the run, if active {dimension} "
            "evidence is required."
        ),
        payload={"generated_by": "unprobed_dimension_gate", "reason": reason},
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
