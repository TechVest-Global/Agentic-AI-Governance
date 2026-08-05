import functools
import logging
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from uuid import UUID

from sqlmodel import Session, select

from app.db import session as db_session
from app.models.ai_system import AISystem, AISystemCapability
from app.models.base import utc_now
from app.models.enums import LedgerActorType, MetricResultStatus, RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import (
    AuditLedgerEntryCreate,
    MetricExecutionCreate,
    MetricExecutionRead,
)
from app.services import audit_ledger
from app.services.concurrency_settings import (
    metric_execution_budget_seconds,
    metric_execution_max_workers,
)
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
from app.services.model_clients.target_modality import register_capability_modalities
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
#
# Both knobs resolve through concurrency_settings at call time rather than being
# read from os.getenv at import: the app's config is pydantic-settings reading
# <repo>/.env, which never populates os.environ, so the documented .env override
# silently did nothing. See app/services/concurrency_settings.py.
#
# Hard wall-clock budget for the whole metric-execution phase. A single evaluator
# that blocks on an unbounded network call (e.g. ragas' langchain judge, which
# doesn't go through the gateway's per-call timeout, or a garak detector loading
# a model) would otherwise hang the ThreadPoolExecutor join forever and park the
# run in `metrics_running` indefinitely — the exact failure observed (154 min).
# When the budget is hit, any metric still in flight is recorded as SKIPPED so
# the run always advances to a terminal state. Override with
# METRIC_EXECUTION_BUDGET_SECONDS.


