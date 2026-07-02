import logging
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from sqlmodel import Session

from app.db import session as db_session
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

logger = logging.getLogger(__name__)

# Metrics are evaluated concurrently because each is dominated by blocking
# network I/O (target-model probes + LLM-as-judge calls, each up to a 30s
# timeout with retry backoff). Running them sequentially made a multi-metric
# run take minutes. Bounded so we don't hammer the target/judge endpoints.
_MAX_METRIC_WORKERS = int(os.getenv("METRIC_EXECUTION_MAX_WORKERS", "6"))


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

    # Enter the metric-execution phase up front and commit, so live watchers see
    # this layer become active while the (potentially slow) evaluators run,
    # rather than the phase flipping only after all metrics finish.
    run.status = RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.started_at = run.started_at or utc_now()
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    evidence_records: list[EvidenceRecord] = []
    metric_results: list[MetricResult] = []

    # Evaluate all metrics concurrently. Each worker uses its own short-lived DB
    # session (SQLModel sessions are not thread-safe) for any reads its evaluator
    # does; all writes below happen back on the main session, in plan order, so
    # persistence stays single-threaded and deterministic.
    def _evaluate(metric):
        with Session(db_session.engine) as worker_session:
            try:
                return evaluator.evaluate(
                    MetricEvaluationInput(
                        metric=metric,
                        mock_score=payload.mock_score,
                        force_status=payload.force_status,
                        source_name=payload.source_name,
                        session=worker_session,
                        ai_system=ai_system,
                        target_client=target_client,
                    )
                )
            except Exception:
                logger.exception("Metric evaluation failed for %s", metric.metric_id)
                raise

    metrics = list(plan.metrics)
    if metrics:
        worker_count = max(1, min(_MAX_METRIC_WORKERS, len(metrics)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            evaluations = list(pool.map(_evaluate, metrics))
    else:
        evaluations = []

    for metric, evaluation in zip(metrics, evaluations, strict=True):
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
