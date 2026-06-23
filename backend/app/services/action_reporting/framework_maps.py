from uuid import UUID

from sqlmodel import Session, select

from app.models.config import FrameworkMapping
from app.models.enums import FindingStatus, MetricResultStatus, Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.schemas.governance import (
    FrameworkComplianceMapRead,
    FrameworkControlAssessment,
    FrameworkControlStatus,
)
from app.services.run_validation import get_run_or_raise

SEVERITY_ORDER = {
    Severity.info: 0,
    Severity.low: 1,
    Severity.medium: 2,
    Severity.high: 3,
    Severity.critical: 4,
}


def build_framework_compliance_map(
    session: Session,
    *,
    run_id: UUID,
) -> FrameworkComplianceMapRead:
    run = get_run_or_raise(session, run_id)
    mappings = _list_applicable_mappings(
        session,
        selected_frameworks=run.selected_frameworks,
    )
    metric_results = list(
        session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all()
    )
    findings = list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())

    controls = [
        _assess_control(
            mapping=mapping,
            metric_results=metric_results,
            findings=findings,
        )
        for mapping in mappings
    ]
    status_counts = {
        "passed": 0,
        "failed": 0,
        "needs_review": 0,
        "not_evaluated": 0,
    }
    for control in controls:
        status_counts[control.status] += 1

    return FrameworkComplianceMapRead(
        run_id=run.id,
        ai_system_id=run.ai_system_id,
        selected_frameworks=run.selected_frameworks,
        control_count=len(controls),
        status_counts=status_counts,
        controls=controls,
    )


def _list_applicable_mappings(
    session: Session,
    *,
    selected_frameworks: list[str],
) -> list[FrameworkMapping]:
    statement = (
        select(FrameworkMapping)
        .where(FrameworkMapping.enabled == True)  # noqa: E712
        .order_by(FrameworkMapping.framework_id.asc(), FrameworkMapping.control_ref.asc())
    )
    mappings = list(session.exec(statement).all())
    if not selected_frameworks:
        return mappings
    return [
        mapping
        for mapping in mappings
        if mapping.framework_id in selected_frameworks
    ]


def _assess_control(
    *,
    mapping: FrameworkMapping,
    metric_results: list[MetricResult],
    findings: list[Finding],
) -> FrameworkControlAssessment:
    control_metric_results = [
        result for result in metric_results if result.metric_id in mapping.metric_ids
    ]
    control_findings = [
        finding
        for finding in findings
        if _finding_references_control(finding=finding, mapping=mapping)
    ]
    passed_metric_count = sum(
        1
        for result in control_metric_results
        if result.status == MetricResultStatus.passed and result.passed is not False
    )
    failed_metric_count = sum(
        1
        for result in control_metric_results
        if result.status in {MetricResultStatus.failed, MetricResultStatus.error}
        or result.passed is False
    )
    pending_metric_count = sum(
        1
        for result in control_metric_results
        if result.status in {MetricResultStatus.pending, MetricResultStatus.skipped}
    )
    highest_severity = _highest_severity(control_findings)
    status = _control_status(
        expected_metric_ids=mapping.metric_ids,
        metric_results=control_metric_results,
        failed_metric_count=failed_metric_count,
        pending_metric_count=pending_metric_count,
        findings=control_findings,
    )

    return FrameworkControlAssessment(
        framework_id=mapping.framework_id,
        framework_name=mapping.framework_name,
        framework_version=mapping.framework_version,
        control_ref=mapping.control_ref,
        control_title=mapping.control_title,
        control_category=mapping.control_category,
        jurisdiction=mapping.jurisdiction,
        status=status,
        metric_ids=mapping.metric_ids,
        passed_metric_count=passed_metric_count,
        failed_metric_count=failed_metric_count,
        pending_metric_count=pending_metric_count,
        finding_count=len(control_findings),
        highest_severity=highest_severity,
        evidence_requirements=mapping.evidence_requirements,
        metric_results=control_metric_results,
        findings=control_findings,
    )


def _finding_references_control(
    *,
    finding: Finding,
    mapping: FrameworkMapping,
) -> bool:
    accepted_refs = {
        mapping.control_ref,
        f"{mapping.framework_id}:{mapping.control_ref}",
        f"{mapping.framework_id}:{mapping.framework_version}:{mapping.control_ref}",
    }
    return bool(accepted_refs.intersection(finding.framework_refs))


def _highest_severity(findings: list[Finding]) -> Severity | None:
    if not findings:
        return None
    return max((finding.severity for finding in findings), key=SEVERITY_ORDER.get)


def _control_status(
    *,
    expected_metric_ids: list[str],
    metric_results: list[MetricResult],
    failed_metric_count: int,
    pending_metric_count: int,
    findings: list[Finding],
) -> FrameworkControlStatus:
    if failed_metric_count > 0:
        return "failed"
    if not metric_results:
        return "not_evaluated"
    if pending_metric_count > 0:
        return "needs_review"
    if _has_open_findings(findings):
        return "needs_review"
    result_metric_ids = {result.metric_id for result in metric_results}
    if set(expected_metric_ids).issubset(result_metric_ids):
        return "passed"
    return "needs_review"


def _has_open_findings(findings: list[Finding]) -> bool:
    return any(finding.status == FindingStatus.open for finding in findings)
