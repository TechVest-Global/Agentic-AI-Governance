import logging
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed
from uuid import UUID

from sqlmodel import Session, select

from app.db import session as db_session
from app.models.ai_system import AISystem, AISystemCapability
from app.models.base import utc_now
from app.models.enums import MetricResultStatus, RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.schemas.governance import MetricExecutionCreate, MetricExecutionRead
from app.models.llm_call_log import LLMCallLog
from app.services.evaluators.base import (
    MetricEvaluationInput,
    MetricEvaluationResult,
    resolve_evaluator_endpoint,
)
from app.services.evaluators.registry import get_evaluator
from app.services.model_clients.gateway import (
    bind_log_capture,
    drain_log_capture,
    get_log_buffer,
    start_log_capture,
)
from app.services.model_clients.registry import get_target_model_client_for_system
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents.metric_plans import build_metric_plan

logger = logging.getLogger(__name__)

# Metrics are evaluated concurrently because each is dominated by blocking
# network I/O (target-model probes + LLM-as-judge calls, each up to a 60s
# timeout with retry backoff). Running them sequentially made a multi-metric
# run take minutes. Bounded LOW on purpose: at 6 workers the shared Azure judge
# endpoint returned a storm of HTTP 429s (rate limits) and dropped connections,
# so the retry/backoff inflated a run past 10 minutes. 3 keeps enough
# parallelism to overlap the slow target probes without tripping the judge's
# rate limit. Override with METRIC_EXECUTION_MAX_WORKERS.
_MAX_METRIC_WORKERS = int(os.getenv("METRIC_EXECUTION_MAX_WORKERS", "3"))

# Hard wall-clock budget for the whole metric-execution phase. A single evaluator
# that blocks on an unbounded network call (e.g. ragas' langchain judge, which
# doesn't go through the gateway's per-call timeout, or a garak detector loading
# a model) would otherwise hang the ThreadPoolExecutor join forever and park the
# run in `metrics_running` indefinitely — the exact failure observed (154 min).
# When the budget is hit, any metric still in flight is recorded as SKIPPED so
# the run always advances to a terminal state. Override with
# METRIC_EXECUTION_BUDGET_SECONDS.
_METRIC_PHASE_BUDGET_SECONDS = float(os.getenv("METRIC_EXECUTION_BUDGET_SECONDS", "600"))


