from uuid import UUID

from sqlmodel import Session

from app.models.base import utc_now
from app.models.enums import MetricResultStatus, RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.schemas.governance import MetricExecutionCreate, MetricExecutionRead
from app.services.metric_plans import build_metric_plan
from app.services.run_validation import get_run_or_raise


def run_mock_metrics(
    session: Session,
    *,
    run_id: UUID,
    payload: MetricExecutionCreate,
) -> MetricExecutionRead:
    run = get_run_or_raise(session, run_id)
    plan = build_metric_plan(session, run_id=run_id)

    evidence_records: list[EvidenceRecord] = []
    metric_results: list[MetricResult] = []

    for metric in plan.metrics:
        threshold = _minimum_threshold(metric.threshold_rules)
        passed = _resolve_passed(score=payload.mock_score, threshold=threshold)
        status = payload.force_status or (
            MetricResultStatus.passed if passed is not False else MetricResultStatus.failed
        )

        evidence = EvidenceRecord(
            run_id=run_id,
            source_type="mock_metric",
            source_name=payload.source_name,
            tool_name=metric.tool_name or "mock_runner",
            raw_score=payload.mock_score,
            normalized_score=payload.mock_score,
            threshold=threshold,
            passed=passed,
            payload={
                "metric_id": metric.metric_id,
                "metric_name": metric.name,
                "dimension": metric.dimension,
                "controls": [control.model_dump() for control in metric.controls],
                "mock": True,
            },
        )
        session.add(evidence)
        session.flush()

        metric_result = MetricResult(
            run_id=run_id,
            metric_id=metric.metric_id,
            dimension=metric.dimension,
            tool_name=metric.tool_name or "mock_runner",
            status=status,
            raw_score=payload.mock_score,
            normalized_score=payload.mock_score,
            threshold=threshold,
            passed=passed,
            evidence_ids=[str(evidence.id)],
        )
        session.add(metric_result)
        evidence_records.append(evidence)
        metric_results.append(metric_result)

    run.status = RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.started_at = run.started_at or utc_now()
    run.result_summary = {
        "metric_plan_count": plan.metric_count,
        "evidence_created": len(evidence_records),
        "metric_results_created": len(metric_results),
        "mock_execution": True,
    }
    run.updated_at = utc_now()

    session.add(run)
    session.commit()
    for evidence in evidence_records:
        session.refresh(evidence)
    for metric_result in metric_results:
        session.refresh(metric_result)

    return MetricExecutionRead(
        run_id=run_id,
        evidence_created=len(evidence_records),
        metric_results_created=len(metric_results),
        evidence=evidence_records,
        metric_results=metric_results,
    )


def _minimum_threshold(threshold_rules: dict[str, object]) -> float | None:
    for key in ("minimum", "medium_risk_minimum", "high_risk_minimum"):
        value = threshold_rules.get(key)
        if isinstance(value, int | float):
            return float(value)
    return None


def _resolve_passed(*, score: float, threshold: float | None) -> bool | None:
    if threshold is None:
        return None
    return score >= threshold
