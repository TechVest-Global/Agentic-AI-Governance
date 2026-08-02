import logging
from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError, ResourceConflictError
from app.db import session as db_session
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import AgentExecutionStatus, LedgerActorType, RunPhase, RunStatus
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
    concurrency,
    content_integrity,
    context_assembly,
    governance_state,
)
from app.services import verdicts as verdict_service
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
            ai_system_id = get_run_or_raise(session, run_id).ai_system_id
        with concurrency.ai_system_run_lock(db_session.engine, ai_system_id=ai_system_id):
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
            ai_system_id = get_run_or_raise(session, run_id).ai_system_id
        with concurrency.ai_system_run_lock(db_session.engine, ai_system_id=ai_system_id):
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

    ``degraded`` is a HALF-terminal state and needs care in both directions.
    ``run_metrics``/``run_agents`` set it mid-pipeline, before the council and
    report steps have run, so it is not proof the run finished:

      * a success finalize must NOT overwrite it back to ``completed`` — the
        pipeline decided the run was degraded and that decision stands;
      * a FAILURE finalize must be able to overwrite it. Treating degraded as
        fully terminal meant a run that degraded during the agent phase and
        then genuinely crashed in the council was left sitting at ``degraded``
        with no ``error_summary`` and no ``completed_at`` — the crash surfaced
        only in the logs, and the run read as "finished, some agents failed".
        Since ``degraded`` is also not in ``_INTERRUPTED_STATUSES``, startup
        reconciliation never revisited it either, so the misreport was
        permanent.
    """
    terminal = {
        RunStatus.completed,
        RunStatus.failed,
        RunStatus.cancelled,
    }
    try:
        with Session(db_session.engine) as session:
            run = get_run_or_raise(session, run_id)
            if run.status in terminal:
                return
            if run.status == RunStatus.degraded and status != RunStatus.failed:
                return
            run.status = status
            if status == RunStatus.completed:
                run.current_phase = RunPhase.completed
            if error is not None:
                # Merged, not replaced: a degraded run already carries
                # `degraded_reason` and the list of failed agents, and that
                # context is exactly what makes the later crash diagnosable.
                run.error_summary = {
                    **(run.error_summary or {}),
                    "error_type": error.__class__.__name__,
                    # ApplicationError carries a stable machine-readable code;
                    # without it the only thing recorded is prose, which callers
                    # end up string-matching on.
                    "error_code": getattr(error, "code", None),
                    "message": str(error),
                }
            run.completed_at = run.completed_at or utc_now()
            run.updated_at = utc_now()
            session.add(run)
            session.commit()
            logger.info("Finalized run %s as %s", run_id, status)
            # Why a run failed is the single most important fact an auditor
            # will want to reconstruct later; without a ledger entry it only
            # ever lived in the mutable run.error_summary column, outside the
            # hash chain, and could be edited afterward with nothing to
            # detect it. A ledger-write failure here must never block
            # finalization, so it's isolated in its own try/except.
            try:
                audit_ledger.append_ledger_entry(
                    session,
                    run_id=run_id,
                    payload=AuditLedgerEntryCreate(
                        event_type="run.finalized",
                        actor_type=LedgerActorType.system,
                        actor_id="orchestrator",
                        payload={
                            "status": status,
                            "error_type": error.__class__.__name__ if error else None,
                            "message": str(error) if error else None,
                        },
                    ),
                )
            except Exception:  # noqa: BLE001
                logger.exception("Could not ledger-record finalization of run %s", run_id)
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

    # Persist the pipeline options unconditionally (not only when gated on
    # plan approval) so a crash-and-resume — whether from reconcile_interrupted_runs
    # or the approval flow — can always replay exactly what was originally
    # requested (explicit agent_names, evaluator_name, mock_score, ...)
    # instead of resume_governance_pipeline falling back to defaults and
    # silently running a different agent set than what was actually asked for.
    run.pipeline_payload = payload.model_dump(mode="json")
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

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
    """Park a run awaiting plan approval.

    run.pipeline_payload was already captured unconditionally at the top of
    run_governance_pipeline, so the resume step replays exactly what was
    originally requested regardless of whether this pause happens.
    """
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
            # Content-integrity checkpoint: lets a later verify pass detect if
            # these specific MetricResult rows were altered/deleted after the
            # fact, which the ledger's own hash chain alone cannot catch.
            "metric_result_ids": sorted(str(m.id) for m in metric_result.metric_results),
            "content_digest": content_integrity.metric_result_content_digest(
                metric_result.metric_results
            ),
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
            # Content-integrity checkpoint (see metric_execution.completed above).
            "finding_ids": sorted(str(f.id) for f in agent_result.findings),
            "content_digest": content_integrity.finding_content_digest(agent_result.findings),
        },
    )

    # The council is the pipeline's most failure-prone step: it is the only phase
    # that depends on a live judge model for every pass, and a judge outage, rate
    # limit, or cold start therefore used to fail the WHOLE run — discarding the
    # report even though every metric result and agent finding was already
    # committed. Metric and agent failures both degrade gracefully; this now
    # matches them.
    council_result = None
    council_error: dict[str, str] | None = None
    try:
        council_result = council.deliberate(
            session,
            run_id=run_id,
            payload=CouncilDeliberationCreate(
                requested_by=payload.requested_by,
                notes=payload.notes,
            ),
        )
    except ResourceConflictError:
        # A Verdict already exists. The legitimate case is resuming an
        # interrupted run whose council phase completed before the crash — a run
        # can only ever have one Verdict, so that is not a failure to retry,
        # it's the outcome already reached. Ordered before the broad handler
        # below: recovering a verdict that already exists is a success path, and
        # must not be degraded as if the council had failed.
        #
        # But this branch used to adopt ANY pre-existing verdict as the council's
        # outcome. Since a verdict could be written through the public route
        # before the run ever reached the council, that turned a planted row into
        # the run's official council decision — reported and exported as though
        # the council had reasoned its way to it. Confirm the council actually
        # produced this verdict (the ledger is the provenance record; the Verdict
        # table has no such column) and fail loudly if it did not, rather than
        # laundering an unverified verdict through the pipeline.
        if not verdict_service.council_produced_verdict(session, run_id=run_id):
            raise ApplicationError(
                status_code=409,
                code="VERDICT_NOT_COUNCIL_PRODUCED",
                message=(
                    "This run already holds a verdict that the Deliberation Council did not "
                    "produce, so the council cannot record its own. The run cannot be "
                    "completed until that verdict is removed."
                ),
                details={"run_id": str(run_id)},
            ) from None
        council_result = council.get_existing_deliberation(session, run_id=run_id)
    except Exception as exc:  # noqa: BLE001 — a lost verdict must not lose the evidence
        logger.exception("Council deliberation failed for run %s", run_id)
        council_error = {"error_type": exc.__class__.__name__, "message": str(exc)}
        # deliberate() may have raised mid-transaction, leaving this session
        # dirty; every step below (report, finalize) would then fail too. Roll
        # back to a usable session. Safe: the earlier phases committed their own
        # work, so this discards only the council's partial writes.
        session.rollback()
        _record_pipeline_step(
            session,
            run_id=run_id,
            phase=RunPhase.deliberation_council,
            entry_type="council_deliberation_failed",
            event_type="council_deliberation.failed",
            actor_type=LedgerActorType.system,
            actor_id="council_service",
            payload={"requested_by": payload.requested_by, **council_error},
        )

    # Both guards are needed: `is not None` because the council may have failed
    # and left no result at all, and `created_verdict` because a recovered
    # deliberation did not create one on this pass.
    if council_result is not None and council_result.created_verdict:
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

    # A missing verdict does not prevent a report: build_governance_report reads
    # the verdict with .first(), so it renders the evidence collected so far and
    # simply carries no verdict. That is the whole point of degrading here rather
    # than failing — the audit record survives a lost verdict.
    report = None
    report_error: dict[str, str] | None = None
    try:
        report = reports.build_governance_report(session, run_id=run_id)
    except Exception as exc:  # noqa: BLE001 — must still reach a terminal status
        logger.exception("Report generation failed for run %s", run_id)
        report_error = {"error_type": exc.__class__.__name__, "message": str(exc)}
        session.rollback()
    else:
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
                "ledger_chain_valid": report.ledger_chain.valid,
            },
        )

    # Finalize: report building is read-only, so without this the run would be
    # left parked at council_running / deliberation_council — never a terminal
    # status. That made the SSE progress stream never close and the frontend
    # completion poll hang forever. Mark the run completed at action_reporting —
    # UNLESS some part of the evaluation failed: a specialist agent, the council,
    # or report generation. Later steps still run on whatever evidence WAS
    # produced, but the failure is real and must be surfaced, not silently
    # overwritten to "completed". The standalone /agents/run endpoint already
    # preserves 'degraded' in this situation; the full pipeline must match it.
    run = get_run_or_raise(session, run_id)
    failed_executions = [
        execution
        for execution in agent_result.executions
        if execution.status == AgentExecutionStatus.failed
    ]
    # Every partial failure degrades the run rather than failing it, and each
    # records its own reason. Collected together so a run that lost, say, an
    # agent AND the verdict reports both instead of only whichever is checked
    # first — silently dropping one would understate how incomplete the audit is.
    degraded: dict[str, dict] = {}
    if failed_executions:
        degraded["specialist_agent_failure"] = {
            "message": (
                f"{len(failed_executions)} of {len(agent_result.executions)} "
                "specialist agent(s) failed during evaluation; the run "
                "completed in a degraded state on the remaining evidence."
            ),
            "failed_agents": [
                {
                    "agent_name": execution.agent_name,
                    "error": execution.error_summary,
                }
                for execution in failed_executions
            ],
        }
    if council_error is not None:
        degraded["council_failure"] = {
            "message": (
                "The Deliberation Council could not produce a verdict, so this run "
                "carries NO governance decision. The metric results and specialist "
                "findings it did collect are preserved and reported; re-run the "
                "council on this run to obtain a verdict."
            ),
            "error": council_error,
        }
    if report_error is not None:
        degraded["report_failure"] = {
            "message": (
                "Report generation failed; the underlying evidence is still stored "
                "and the report can be regenerated from it."
            ),
            "error": report_error,
        }

    if degraded:
        run.status = RunStatus.degraded
        run.error_summary = {
            **(run.error_summary or {}),
            "degraded_reason": ",".join(sorted(degraded)),
            # Flat one-liner as well as the structured detail: the run list renders
            # error_summary generically, so without a top-level message it would
            # show a stringified object instead of something a reader can scan.
            "message": " ".join(degraded[key]["message"] for key in sorted(degraded)),
            **{key: value for key, value in degraded.items()},
        }
    else:
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


def _is_interrupted_degraded(run: EvaluationRun) -> bool:
    """Whether a ``degraded`` run was actually abandoned mid-pipeline.

    ``degraded`` is set in two very different places. ``run_metrics`` and
    ``run_agents`` set it the moment something fails, while the run still has
    the council and report phases ahead of it; ``_execute_and_report`` sets it
    at the very end, together with ``current_phase = completed``. Only the first
    kind is interrupted work, so the phase is what distinguishes them — without
    this, a worker restart during the council left a degraded run permanently
    unreconciled, because ``degraded`` is absent from _INTERRUPTED_STATUSES.
    """
    return run.status == RunStatus.degraded and run.current_phase != RunPhase.completed


def reconcile_interrupted_runs(session: Session) -> int:
    """Resume or finalize runs orphaned by a worker restart mid-pipeline.

    The pipeline runs as a FastAPI BackgroundTask, which does NOT survive a
    process restart. A run executing when the server stopped is therefore left
    at a non-terminal status with no task left to finish it — the Live Run
    stream never closes and the completion poll hangs forever. On startup we
    reconcile these:
      - a run parked awaiting human plan approval is NOT interrupted — it is
        working exactly as designed, waiting on a person, not a crash — so it
        is left untouched;
      - a run that already produced a VERDICT reached the council phase, so the
        assessment is effectively complete -> mark ``completed``;
      - any other run is attempted via resume_governance_pipeline (which skips
        whatever sub-steps already persisted, see run_metrics/run_agents) ->
        mark ``completed``/``degraded`` on success;
      - only if that resume attempt itself raises is the run marked ``failed``,
        with the real error recorded (both on the run and in the ledger).
    Returns the number of runs reconciled.
    """
    from app.services.evaluation_runs import is_awaiting_plan_approval

    stuck = session.exec(
        select(EvaluationRun).where(
            EvaluationRun.status.in_((*_INTERRUPTED_STATUSES, RunStatus.degraded))
        )
    ).all()
    reconciled = 0
    for run in stuck:
        # A degraded run that reached the report phase is genuinely finished;
        # only one abandoned mid-pipeline needs reconciling.
        if run.status == RunStatus.degraded and not _is_interrupted_degraded(run):
            continue
        if is_awaiting_plan_approval(run):
            continue

        has_verdict = (
            session.exec(select(Verdict.id).where(Verdict.run_id == run.id)).first()
            is not None
        )
        if has_verdict:
            # Preserve degraded: the run reached a verdict, but some of the
            # evidence behind it is missing and finalizing it as a clean
            # `completed` would erase that on restart.
            run.status = (
                RunStatus.degraded if run.status == RunStatus.degraded else RunStatus.completed
            )
            run.current_phase = RunPhase.completed
            run.result_summary = {
                **(run.result_summary or {}),
                "reconciled": "finalized_after_worker_restart",
            }
            run.completed_at = run.completed_at or utc_now()
            run.updated_at = utc_now()
            session.add(run)
            reconciled += 1
            continue

        try:
            with concurrency.ai_system_run_lock(db_session.engine, ai_system_id=run.ai_system_id):
                if run.status in (RunStatus.created, RunStatus.context_assembly):
                    # No evaluation plan was ever persisted at this point, so
                    # there is nothing to resume from — restart the pipeline.
                    # Context assembly makes no target-system calls, so retrying
                    # it from scratch has no side effects to worry about.
                    run_governance_pipeline(
                        session, run_id=run.id, payload=GovernancePipelineRunCreate()
                    )
                else:
                    resume_governance_pipeline(session, run_id=run.id)
        except Exception as exc:  # noqa: BLE001 — one bad run must not block the rest
            logger.exception("Could not resume interrupted run %s on startup", run.id)
            run = get_run_or_raise(session, run.id)
            run.status = RunStatus.failed
            run.error_summary = {
                "error_type": exc.__class__.__name__,
                "message": str(exc),
                "context": "Resume attempt after worker restart failed.",
            }
            run.completed_at = run.completed_at or utc_now()
            run.updated_at = utc_now()
            session.add(run)
            session.commit()
            try:
                audit_ledger.append_ledger_entry(
                    session,
                    run_id=run.id,
                    payload=AuditLedgerEntryCreate(
                        event_type="run.reconcile_failed",
                        actor_type=LedgerActorType.system,
                        actor_id="orchestrator",
                        payload={
                            "error_type": exc.__class__.__name__,
                            "message": str(exc),
                        },
                    ),
                )
            except Exception:  # noqa: BLE001
                logger.exception("Could not ledger-record reconcile failure for run %s", run.id)
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
