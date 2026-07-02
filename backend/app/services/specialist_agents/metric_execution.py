from uuid import UUID

from sqlmodel import Session

from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.schemas.governance import MetricExecutionCreate, MetricExecutionRead
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.registry import get_evaluator
from app.services.model_clients.registry import get_target_model_client
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents.metric_plans import build_metric_plan


def run_metrics(
    session: Session,
    *,
    run_id: UUID,
    payload: MetricExecutionCreate,
) -> MetricExecutionRead:
    run = get_run_or_raise(session, run_id)
    plan = build_metric_plan(session, run_id=run_id)
    evaluator = get_evaluator(payload.evaluator_name)
    ai_system = session.get(AISystem, run.ai_system_id)
    target_client = get_target_model_client()

    evidence_records: list[EvidenceRecord] = []
    metric_results: list[MetricResult] = []

    for metric in plan.metrics:
        evaluation = evaluator.evaluate(
            MetricEvaluationInput(
                metric=metric,
                mock_score=payload.mock_score,
                force_status=payload.force_status,
                source_name=payload.source_name,
                session=session,
                ai_system=ai_system,
                target_client=target_client,
            )
        )

        evidence = EvidenceRecord(
            run_id=run_id,
            source_type=evaluation.source_type,
            source_name=payload.source_name,
            tool_name=evaluation.tool_name,
            raw_score=evaluation.raw_score,
            normalized_score=evaluation.normalized_score,
            threshold=evaluation.threshold,
            passed=evaluation.passed,
            payload=evaluation.payload,
        )
        session.add(evidence)
        session.flush()

        metric_result = MetricResult(
            run_id=run_id,
            metric_id=metric.metric_id,
            dimension=metric.dimension,
            tool_name=evaluation.tool_name,
            status=evaluation.status,
            raw_score=evaluation.raw_score,
            normalized_score=evaluation.normalized_score,
            threshold=evaluation.threshold,
            passed=evaluation.passed,
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
        "evaluator_name": evaluator.name,
        "mock_execution": evaluator.name == "mock",
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
