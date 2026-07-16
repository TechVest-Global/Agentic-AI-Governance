from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError, ResourceNotFoundError
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.schemas.governance import (
    AuditLedgerEntryCreate,
    EvaluationRunCancel,
    EvaluationRunComplete,
    EvaluationRunCreate,
    EvaluationRunFail,
    EvaluationRunStart,
    PlanApprovalCreate,
)
from app.services import audit_ledger

TERMINAL_RUN_STATUSES = {
    RunStatus.completed,
    RunStatus.failed,
    RunStatus.cancelled,
}


def create_evaluation_run(session: Session, payload: EvaluationRunCreate) -> EvaluationRun:
    if session.get(AISystem, payload.ai_system_id) is None:
        raise ResourceNotFoundError("AI system", str(payload.ai_system_id))

    run = EvaluationRun(**payload.model_dump())
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def list_evaluation_runs(
    session: Session,
    *,
    offset: int,
    limit: int,
    ai_system_id: UUID | None = None,
) -> list[EvaluationRun]:
    statement = select(EvaluationRun)
    if ai_system_id is not None:
        statement = statement.where(EvaluationRun.ai_system_id == ai_system_id)
    statement = (
        statement.order_by(EvaluationRun.created_at.desc()).offset(offset).limit(limit)
    )
    return list(session.exec(statement).all())


def get_evaluation_run(session: Session, run_id: UUID) -> EvaluationRun:
    run = session.get(EvaluationRun, run_id)
    if run is None:
        raise ResourceNotFoundError("Evaluation run", str(run_id))
    return run


def start_evaluation_run(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationRunStart,
) -> EvaluationRun:
    run = get_evaluation_run(session, run_id)
    _ensure_can_transition(run, target_status=RunStatus.context_assembly)

    run.status = RunStatus.context_assembly
    run.current_phase = RunPhase.context_assembly
    run.started_at = run.started_at or utc_now()
    run.result_summary = _merge_summary(
        run.result_summary,
        {"start_note": payload.note} if payload.note else {},
    )
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def complete_evaluation_run(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationRunComplete,
) -> EvaluationRun:
    run = get_evaluation_run(session, run_id)
    _ensure_can_transition(run, target_status=RunStatus.completed)

    run.status = RunStatus.completed
    run.current_phase = RunPhase.action_reporting
    run.started_at = run.started_at or utc_now()
    run.completed_at = utc_now()
    run.result_summary = _merge_summary(run.result_summary, payload.result_summary)
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def fail_evaluation_run(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationRunFail,
) -> EvaluationRun:
    run = get_evaluation_run(session, run_id)
    _ensure_can_transition(run, target_status=RunStatus.failed)

    run.status = RunStatus.failed
    run.started_at = run.started_at or utc_now()
    run.completed_at = utc_now()
    run.error_summary = _merge_summary(run.error_summary, payload.error_summary)
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def cancel_evaluation_run(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationRunCancel,
) -> EvaluationRun:
    run = get_evaluation_run(session, run_id)
    _ensure_can_transition(run, target_status=RunStatus.cancelled)

    run.status = RunStatus.cancelled
    run.started_at = run.started_at or utc_now()
    run.completed_at = utc_now()
    run.error_summary = _merge_summary(
        run.error_summary,
        {"reason": payload.reason} if payload.reason else {},
    )
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def is_awaiting_plan_approval(run: EvaluationRun) -> bool:
    """A run paused for human plan approval: parked at 'planned', not yet approved.

    prepare_evaluation_plan leaves a run at RunStatus.planned; when the pipeline
    is gated, it stops there instead of proceeding to metric execution. Once
    approved (plan_approved_at set) the run resumes, so that combination is the
    single source of truth for "waiting on a reviewer".
    """
    return run.status == RunStatus.planned and run.plan_approved_at is None


