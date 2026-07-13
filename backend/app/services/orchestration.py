import logging
from uuid import UUID

from sqlmodel import Session, select

from app.db import session as db_session
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.verdict import Verdict
from app.schemas.governance import (
    AgentRunCreate,
    AuditLedgerEntryCreate,
    ContextAssemblyCreate,
    ContextAssemblyRead,
    CouncilDeliberationCreate,
    EvaluationPlanCreate,
    EvaluationPlanRead,
    GovernancePipelineRunCreate,
    GovernancePipelineRunRead,
    GovernanceStateEntryCreate,
    MetricExecutionCreate,
)
from app.services import (
    adaptive_orchestrator,
    audit_ledger,
    context_assembly,
    governance_state,
)
from app.services.action_reporting import reports
from app.services.context_assembly.log_synthesizer import synthesize_logs_for_system
from app.services.deliberation_council import deliberation as council
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents import agent_execution, metric_execution

logger = logging.getLogger(__name__)


def run_governance_pipeline_job(
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> None:
    """Run the full pipeline off the request thread, with its own DB session.

    Invoked as a background task so the HTTP request returns immediately (202)
    and the run's phase transitions become observable via polling / SSE while
    the pipeline executes. On failure the run is marked failed so watchers stop
    waiting instead of hanging on a non-terminal status. Must NOT reuse the
    request-scoped session (it is closed once the response is sent).

    When the run is gated on plan approval, the pipeline pauses after building
    the metric plan (returns None) and the run is left at RunStatus.planned —
    the job must NOT finalize it as completed in that case.
    """
    try:
        with Session(db_session.engine) as session:
            result = run_governance_pipeline(session, run_id=run_id, payload=payload)
    except Exception as exc:  # noqa: BLE001 — background job: never let it crash silently
        logger.exception("Background orchestration failed for run %s", run_id)
        _finalize_run(run_id, status=RunStatus.failed, error=exc)
    else:
        # result is None => paused for plan approval; leave the run parked at
        # 'planned' for the reviewer. Otherwise finalize on a FRESH session: the
        # pipeline marks the run completed itself, but if its session is poisoned
        # late in the flow (observed once: the final completed UPDATE flushed,
        # then rolled back), the run would otherwise be parked at council_running
        # forever and the Live Run view would hang on the council stage.
        if result is not None:
            _finalize_run(run_id, status=RunStatus.completed)


def resume_governance_pipeline_job(run_id: UUID) -> None:
    """Resume a plan-approved run's pipeline off the request thread.

    The approval endpoint records the decision and kicks this off. The pipeline
    tail (metric execution -> agents -> council -> report) replays the options
    captured at orchestrate time (run.pipeline_payload). Same finalize/failure
    safety net as the initial job.
    """
    try:
        with Session(db_session.engine) as session:
            resume_governance_pipeline(session, run_id=run_id)
    except Exception as exc:  # noqa: BLE001 — background job: never let it crash silently
        logger.exception("Background resume-after-approval failed for run %s", run_id)
        _finalize_run(run_id, status=RunStatus.failed, error=exc)
    else:
        _finalize_run(run_id, status=RunStatus.completed)


def _finalize_run(
    run_id: UUID,
    *,
    status: RunStatus,
    error: Exception | None = None,
) -> None:
    """Force the run to a terminal state on a dedicated session.

    Uses its own session/connection so a poisoned pipeline session can never
    prevent the run from reaching a terminal status (the frontend polls until
    it sees one). No-ops when the run is already terminal.
    """
    terminal = {RunStatus.completed, RunStatus.failed, RunStatus.cancelled}
    try:
        with Session(db_session.engine) as session:
            run = get_run_or_raise(session, run_id)
            if run.status in terminal:
                return
            run.status = status
            if status == RunStatus.completed:
                run.current_phase = RunPhase.completed
            if error is not None:
                run.error_summary = {
                    "error_type": error.__class__.__name__,
                    "message": str(error),
                }
            run.completed_at = run.completed_at or utc_now()
            run.updated_at = utc_now()
            session.add(run)
            session.commit()
            logger.info("Finalized run %s as %s", run_id, status)
    except Exception:  # noqa: BLE001
        logger.exception("Could not finalize run %s as %s", run_id, status)


def run_governance_pipeline(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> GovernancePipelineRunRead | None:
    """Run the governance pipeline, or pause for plan approval.

    Returns the pipeline result when the run executes end-to-end, or None when
    it is gated on plan approval (paused at RunStatus.planned after planning).
    """
    run = get_run_or_raise(session, run_id)

    # Layer 1 always runs so the state chain captures context assembly and the run
    # progresses through phases in the spec-mandated order. Prefer explicit logs
    # (real logs or a user upload); when none are supplied, synthesize a
    # deterministic, system-specific sample so the analyzer and the downstream
    # orchestrator have real, per-system evidence to work with instead of an empty
    # "everything missing" result. The assembler records its own GovernanceState
    # and audit-ledger entries.
    logs = payload.logs
    logs_source = "payload"
    if not logs:
        ai_system = session.get(AISystem, run.ai_system_id)
        if ai_system is not None:
            logs = synthesize_logs_for_system(ai_system)
            logs_source = "synthesized"
    context_result: ContextAssemblyRead | None = context_assembly.assemble_context(
        session,
        run_id=run_id,
        payload=ContextAssemblyCreate(
            logs=logs,
            requested_by=payload.requested_by,
            notes=_context_notes(payload.notes, logs_source, len(logs)),
        ),
    )

    # Layer 2: build and persist the evaluation plan before any execution so the
    # state chain records the plan and the run passes through the 'planned' phase.
    evaluation_plan = adaptive_orchestrator.prepare_evaluation_plan(
        session,
        run_id=run_id,
        payload=EvaluationPlanCreate(
            requested_by=payload.requested_by,
            notes=payload.notes,
        ),
    )

    # Human-in-the-loop gate: when approval is required and not yet granted, pause
    # here. prepare_evaluation_plan already parked the run at RunStatus.planned;
    # we capture the pipeline options and log an awaiting-approval ledger event,
    # then return None so the caller leaves the run parked for the reviewer.
    run = get_run_or_raise(session, run_id)
    if payload.require_plan_approval and run.plan_approved_at is None:
        _pause_for_approval(session, run_id=run_id, payload=payload)
        return None

    return _execute_and_report(
        session,
        run_id=run_id,
        payload=payload,
        context_result=context_result,
        evaluation_plan=evaluation_plan,
    )


def _pause_for_approval(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> None:
    """Park a run awaiting plan approval, capturing options to replay on resume."""
    run = get_run_or_raise(session, run_id)
    # Persist the pipeline options so the resume step runs exactly what was
    # planned/approved. model_dump(mode="json") keeps it JSON-column-safe.
    run.pipeline_payload = payload.model_dump(mode="json")
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type="plan.awaiting_approval",
            actor_type=LedgerActorType.system,
            actor_id="orchestrator",
            payload={
                "phase": RunPhase.adaptive_orchestrator,
                "message": "Metric plan awaiting human approval before execution.",
            },
        ),
    )
    logger.info("Run %s paused for metric-plan approval", run_id)


def resume_governance_pipeline(
    session: Session,
    *,
    run_id: UUID,
) -> GovernancePipelineRunRead:
    """Run the pipeline tail after a paused plan has been approved.

    Replays the options captured at orchestrate time and re-loads the persisted
    evaluation plan, then executes metrics -> agents -> council -> report.
    """
    run = get_run_or_raise(session, run_id)
    payload = (
        GovernancePipelineRunCreate.model_validate(run.pipeline_payload)
        if run.pipeline_payload
        else GovernancePipelineRunCreate()
    )
    evaluation_plan = adaptive_orchestrator.get_latest_plan(session, run_id=run_id)
    return _execute_and_report(
        session,
        run_id=run_id,
        payload=payload,
        context_result=None,
        evaluation_plan=evaluation_plan,
    )


def _execute_and_report(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
    context_result: ContextAssemblyRead | None,
    evaluation_plan: EvaluationPlanRead,
) -> GovernancePipelineRunRead:
    """Pipeline tail: metric execution -> agents -> council -> report -> finalize."""
    metric_result = metric_execution.run_metrics(
        session,
        run_id=run_id,
        payload=MetricExecutionCreate(
            mock_score=payload.mock_score,
            force_status=payload.force_metric_status,
            source_name=payload.source_name,
            evaluator_name=payload.evaluator_name,
        ),
    )
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.metric_execution,
        entry_type="metric_execution_completed",
        event_type="metric_execution.completed",
        actor_type=LedgerActorType.tool,
        actor_id=payload.evaluator_name,
        payload={
            "evaluator_name": payload.evaluator_name,
            "evidence_created": metric_result.evidence_created,
            "metric_results_created": metric_result.metric_results_created,
        },
    )

    # Honor an explicit agent selection; otherwise run exactly the agents the
    # evaluation plan activated (falling back to all agents if the plan is empty).
    if payload.agent_names is not None:
        agent_names = payload.agent_names
    else:
        agent_names = [agent.agent_name for agent in evaluation_plan.activated_agents] or None

    agent_result = agent_execution.run_agents(
        session,
        run_id=run_id,
        payload=AgentRunCreate(agent_names=agent_names),
        evaluation_plan=evaluation_plan,
    )
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.specialist_agents,
        entry_type="agent_execution_completed",
        event_type="agent_execution.completed",
        actor_type=LedgerActorType.agent,
        actor_id="agent_orchestrator",
        payload={
            "agents_requested": agent_names,
            "agents_run": [agent.agent_name for agent in agent_result.agents_run],
            "findings_created": agent_result.findings_created,
        },
    )

    council_result = council.deliberate(
        session,
        run_id=run_id,
        payload=CouncilDeliberationCreate(
            requested_by=payload.requested_by,
            notes=payload.notes,
        ),
    )
    # State only: the council layer writes its own council_deliberation.completed
    # ledger entry (so the standalone /council/deliberate path is audited too).
    # Re-logging it here would duplicate that ledger event.
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.deliberation_council,
        entry_type="council_deliberation_completed",
        event_type="council_deliberation.completed",
        actor_type=LedgerActorType.system,
        actor_id="council_service",
        record_ledger=False,
        payload={
            "requested_by": payload.requested_by,
            "label": council_result.verdict.label,
            "action_tier": council_result.verdict.action_tier,
            "confidence_score": council_result.verdict.confidence_score,
            "finding_count": council_result.finding_count,
            "metric_result_count": council_result.metric_result_count,
        },
    )

    # Make the Action & Reporting stage observable: without this transition the
    # run jumps deliberation_council -> completed and the frontend's Action &
    # Reporting stage never activates during a live run. Only the phase moves;
    # the status stays non-terminal (report_ready would stop frontend polling
    # before the completed status lands).
    run = get_run_or_raise(session, run_id)
    run.current_phase = RunPhase.action_reporting
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    report = reports.build_governance_report(session, run_id=run_id)
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.action_reporting,
        entry_type="governance_report_generated",
        event_type="governance_report.generated",
        actor_type=LedgerActorType.system,
        actor_id="report_service",
        payload={
            "counts": report.counts,
            "state_chain_valid": report.state_chain.valid,
        },
    )

    # Finalize: report building is read-only, so without this the run would be
    # left parked at council_running / deliberation_council — never a terminal
    # status. That made the SSE progress stream never close and the frontend
    # completion poll hang forever. Mark the run completed at action_reporting.
    run = get_run_or_raise(session, run_id)
    run.status = RunStatus.completed
    run.current_phase = RunPhase.completed
    run.completed_at = run.completed_at or utc_now()
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    return GovernancePipelineRunRead(
        run_id=run_id,
        context_assembly=context_result,
        evaluation_plan=evaluation_plan,
        metric_execution=metric_result,
        agent_run=agent_result,
        council=council_result,
        report=report,
    )


