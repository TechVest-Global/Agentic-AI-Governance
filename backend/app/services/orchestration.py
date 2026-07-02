import logging
from uuid import UUID

from sqlmodel import Session

from app.db import session as db_session
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.schemas.governance import (
    AgentRunCreate,
    AuditLedgerEntryCreate,
    ContextAssemblyCreate,
    ContextAssemblyRead,
    CouncilDeliberationCreate,
    EvaluationPlanCreate,
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
    """
    with Session(db_session.engine) as session:
        try:
            run_governance_pipeline(session, run_id=run_id, payload=payload)
        except Exception as exc:  # noqa: BLE001 — background job: never let it crash silently
            logger.exception("Background orchestration failed for run %s", run_id)
            try:
                run = get_run_or_raise(session, run_id)
                run.status = RunStatus.failed
                run.completed_at = run.completed_at or utc_now()
                run.updated_at = utc_now()
                run.error_summary = {
                    "error_type": exc.__class__.__name__,
                    "message": str(exc),
                }
                session.add(run)
                session.commit()
            except Exception:  # noqa: BLE001
                logger.exception("Could not mark run %s as failed", run_id)


def run_governance_pipeline(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> GovernancePipelineRunRead:
    get_run_or_raise(session, run_id)

    context_result: ContextAssemblyRead | None = None
    if payload.logs:
        # Layer 1 runs first so the state chain captures context assembly and the
        # run progresses through phases in the spec-mandated order. The assembler
        # records its own GovernanceState and audit-ledger entries.
        context_result = context_assembly.assemble_context(
            session,
            run_id=run_id,
            payload=ContextAssemblyCreate(
                logs=payload.logs,
                requested_by=payload.requested_by,
                notes=payload.notes,
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
