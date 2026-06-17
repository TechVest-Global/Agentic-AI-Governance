from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceConflictError
from app.models.base import utc_now
from app.models.enums import (
    ActionTier,
    FindingStatus,
    MetricResultStatus,
    RunPhase,
    RunStatus,
    Severity,
)
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.models.verdict import Verdict
from app.schemas.governance import CouncilDeliberationCreate, CouncilDeliberationRead
from app.services.run_validation import get_run_or_raise

SEVERITY_ORDER = {
    Severity.info: 0,
    Severity.low: 1,
    Severity.medium: 2,
    Severity.high: 3,
    Severity.critical: 4,
}


def deliberate(
    session: Session,
    *,
    run_id: UUID,
    payload: CouncilDeliberationCreate,
) -> CouncilDeliberationRead:
    run = get_run_or_raise(session, run_id)
    existing_verdict = session.exec(
        select(Verdict).where(Verdict.run_id == run_id)
    ).first()
    if existing_verdict is not None:
        raise ResourceConflictError("Verdict", "run_id", str(run_id))

    findings = list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())
    metric_results = list(
        session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all()
    )
    open_findings = [
        finding for finding in findings if finding.status == FindingStatus.open
    ]
    failed_metric_count = _failed_metric_count(metric_results)
    pending_metric_count = _pending_metric_count(metric_results)
    highest_severity = _highest_severity(open_findings)
    label = _label(
        failed_metric_count=failed_metric_count,
        pending_metric_count=pending_metric_count,
        highest_severity=highest_severity,
        open_finding_count=len(open_findings),
    )
    action_tier = _action_tier(label=label)
    confidence_score = _confidence_score(
        findings=open_findings,
        failed_metric_count=failed_metric_count,
        pending_metric_count=pending_metric_count,
    )
    verdict = Verdict(
        run_id=run_id,
        confidence_score=confidence_score,
        action_tier=action_tier,
        label=label,
        synthesis=_synthesis(
            label=label,
            finding_count=len(findings),
            open_finding_count=len(open_findings),
            metric_result_count=len(metric_results),
            failed_metric_count=failed_metric_count,
            pending_metric_count=pending_metric_count,
        ),
        objections=_objections(open_findings),
        reasoning=_reasoning(
            payload=payload,
            metric_result_count=len(metric_results),
            failed_metric_count=failed_metric_count,
            pending_metric_count=pending_metric_count,
            finding_count=len(findings),
            open_finding_count=len(open_findings),
            highest_severity=highest_severity,
        ),
        required_actions=_required_actions(open_findings, label=label),
    )
    session.add(verdict)

    run.status = RunStatus.council_running
    run.current_phase = RunPhase.deliberation_council
    run.result_summary = {
        **(run.result_summary or {}),
        "council_label": label,
        "council_confidence_score": confidence_score,
        "council_deliberated_at": utc_now().isoformat(),
    }
    run.updated_at = utc_now()
    session.add(run)

    session.commit()
    session.refresh(verdict)
    return CouncilDeliberationRead(
        run_id=run_id,
        verdict=verdict,
        finding_count=len(findings),
        open_finding_count=len(open_findings),
        metric_result_count=len(metric_results),
        failed_metric_count=failed_metric_count,
        pending_metric_count=pending_metric_count,
        highest_severity=highest_severity,
        created_verdict=True,
    )


def _failed_metric_count(metric_results: list[MetricResult]) -> int:
    return sum(
        1
        for result in metric_results
        if result.status in {MetricResultStatus.failed, MetricResultStatus.error}
        or result.passed is False
    )


def _pending_metric_count(metric_results: list[MetricResult]) -> int:
    return sum(
        1
        for result in metric_results
        if result.status in {MetricResultStatus.pending, MetricResultStatus.skipped}
    )


def _highest_severity(findings: list[Finding]) -> Severity | None:
    if not findings:
        return None
    return max((finding.severity for finding in findings), key=SEVERITY_ORDER.get)


def _label(
    *,
    failed_metric_count: int,
    pending_metric_count: int,
    highest_severity: Severity | None,
    open_finding_count: int,
) -> str:
    if failed_metric_count > 0 or highest_severity in {Severity.high, Severity.critical}:
        return "blocked"
    if pending_metric_count > 0 or open_finding_count > 0:
        return "conditional_approval"
    return "approved"


def _action_tier(*, label: str) -> ActionTier:
    if label == "approved":
        return ActionTier.autonomous
    if label == "conditional_approval":
        return ActionTier.supervised
    return ActionTier.human_review


def _confidence_score(
    *,
    findings: list[Finding],
    failed_metric_count: int,
    pending_metric_count: int,
) -> float:
    score = 0.95
    score -= failed_metric_count * 0.15
    score -= pending_metric_count * 0.05
    for finding in findings:
        score -= {
            Severity.info: 0.01,
            Severity.low: 0.03,
            Severity.medium: 0.07,
            Severity.high: 0.15,
            Severity.critical: 0.25,
        }[finding.severity]
    return round(max(0.0, min(1.0, score)), 2)


def _synthesis(
    *,
    label: str,
    finding_count: int,
    open_finding_count: int,
    metric_result_count: int,
    failed_metric_count: int,
    pending_metric_count: int,
) -> str:
    return (
        f"Council decision is {label}. Reviewed {metric_result_count} metric "
        f"results and {finding_count} findings. Open findings: {open_finding_count}; "
        f"failed metrics: {failed_metric_count}; pending metrics: {pending_metric_count}."
    )


def _objections(findings: list[Finding]) -> list[dict[str, object]]:
    return [
        {
            "finding_id": str(finding.id),
            "title": finding.title,
            "severity": finding.severity,
            "agent_name": finding.agent_name,
            "summary": finding.summary,
        }
        for finding in findings
    ]


def _required_actions(findings: list[Finding], *, label: str) -> list[dict[str, object]]:
    if not findings and label == "approved":
        return []
    return [
        {
            "finding_id": str(finding.id),
            "action": finding.recommended_action or f"Review finding: {finding.title}",
            "severity": finding.severity,
            "owner": "system_owner",
        }
        for finding in findings
    ]


def _reasoning(
    *,
    payload: CouncilDeliberationCreate,
    metric_result_count: int,
    failed_metric_count: int,
    pending_metric_count: int,
    finding_count: int,
    open_finding_count: int,
    highest_severity: Severity | None,
) -> str:
    notes = f" Notes: {payload.notes}" if payload.notes else ""
    requested_by = f" Requested by: {payload.requested_by}." if payload.requested_by else ""
    return (
        "Verdict generated from stored metric results and specialist-agent findings. "
        f"Metrics={metric_result_count}, failed={failed_metric_count}, "
        f"pending={pending_metric_count}, findings={finding_count}, "
        f"open_findings={open_finding_count}, highest_severity={highest_severity}."
        f"{requested_by}{notes}"
    )