# Non-terminal statuses a run can be parked at mid-pipeline. Each phase commits
# its own status so progress is observable, so a run interrupted between phases
# is left at whichever of these it had reached.
_INTERRUPTED_STATUSES = (
    RunStatus.created,
    RunStatus.context_assembly,
    RunStatus.planned,
    RunStatus.metrics_running,
    RunStatus.agents_running,
    RunStatus.council_running,
)


def reconcile_interrupted_runs(session: Session) -> int:
    """Finalize runs orphaned by a worker restart mid-pipeline.

    The pipeline runs as a FastAPI BackgroundTask, which does NOT survive a
    process restart. A run executing when the server stopped is therefore left
    at a non-terminal status with no task left to finish it — the Live Run
    stream never closes and the completion poll hangs forever. On startup we
    finalize these:
      - a run that already produced a VERDICT reached the council phase, so the
        assessment is effectively complete -> mark ``completed``;
      - a run with no verdict died earlier and cannot resume -> mark ``failed``.
    Returns the number of runs reconciled.
    """
    stuck = session.exec(
        select(EvaluationRun).where(EvaluationRun.status.in_(_INTERRUPTED_STATUSES))
    ).all()
    reconciled = 0
    for run in stuck:
        has_verdict = (
            session.exec(select(Verdict.id).where(Verdict.run_id == run.id)).first()
            is not None
        )
        if has_verdict:
            run.status = RunStatus.completed
            run.current_phase = RunPhase.completed
            run.result_summary = {
                **(run.result_summary or {}),
                "reconciled": "finalized_after_worker_restart",
            }
        else:
            run.status = RunStatus.failed
            run.error_summary = {
                "error_type": "OrchestrationInterrupted",
                "message": "Run was interrupted before completion (worker restart) and reconciled on startup.",
            }
        run.completed_at = run.completed_at or utc_now()
        run.updated_at = utc_now()
        session.add(run)
        reconciled += 1

    if reconciled:
        session.commit()
        logger.info("Reconciled %d interrupted run(s) on startup", reconciled)
    return reconciled


def _context_notes(notes: str | None, source: str, count: int) -> str | None:
    """Annotate context-assembly notes with the log provenance for the audit trail."""
    provenance = (
        f"Log source: {source} ({count} record(s))."
        if source == "synthesized"
        else None
    )
    if notes and provenance:
        return f"{notes} {provenance}"
    return notes or provenance


def _record_pipeline_step(
    session: Session,
    *,
    run_id: UUID,
    phase: RunPhase,
    entry_type: str,
    event_type: str,
    actor_type: LedgerActorType,
    actor_id: str | None,
    payload: dict[str, object],
    record_ledger: bool = True,
) -> None:
    governance_state.append_state_entry(
        session,
        run_id=run_id,
        payload=GovernanceStateEntryCreate(
            entry_type=entry_type,
            source="orchestrator",
            phase=phase,
            payload=payload,
        ),
    )
    if not record_ledger:
        return
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            payload={**payload, "phase": phase},
        ),
    )
