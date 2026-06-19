from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError, ResourceNotFoundError
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.schemas.governance import (
    EvaluationRunCancel,
    EvaluationRunComplete,
    EvaluationRunCreate,
    EvaluationRunFail,
    EvaluationRunStart,
)

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