def _timed_out_result(metric, *, reason: str) -> MetricEvaluationResult:
    return MetricEvaluationResult(
        source_type="metric_execution",
        tool_name=(metric.tool_name or "unknown"),
        raw_score=None,
        normalized_score=None,
        threshold=None,
        passed=None,
        status=MetricResultStatus.skipped,
        payload={"metric_id": metric.metric_id, "skipped_reason": reason},
    )


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
    target_client = get_target_model_client_for_system(ai_system)

    # Enter the metric-execution phase up front and commit, so live watchers see
    # this layer become active while the (potentially slow) evaluators run,
    # rather than the phase flipping only after all metrics finish.
    run.status = RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.started_at = run.started_at or utc_now()
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    # The commit above expires every ORM attribute, so the first worker thread
    # to touch ai_system.* would trigger a lazy refresh on the shared session —
    # and concurrent refreshes from several workers raise "session is
    # provisioning a new connection; concurrent operations are not permitted".
    # Give the workers a dedicated snapshot loaded via a throwaway session:
    # closing it detaches the instance with all column attributes materialized,
    # so worker reads are plain attribute access with no session involved.
    worker_ai_system = None
    resolved_endpoint_ref = ""
    resolved_capabilities: list[AISystemCapability] = []
    if ai_system is not None:
        with Session(db_session.engine) as snapshot_session:
            worker_ai_system = snapshot_session.get(AISystem, ai_system.id)
            resolved_capabilities = list(
                snapshot_session.exec(
                    select(AISystemCapability).where(
                        AISystemCapability.ai_system_id == ai_system.id
                    )
                ).all()
            )
            resolved_endpoint_ref = resolve_evaluator_endpoint(worker_ai_system, resolved_capabilities)

    evidence_records: list[EvidenceRecord] = []
    metric_results: list[MetricResult] = []

    # Capture every LLM call the evaluators make (target probes + judge calls)
    # so the metric-execution phase is audited in llm_call_logs like the agent
    # and council phases already are.
    start_log_capture()
    capture_buffer = get_log_buffer()

    # Evaluate all metrics concurrently. Each worker uses its own short-lived DB
    # session (SQLModel sessions are not thread-safe) for any reads its evaluator
    # does; all writes below happen back on the main session, in plan order, so
    # persistence stays single-threaded and deterministic.
    def _evaluate(metric) -> MetricEvaluationResult:
        # contextvars don't cross thread boundaries — rebind the parent's audit
        # buffer so this worker's LLM calls are captured too.
        bind_log_capture(capture_buffer)
        with Session(db_session.engine) as worker_session:
            try:
                return evaluator.evaluate(
                    MetricEvaluationInput(
                        metric=metric,
                        mock_score=payload.mock_score,
                        force_status=payload.force_status,
                        source_name=payload.source_name,
                        session=worker_session,
                        ai_system=worker_ai_system,
                        target_client=target_client,
                        target_endpoint_ref=resolved_endpoint_ref,
                        capabilities=resolved_capabilities,
                    )
                )
            except Exception as exc:
                # A single metric's transient failure (network blip probing the
                # target, judge timeout, ...) must not discard every other
                # metric's already-computed results for this run — pool.map(...)
                # raises on the FIRST failing future, and persistence below only
                # runs after the whole pool completes. Return an "error" result
                # for THIS metric instead of re-raising so the run still
                # persists whatever evidence/metric_results DID succeed.
                logger.exception("Metric evaluation failed for %s", metric.metric_id)
                return MetricEvaluationResult(
                    source_type="metric_evaluation_error",
                    tool_name=metric.tool_name or "unknown",
                    raw_score=None,
                    normalized_score=None,
                    threshold=None,
                    passed=False,
                    status=MetricResultStatus.error,
                    payload={
                        "metric_id": metric.metric_id,
                        "metric_name": metric.name,
                        "dimension": metric.dimension,
                        "evaluator_name": evaluator.name,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    },
                )

    metrics = list(plan.metrics)
    if metrics:
        worker_count = max(1, min(_MAX_METRIC_WORKERS, len(metrics)))
        # Bound the whole phase: collect results as they complete, up to a hard
        # budget. Any metric still running when the budget expires is recorded as
        # skipped so a single hung evaluator can never park the run forever.
        # shutdown(wait=False) is deliberate — we do NOT block on stragglers.
        pool = ThreadPoolExecutor(max_workers=worker_count)
        future_to_metric = {pool.submit(_evaluate, m): m for m in metrics}
        results_by_id: dict[str, MetricEvaluationResult] = {}
        try:
            for future in as_completed(future_to_metric, timeout=_METRIC_PHASE_BUDGET_SECONDS):
                metric = future_to_metric[future]
                try:
                    results_by_id[metric.metric_id] = future.result()
                except Exception:
                    logger.exception("Metric evaluation failed for %s", metric.metric_id)
                    results_by_id[metric.metric_id] = _timed_out_result(
                        metric, reason="evaluator raised an error"
                    )
        except FuturesTimeout:
            pending = [m.metric_id for f, m in future_to_metric.items() if not f.done()]
            logger.warning(
                "Metric execution hit the %.0fs budget; skipping %d unfinished metric(s): %s",
                _METRIC_PHASE_BUDGET_SECONDS, len(pending), pending,
            )
        pool.shutdown(wait=False)
        evaluations = [
            results_by_id.get(m.metric_id)
            or _timed_out_result(m, reason="evaluation exceeded the metric-execution time budget")
            for m in metrics
        ]
    else:
        evaluations = []

    for metric, evaluation in zip(metrics, evaluations, strict=True):
        evidence = EvidenceRecord(
            run_id=run_id,
            source_type=evaluation.source_type,
            # Attribute evidence to the REAL tool that produced it (garak, deepeval,
            # ragas, presidio, …) rather than the coarse run-level payload label —
            # so evidence never reads as a generic "…metric_runner" placeholder.
            source_name=evaluation.tool_name,
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

    failed_metric_count = sum(
        1 for evaluation in evaluations if evaluation.status == MetricResultStatus.error
    )

    # Consistent with run_agents' RunStatus.degraded convention (see
    # agent_execution.py): some metrics erroring means the run's evidence is
    # incomplete, not fully healthy, but every metric that DID succeed is still
    # persisted below rather than discarded.
    run.status = RunStatus.degraded if failed_metric_count else RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.started_at = run.started_at or utc_now()
    run.result_summary = {
        "metric_plan_count": plan.metric_count,
        "evidence_created": len(evidence_records),
        "metric_results_created": len(metric_results),
        "metrics_failed": failed_metric_count,
        "evaluator_name": evaluator.name,
        "mock_execution": evaluator.name == "mock",
    }
    run.updated_at = utc_now()

    session.add(run)
    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))
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