def approve_plan(
    session: Session,
    *,
    run_id: UUID,
    payload: PlanApprovalCreate,
) -> EvaluationRun:
    """Approve a paused metric plan and advance the run so its pipeline resumes.

    Records who/when to the run (queryable source of truth) and the tamper-evident
    audit ledger, then moves the run to metrics_running so the Live Run view
    reflects resumption immediately. The caller kicks off the resume background job.
    """
    run = get_evaluation_run(session, run_id)
    if not is_awaiting_plan_approval(run):
        raise ApplicationError(
            status_code=409,
            code="PLAN_NOT_AWAITING_APPROVAL",
            message="This run has no metric plan awaiting approval.",
            details={
                "run_id": str(run.id),
                "current_status": run.status,
                "already_approved_at": (
                    run.plan_approved_at.isoformat() if run.plan_approved_at else None
                ),
            },
        )

    # Manual override: the reviewer hand-picked the metrics to run. Reject an
    # empty list — an empty selected_metrics means "no explicit selection", which
    # build_metric_plan expands to every framework metric (the opposite of intent).
    manual_selection = payload.selected_metrics is not None
    if manual_selection and not payload.selected_metrics:
        raise ApplicationError(
            status_code=422,
            code="EMPTY_METRIC_SELECTION",
            message="Select at least one metric, or approve the plan as-is.",
            details={"run_id": str(run.id)},
        )

    if manual_selection:
        _apply_manual_metric_selection(session, run=run, metric_ids=payload.selected_metrics)
        # _apply_manual_metric_selection re-plans and re-fetches the run; reload
        # so subsequent writes land on a live instance.
        run = get_evaluation_run(session, run_id)

    now = utc_now()
    run.plan_approved_at = now
    run.plan_approved_by = payload.approved_by
    # Advance out of 'planned' so watchers see the run resume the instant approval
    # lands; the resume job then drives the remaining phase transitions.
    run.status = RunStatus.metrics_running
    run.current_phase = RunPhase.metric_execution
    run.updated_at = now
    session.add(run)

    # Build (but don't independently commit) the ledger entry so the run's
    # status change and its audit record land in a single transaction. If the
    # ledger insert fails (unique constraint race, DB blip), the whole commit
    # below rolls back rather than leaving the run advanced with no matching
    # ledger entry.
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type="plan.approved",
            actor_type=LedgerActorType.user,
            actor_id=payload.approved_by,
            payload={
                "phase": RunPhase.adaptive_orchestrator,
                "approved_by": payload.approved_by,
                "notes": payload.notes,
                "manual_selection": manual_selection,
                "selected_metrics": payload.selected_metrics if manual_selection else None,
            },
        ),
        commit=False,
    )
    session.commit()

    session.refresh(run)
    return run


def _apply_manual_metric_selection(
    session: Session,
    *,
    run: EvaluationRun,
    metric_ids: list[str],
) -> None:
    """Override the run's metric plan with a reviewer-chosen subset and re-plan.

    Writing the explicit set to run.selected_metrics makes build_metric_plan run
    exactly those metrics (it bypasses framework selection when a selection is
    supplied), and prepare_evaluation_plan skips its LLM refinement, so the
    rebuilt plan's activated agents and probe budgets reflect the chosen subset.
    """
    # Imported here to avoid a circular import at module load (the orchestrator
    # package pulls in services that import this module).
    from app.schemas.governance import EvaluationPlanCreate
    from app.services import adaptive_orchestrator

    run.selected_metrics = list(metric_ids)
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    adaptive_orchestrator.prepare_evaluation_plan(
        session,
        run_id=run.id,
        payload=EvaluationPlanCreate(notes="Plan revised by manual metric selection."),
    )


def _ensure_can_transition(
    run: EvaluationRun,
    *,
    target_status: RunStatus,
) -> None:
    if run.status in TERMINAL_RUN_STATUSES:
        raise ApplicationError(
            status_code=409,
            code="INVALID_RUN_TRANSITION",
            message="Evaluation run is already in a terminal state.",
            details={
                "run_id": str(run.id),
                "current_status": run.status,
                "target_status": target_status,
            },
        )


def _merge_summary(
    existing: dict[str, object] | None,
    incoming: dict[str, object],
) -> dict[str, object]:
    return {**(existing or {}), **incoming}