def _record_orphaned_completion(run_id: UUID, metric_id: str, future: Future) -> None:
    """Ledger-record a straggler metric that finished after its phase timed out.

    ``pool.shutdown(wait=False)`` deliberately does not block on stragglers so
    a single hung evaluator can never park the run — but the thread keeps
    running in the background (possibly still calling the target system)
    with nothing recorded once its result is discarded. This callback runs
    whenever that thread eventually finishes, on its own session since the
    main request/job session may already be closed by then.
    """
    try:
        outcome = "completed"
        detail: str | None = None
        try:
            future.result()
        except Exception as exc:  # noqa: BLE001
            outcome = "error"
            detail = str(exc)
        with Session(db_session.engine) as session:
            audit_ledger.append_ledger_entry(
                session,
                run_id=run_id,
                payload=AuditLedgerEntryCreate(
                    event_type="metric.orphaned_after_timeout",
                    actor_type=LedgerActorType.system,
                    actor_id="metric_execution",
                    payload={"metric_id": metric_id, "outcome": outcome, "detail": detail},
                ),
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "Could not record orphaned-metric completion for %s (run %s)", metric_id, run_id
        )


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
            resolved_endpoint_ref = resolve_evaluator_endpoint(
                worker_ai_system,
                resolved_capabilities,
                run.selected_capabilities or (),
            )
            # Teach the gateway which endpoints are video, so its concurrency cap
            # can serialise renders. Registered here because this is where the
            # capabilities are loaded; the evaluators that probe a video endpoint
            # (deepeval posts free text to whatever ref it is handed) have no idea
            # they are doing it. See model_clients/target_modality.py.
            register_capability_modalities(resolved_capabilities)

    evidence_records: list[EvidenceRecord] = []
    metric_results: list[MetricResult] = []

    # Capture every LLM call the evaluators make (target probes + judge calls)
    # so the metric-execution phase is audited in llm_call_logs like the agent
    # and council phases already are.
    start_log_capture(run_id, RunPhase.metric_execution.value)
    capture_buffer = get_log_buffer()

    # Evaluate all metrics concurrently. Each worker uses its own short-lived DB
    # session (SQLModel sessions are not thread-safe) for any reads its evaluator
    # does; all writes below happen back on the main session, in plan order, so
    # persistence stays single-threaded and deterministic.
    def _evaluate(metric) -> MetricEvaluationResult:
        with Session(db_session.engine) as worker_session:
            # contextvars don't cross thread boundaries — rebind the parent's
            # audit buffer so this worker's LLM calls are captured too. The
            # pool is reused across metrics on the same threads, so agent_name
            # is rebound fresh on every call (attributing the call to this
            # metric's own tool) rather than relying on whatever a previous
            # metric on this thread left behind.
            bind_log_capture(capture_buffer, agent_name=metric.tool_name or "unknown")
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
                        run_id=run_id,
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

    # Resuming a run that was interrupted mid-phase (see
    # orchestration.reconcile_interrupted_runs) must not re-evaluate metrics
    # that already completed — each evaluator call is a real probe against
    # the target system, and per-item commits (above) mean a prior partial
    # attempt's successes are already durable. A metric left `error`/
    # `skipped`/`pending` was never properly evaluated and IS retried.
    already_done_results = [
        result
        for result in session.exec(
            select(MetricResult).where(MetricResult.run_id == run_id)
        ).all()
        if result.status in (MetricResultStatus.passed, MetricResultStatus.failed)
    ]
    already_done_ids = {result.metric_id for result in already_done_results}
    metrics = [m for m in plan.metrics if m.metric_id not in already_done_ids]
    if already_done_ids:
        logger.info(
            "Run %s: skipping %d already-evaluated metric(s) on resume",
            run_id, len(already_done_ids),
        )
    # A metric about to be retried may already have a stale error/skipped/
    # pending MetricResult (and its EvidenceRecord) from the interrupted
    # attempt — remove it so the retry cleanly replaces it instead of leaving
    # a duplicate row alongside the fresh result.
    retry_ids = {m.metric_id for m in metrics}
    if retry_ids:
        stale_results = list(
            session.exec(
                select(MetricResult)
                .where(MetricResult.run_id == run_id)
                .where(MetricResult.metric_id.in_(retry_ids))
            ).all()
        )
        stale_evidence_ids = {eid for r in stale_results for eid in (r.evidence_ids or [])}
        for stale_result in stale_results:
            session.delete(stale_result)
        if stale_evidence_ids:
            for stale_evidence in session.exec(
                select(EvidenceRecord).where(
                    EvidenceRecord.id.in_([UUID(eid) for eid in stale_evidence_ids])
                )
            ).all():
                session.delete(stale_evidence)
        if stale_results:
            session.commit()

    if metrics:
        phase_budget_seconds = metric_execution_budget_seconds()
        worker_count = max(1, min(metric_execution_max_workers(), len(metrics)))
        # Bound the whole phase: collect results as they complete, up to a hard
        # budget. Any metric still running when the budget expires is recorded as
        # skipped so a single hung evaluator can never park the run forever.
        # shutdown(wait=False) is deliberate — we do NOT block on stragglers.
        pool = ThreadPoolExecutor(max_workers=worker_count)
        future_to_metric = {pool.submit(_evaluate, m): m for m in metrics}
        results_by_id: dict[str, MetricEvaluationResult] = {}
        try:
            for future in as_completed(future_to_metric, timeout=phase_budget_seconds):
                metric = future_to_metric[future]
                try:
                    results_by_id[metric.metric_id] = future.result()
                except Exception:
                    logger.exception("Metric evaluation failed for %s", metric.metric_id)
                    results_by_id[metric.metric_id] = _timed_out_result(
                        metric, reason="evaluator raised an error"
                    )
        except FuturesTimeout:
            pending = {f: m for f, m in future_to_metric.items() if not f.done()}
            logger.warning(
                "Metric execution hit the %.0fs budget; skipping %d unfinished metric(s): %s",
                phase_budget_seconds, len(pending), [m.metric_id for m in pending.values()],
            )
            for pending_future, pending_metric in pending.items():
                pending_future.add_done_callback(
                    functools.partial(_record_orphaned_completion, run_id, pending_metric.metric_id)
                )
        pool.shutdown(wait=False)
        evaluations = [
            results_by_id.get(m.metric_id)
            or _timed_out_result(m, reason="evaluation exceeded the metric-execution time budget")
            for m in metrics
        ]
    else:
        evaluations = []

    # Each metric's evidence/result is committed as soon as it's built, rather
    # than batched into one commit after the whole loop. The evaluators above
    # already made real calls against the target system by this point — a
    # crash between two metrics must not discard the durable record of the
    # ones that DID finish, since that work (and its side effects) already
    # happened whether or not the process survives to persist it.
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
        session.commit()
        session.refresh(evidence)
        session.refresh(metric_result)
        evidence_records.append(evidence)
        metric_results.append(metric_result)

    failed_metric_count = sum(
        1 for evaluation in evaluations if evaluation.status == MetricResultStatus.error
    )
    newly_created_evidence_count = len(evidence_records)
    newly_created_result_count = len(metric_results)

    # Consistent with run_agents' RunStatus.degraded convention (see
    # agent_execution.py): some metrics erroring means the run's evidence is
    # incomplete, not fully healthy, but every metric that DID succeed is still
    # persisted below rather than discarded.
    run.status = RunStatus.degraded if failed_metric_count else RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.started_at = run.started_at or utc_now()
    run.result_summary = {
        "metric_plan_count": plan.metric_count,
        "evidence_created": newly_created_evidence_count,
        "metric_results_created": newly_created_result_count,
        "metrics_failed": failed_metric_count,
        "metrics_reused_from_prior_attempt": len(already_done_results),
        "evaluator_name": evaluator.name,
        "mock_execution": evaluator.name == "mock",
    }
    run.updated_at = utc_now()

    session.add(run)
    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))
    session.commit()

    # The returned/ledgered totals reflect the run's FULL current state
    # (previously-completed metrics reused on resume + whatever ran just now),
    # not only what happened in this specific call — a resumed run's report
    # and content-integrity digest must cover every metric result that exists,
    # not just the delta.
    all_metric_results = already_done_results + metric_results
    reused_evidence_ids = {
        eid for result in already_done_results for eid in (result.evidence_ids or [])
    }
    all_evidence_records = evidence_records
    if reused_evidence_ids:
        all_evidence_records = evidence_records + list(
            session.exec(
                select(EvidenceRecord).where(
                    EvidenceRecord.id.in_([UUID(eid) for eid in reused_evidence_ids])
                )
            ).all()
        )

    return MetricExecutionRead(
        run_id=run_id,
        evidence_created=newly_created_evidence_count,
        metric_results_created=newly_created_result_count,
        evidence=all_evidence_records,
        metric_results=all_metric_results,
    )
