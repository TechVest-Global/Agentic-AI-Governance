import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from sqlmodel import Session, select

from app.db import session as db_session
from app.models.agent import AgentExecution
from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.base import utc_now
from app.models.enums import AgentExecutionStatus, LedgerActorType, RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import (
    AgentRunCreate,
    AgentRunRead,
    AgentRunSummary,
    AuditLedgerEntryCreate,
    EvaluationPlanRead,
    FindingCreate,
    MetricPlanItem,
)
from app.services import audit_ledger
from app.services.agents.base import AgentContext, GovernanceAgent
from app.services.agents.registry import select_agents
from app.services.model_clients.gateway import (
    bind_log_capture,
    drain_log_capture,
    get_log_buffer,
    set_current_agent,
    start_log_capture,
)
from app.services.model_clients.registry import (
    get_governance_model_client,
    get_target_model_client_for_system,
)
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents.metric_plans import build_metric_plan

logger = logging.getLogger(__name__)

# Specialist agents run CONCURRENTLY — this is Layer 3 as specified in README.md
# ("Layer 3: Specialist Agents / Parallel agents for bias, drift, misuse,
# compliance, explainability, and risk") and permitted by SPEC.md FR-024, which
# forbids agent-to-agent messaging precisely so this layer can fan out.
#
# Each agent is dominated by blocking network I/O (target probes + governance-LLM
# reasoning), so running them one at a time cost sum(agent durations) instead of
# max(agent duration) — measured at 133s vs a ~55s critical path on a 7-agent run.
#
# Bounded LOW on purpose, and note this MULTIPLIES with AGENT_PROBE_MAX_WORKERS
# (each agent fans its own probes out over its own pool): 3 agents x 6 probes is
# up to 18 concurrent requests into the audited system, against 6 before. Raising
# either knob risks the HTTP 429 storm that already forced
# METRIC_EXECUTION_MAX_WORKERS down from 6 to 3. Override with
# AGENT_EXECUTION_MAX_WORKERS.
_MAX_AGENT_WORKERS = int(os.getenv("AGENT_EXECUTION_MAX_WORKERS", "3"))

# Hard wall-clock budget for the parallel fan-out, mirroring metric_execution's
# guard: an agent blocked on an unbounded network call would otherwise hang the
# pool join forever and park the run in `agents_running`. Any agent still in
# flight when the budget expires is recorded as failed, so the run always
# advances to a terminal state. Override with AGENT_EXECUTION_BUDGET_SECONDS.
_AGENT_PHASE_BUDGET_SECONDS = float(os.getenv("AGENT_EXECUTION_BUDGET_SECONDS", "900"))


@dataclass
class _AgentOutcome:
    """Everything one agent produced, captured on the thread that ran it.

    Findings are returned rather than persisted in-thread: writes stay on the
    caller's session, single-threaded and in deterministic registry order, so a
    concurrent phase still yields a byte-identical audit record ordering.
    """

    started_at: datetime
    completed_at: datetime
    findings: list[FindingCreate] = field(default_factory=list)
    error: dict[str, str] | None = None
    probe_count: int = 0
    probes_skipped: list[dict] = field(default_factory=list)


@dataclass
class _WorkerSnapshot:
    """Detached, fully-materialized copies of everything the agents read."""

    ai_system: AISystem | None
    context_profile: ApplicationContextProfile | None
    capabilities: list[AISystemCapability]
    evidence: list[EvidenceRecord]
    metric_results: list[MetricResult]
    metric_plan_items: list[MetricPlanItem]
    # Findings that existed BEFORE this phase fanned out (prior runs/phases).
    # Detached like the rest: run_agents commits again after this snapshot is
    # taken (to publish the `running` execution rows), which would expire these
    # instances if they were still owned by the shared session.
    existing_findings: list[Finding]


def _load_worker_snapshot(*, ai_system_id: UUID, run_id: UUID) -> _WorkerSnapshot:
    """Load the agents' read-set on a throwaway session, then close it.

    run_agents commits before the fan-out (to publish the phase change to live
    watchers), and that commit expires every ORM attribute on the shared
    session's instances. The first worker thread to touch ai_system.* or a
    MetricResult would then trigger a lazy refresh on that shared session, and
    concurrent refreshes from several workers raise "session is provisioning a
    new connection; concurrent operations are not permitted".

    Closing this snapshot session detaches the instances with all column
    attributes already materialized, so worker reads are plain attribute access
    with no session involved. Same technique as metric_execution.py's
    worker_ai_system.
    """
    with Session(db_session.engine) as snapshot:
        return _WorkerSnapshot(
            ai_system=snapshot.get(AISystem, ai_system_id),
            context_profile=_get_context_profile(snapshot, ai_system_id=ai_system_id),
            capabilities=_list_capabilities(snapshot, ai_system_id=ai_system_id),
            evidence=_list_evidence(snapshot, run_id=run_id),
            metric_results=_list_metric_results(snapshot, run_id=run_id),
            metric_plan_items=build_metric_plan(snapshot, run_id=run_id).metrics,
            existing_findings=_list_findings(snapshot, run_id=run_id),
        )


def _execute_agent(
    agent: GovernanceAgent,
    context: AgentContext,
    *,
    capture_buffer: list[dict] | None,
) -> _AgentOutcome:
    """Run one agent and capture its result. Never raises."""
    # contextvars don't cross thread boundaries — rebind the parent's audit
    # buffer (a plain list; append is thread-safe under the GIL) so this
    # worker's LLM calls land in the same per-run capture, attributed to this
    # agent. Rebound fresh per agent because pool threads are reused.
    bind_log_capture(capture_buffer, agent_name=agent.name)
    started_at = utc_now()
    try:
        findings = list(agent.evaluate(context))
        error = None
    except Exception as exc:  # noqa: BLE001 - one agent's failure must not sink the phase
        logger.exception("Specialist agent %s failed", agent.name)
        findings = []
        error = {"error_type": exc.__class__.__name__, "message": str(exc)}
    finally:
        # Clear attribution so LLM calls made after this agent (notably the
        # council's, which runs on this same thread and contextvar scope) are
        # not misattributed to it.
        set_current_agent(None)
    return _AgentOutcome(
        started_at=started_at,
        completed_at=utc_now(),
        findings=findings,
        error=error,
        probe_count=context.probe_counts.get(agent.name, 0),
        probes_skipped=context.probe_skips.get(agent.name, []),
    )


def run_agents(
    session: Session,
    *,
    run_id: UUID,
    payload: AgentRunCreate,
    evaluation_plan: EvaluationPlanRead | None = None,
    probe_budget_override: int | None = None,
    is_remediation_call: bool = False,
) -> AgentRunRead:
    run = get_run_or_raise(session, run_id)
    # Enter the specialist-agents phase up front and commit, so a client polling
    # the run / streaming SSE sees "Specialist Agents" become active while the
    # (slow, real-target) agents run — instead of the phase only flipping after
    # every agent finishes.
    #
    # Skipped for a council re_probe remediation call: the run is mid-
    # deliberation_council at that point, and flipping status/phase back to
    # "Specialist Agents" would make a live observer see the run jump
    # backward, then forward again once deliberate() resumes.
    if not is_remediation_call:
        run.status = RunStatus.agents_running
        run.current_phase = RunPhase.specialist_agents
        run.updated_at = utc_now()
        session.add(run)
        session.commit()

    # run_id makes each captured call durable as it happens, so a client
    # watching this (slow) phase sees probes accumulate instead of nothing
    # until the drain below.
    start_log_capture(run_id, RunPhase.specialist_agents.value)
    capture_buffer = get_log_buffer()
    if probe_budget_override is not None:
        # Mid-council re_probe remediation needs a *bit* more sample size, not
        # a full plan-scaled re-run (which could be up to 100 probes/agent) —
        # cap it explicitly regardless of what the evaluation plan allocated.
        probe_budgets = {name: probe_budget_override for name in (payload.agent_names or [])}
    elif evaluation_plan is not None:
        probe_budgets = {
            item.agent_name: item.probe_budget for item in evaluation_plan.activated_agents
        }
    else:
        probe_budgets = {}
    # Everything below reads from `session` BEFORE any worker starts — no shared
    # session touch once the pool is live.
    snapshot = _load_worker_snapshot(ai_system_id=run.ai_system_id, run_id=run_id)
    prior_metric_scores = _get_prior_metric_scores(
        session, ai_system_id=run.ai_system_id, current_run_id=run_id
    )
    selected_capabilities = list(run.selected_capabilities or [])
    # Built from the detached snapshot, not the shared-session instance: the
    # resolver only reads attributes, and the workers share this one client.
    target_client = get_target_model_client_for_system(snapshot.ai_system)

    # Resuming a run interrupted mid-phase (see
    # orchestration.reconcile_interrupted_runs) must not re-run agents that
    # already completed — each agent may make real probe calls against the
    # target system, and the per-agent commits in _finalize below mean a prior
    # partial attempt's completed agents are already durable. Remediation calls
    # are exempt: re_probe/re_plan deliberately re-run a named agent regardless
    # of an earlier completion, that's a different, intentional mechanism.
    # Read from `session` here, before any worker starts.
    already_done_names: set[str] = set()
    reused_executions: list[AgentExecution] = []
    reused_findings: list[Finding] = []
    if not is_remediation_call:
        for execution in session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .where(AgentExecution.status == AgentExecutionStatus.completed)
        ).all():
            if not (execution.metadata_json or {}).get("is_remediation"):
                already_done_names.add(execution.agent_name)
                reused_executions.append(execution)
        if already_done_names:
            reused_findings = [
                f for f in _list_findings(session, run_id=run_id)
                if f.agent_name in already_done_names
            ]

    def _context_for(
        *,
        own_session: Session,
        existing_findings: list[Finding],
    ) -> AgentContext:
        # Fresh probe_counts / probe_skips per agent: the frozen AgentContext
        # shares these dicts by reference, so giving each agent its own pair
        # keeps concurrent agents from writing into a common dict.
        return AgentContext(
            run_id=run_id,
            ai_system=snapshot.ai_system,
            context_profile=snapshot.context_profile,
            capabilities=snapshot.capabilities,
            evidence=snapshot.evidence,
            metric_results=snapshot.metric_results,
            existing_findings=existing_findings,
            prior_metric_scores=prior_metric_scores,
            probe_budgets=probe_budgets,
            metric_plan_items=snapshot.metric_plan_items,
            session=own_session,
            target_client=target_client,
            probe_counts={},
            probe_skips={},
            selected_capabilities=selected_capabilities,
        )

    agents = select_agents(
        payload.agent_names,
        target_client=target_client,
        governance_client=get_governance_model_client(),
    )
    # Agents a prior interrupted attempt already completed are dropped from BOTH
    # stages: they must not be re-run, and they already hold durable `completed`
    # rows, so no second `running` row should be created for them either. Their
    # executions/findings are folded back in via reused_* at the return below.
    agents = [a for a in agents if a.name not in already_done_names]
    # Layer 3 runs in two stages. Peer-independent agents fan out concurrently;
    # a finding-aggregating agent (RiskScorer) runs after the barrier so it sees
    # a COMPLETE specialist finding set — see GovernanceAgent
    # .aggregates_peer_findings.
    fanout_agents = [a for a in agents if not getattr(a, "aggregates_peer_findings", False)]
    aggregate_agents = [a for a in agents if getattr(a, "aggregates_peer_findings", False)]
    ordered_agents = [*fanout_agents, *aggregate_agents]

    # Create one execution row per agent up front and COMMIT, so a client polling
    # /agents/executions or watching the SSE stream sees every agent appear as
    # `running` while the phase is in flight — the same reason the phase flip
    # above is committed early. Deferring these rows until after the fan-out
    # would leave the live view empty for the whole (slow) phase. The rows belong
    # to this single-threaded session; workers never touch them.
    executions: list[AgentExecution] = []
    execution_by_agent: dict[str, AgentExecution] = {}
    for agent in ordered_agents:
        execution = AgentExecution(
            run_id=run_id,
            agent_name=agent.name,
            status=AgentExecutionStatus.running,
            started_at=utc_now(),
            metadata_json={
                "execution_mode": getattr(agent, "execution_mode", "deterministic"),
                "selected_by_request": payload.agent_names is not None,
                # How this agent was scheduled. Recorded as evidence so a
                # governance reviewer can confirm from the audit trail that
                # Layer 3 fanned out as specified, rather than taking it on faith.
                "execution_stage": (
                    "aggregate" if getattr(agent, "aggregates_peer_findings", False) else "parallel"
                ),
                # Marks rows this call created as remediation work, so a later
                # resume's already-completed scan skips them — a re_probe/re_plan
                # execution must never suppress the normal agent of the same name.
                "is_remediation": is_remediation_call,
            },
        )
        session.add(execution)
        executions.append(execution)
        execution_by_agent[agent.name] = execution
    session.commit()

    def _run_in_worker(agent: GovernanceAgent) -> _AgentOutcome:
        # Each worker gets its own short-lived session: SQLModel sessions are not
        # thread-safe, and an agent's probe path calls record_execution_artifacts,
        # which COMMITS. On the shared session that commit would also flush every
        # other agent's half-built state mid-phase.
        with Session(db_session.engine) as worker_session:
            return _execute_agent(
                agent,
                _context_for(
                    own_session=worker_session,
                    existing_findings=snapshot.existing_findings,
                ),
                capture_buffer=capture_buffer,
            )

    outcomes: dict[str, _AgentOutcome] = {}
    if len(fanout_agents) == 1:
        # Single agent (e.g. the council's re_probe remediation): skip the pool
        # and stay on this thread, as _execute_probe_plan does for one probe.
        outcomes[fanout_agents[0].name] = _run_in_worker(fanout_agents[0])
    elif fanout_agents:
        worker_count = max(1, min(_MAX_AGENT_WORKERS, len(fanout_agents)))
        # Collect as agents complete, up to a hard budget; shutdown(wait=False)
        # is deliberate — stragglers are abandoned, never blocked on.
        pool = ThreadPoolExecutor(max_workers=worker_count)
        future_to_agent = {pool.submit(_run_in_worker, a): a for a in fanout_agents}
        try:
            for future in as_completed(future_to_agent, timeout=_AGENT_PHASE_BUDGET_SECONDS):
                agent = future_to_agent[future]
                try:
                    outcomes[agent.name] = future.result()
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Specialist agent %s failed", agent.name)
                    outcomes[agent.name] = _AgentOutcome(
                        started_at=utc_now(),
                        completed_at=utc_now(),
                        error={"error_type": exc.__class__.__name__, "message": str(exc)},
                    )
        except FuturesTimeout:
            pending = [a.name for f, a in future_to_agent.items() if not f.done()]
            logger.warning(
                "Specialist agents hit the %.0fs budget; abandoning %d unfinished agent(s): %s",
                _AGENT_PHASE_BUDGET_SECONDS,
                len(pending),
                pending,
            )
        pool.shutdown(wait=False)

    created_findings: list[Finding] = []
    failed_execution_count = 0

    def _finalize(agent: GovernanceAgent, outcome: _AgentOutcome) -> None:
        """Write one agent's result onto its pre-created row. Main thread only."""
        nonlocal failed_execution_count
        execution = execution_by_agent[agent.name]
        execution.status = (
            AgentExecutionStatus.failed if outcome.error else AgentExecutionStatus.completed
        )
        # Overwrite the placeholder timestamps with the real execution window
        # measured on the thread that ran the agent — this is what makes the
        # overlap between agents provable from the audit record.
        execution.started_at = outcome.started_at
        execution.completed_at = outcome.completed_at
        execution.error_summary = outcome.error
        execution.finding_count = len(outcome.findings)
        execution.metadata_json = {
            **(execution.metadata_json or {}),
            # Real probe count (set by the agent during evaluate) so the SSE
            # progress stream reports a live "Probes Sent" total. Recorded even
            # on failure, so partial probing is still counted.
            "probe_count": outcome.probe_count,
            "probes_skipped": outcome.probes_skipped,
        }
        execution.updated_at = utc_now()
        if outcome.error:
            failed_execution_count += 1
        session.add(execution)
        for finding_payload in outcome.findings:
            finding = Finding(run_id=run_id, **finding_payload.model_dump())
            session.add(finding)
            created_findings.append(finding)
        # One tamper-evident ledger event PER AGENT. The orchestrator writes a
        # single agent_execution.completed for the whole layer, which is all the
        # Runtime Event Stream had to show for it: one row covering seven agents,
        # only after every one of them had finished. The per-agent rows are what
        # make the fan-out legible in the run trace — and, because each carries
        # its own execution window, what lets a reviewer confirm the agents
        # actually overlapped rather than taking the stage label on faith.
        #
        # commit=False so the execution row, its findings, and this event land in
        # the single commit below: a ledger claiming an agent completed must
        # never outlive a rollback of the work it describes.
        audit_ledger.append_ledger_entry(
            session,
            run_id=run_id,
            payload=AuditLedgerEntryCreate(
                event_type="agent.failed" if outcome.error else "agent.completed",
                actor_type=LedgerActorType.agent,
                actor_id=agent.name,
                payload={
                    # The Runtime Event Stream filters on payload.phase; without
                    # it these events exist but render on no layer.
                    "phase": RunPhase.specialist_agents.value,
                    "agent_name": agent.name,
                    "status": execution.status.value,
                    "execution_stage": (execution.metadata_json or {}).get("execution_stage"),
                    "probe_count": outcome.probe_count,
                    "probes_skipped": len(outcome.probes_skipped),
                    "finding_count": len(outcome.findings),
                    "started_at": outcome.started_at.isoformat(),
                    "completed_at": outcome.completed_at.isoformat(),
                    "duration_ms": int(
                        (outcome.completed_at - outcome.started_at).total_seconds() * 1000
                    ),
                    "is_remediation": is_remediation_call,
                    "error": outcome.error,
                },
            ),
            commit=False,
        )
        # Commit each agent as it is finalized rather than batching the whole
        # phase into the commit at the end. Every agent finalized here has
        # already made real probe calls against the target system, and the
        # aggregate stage below issues further governance-LLM calls — a crash
        # there must not discard the durable record of the fan-out agents that
        # already finished.
        session.commit()

    # Finalize in registry order regardless of completion order, so findings are
    # appended and the UI's agent list reads deterministically across runs.
    for agent in fanout_agents:
        _finalize(
            agent,
            outcomes.get(agent.name)
            or _AgentOutcome(
                started_at=utc_now(),
                completed_at=utc_now(),
                error={
                    "error_type": "TimeoutError",
                    "message": "agent exceeded the specialist-agent phase time budget",
                },
            ),
        )

    # ---- Barrier -----------------------------------------------------------
    # Flush so the fan-out's findings are visible to the aggregate stage's
    # queries within this transaction (the old sequential loop relied on
    # autoflush for the same effect). Redundant when the fan-out ran — _finalize
    # already committed each agent — but kept for the fan-out-empty case, where
    # an aggregate agent is the only thing in the phase.
    if aggregate_agents:
        session.flush()

    for agent in aggregate_agents:
        _finalize(
            agent,
            _execute_agent(
                agent,
                _context_for(
                    own_session=session,
                    existing_findings=_list_findings(session, run_id=run_id),
                ),
                capture_buffer=capture_buffer,
            ),
        )

    summaries = [_execution_summary(execution) for execution in executions]

    newly_created_findings_count = len(created_findings)

    if not is_remediation_call:
        run.status = RunStatus.degraded if failed_execution_count else RunStatus.agents_running
        run.current_phase = RunPhase.specialist_agents
    run.result_summary = {
        **(run.result_summary or {}),
        "agents_run": [summary.model_dump(mode="json") for summary in summaries],
        "agent_executions_failed": failed_execution_count,
        "agent_findings_created": newly_created_findings_count,
        "agents_reused_from_prior_attempt": len(reused_executions),
        "agents_completed_at": utc_now().isoformat(),
    }
    if not is_remediation_call:
        # How Layer 3 was scheduled, recorded on the run itself so a report or a
        # reviewer can state the execution model from evidence. Omitted for a
        # council re_probe, which re-runs a single agent and would otherwise
        # overwrite the real phase-wide record with a one-agent view.
        run.result_summary["agent_execution_model"] = {
            "parallel_stage": [a.name for a in fanout_agents],
            "aggregate_stage": [a.name for a in aggregate_agents],
            "max_parallel_workers": max(1, min(_MAX_AGENT_WORKERS, len(fanout_agents) or 1)),
        }
    run.updated_at = utc_now()
    session.add(run)
    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))
    session.commit()

    # Full current state (reused + newly run), same reasoning as run_metrics:
    # a resumed run's report/content-integrity digest must cover every
    # execution/finding that exists, not just this call's delta.
    return AgentRunRead(
        run_id=run_id,
        agents_run=[_execution_summary(e) for e in reused_executions] + summaries,
        executions=reused_executions + executions,
        findings_created=newly_created_findings_count,
        findings=reused_findings + created_findings,
    )


def list_agent_executions(session: Session, *, run_id: UUID) -> list[AgentExecution]:
    get_run_or_raise(session, run_id)
    return list(
        session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .order_by(AgentExecution.created_at.asc())
        ).all()
    )


def _execution_summary(execution: AgentExecution) -> AgentRunSummary:
    return AgentRunSummary(
        id=execution.id,
        agent_name=execution.agent_name,
        finding_count=execution.finding_count,
        status=execution.status,
    )


def _get_context_profile(
    session: Session,
    *,
    ai_system_id: UUID,
) -> ApplicationContextProfile | None:
    return session.exec(
        select(ApplicationContextProfile).where(
            ApplicationContextProfile.ai_system_id == ai_system_id
        )
    ).one_or_none()


def _list_capabilities(
    session: Session,
    *,
    ai_system_id: UUID,
) -> list[AISystemCapability]:
    return list(
        session.exec(
            select(AISystemCapability).where(AISystemCapability.ai_system_id == ai_system_id)
        ).all()
    )


def _list_evidence(session: Session, *, run_id: UUID) -> list[EvidenceRecord]:
    return list(session.exec(select(EvidenceRecord).where(EvidenceRecord.run_id == run_id)).all())


def _list_metric_results(session: Session, *, run_id: UUID) -> list[MetricResult]:
    return list(session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all())


def _list_findings(session: Session, *, run_id: UUID) -> list[Finding]:
    return list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())


def _get_prior_metric_scores(
    session: Session,
    *,
    ai_system_id: UUID,
    current_run_id: UUID,
) -> dict[str, float | None]:
    """Return metric_id -> normalized_score from the most recent completed run for this system."""
    prior_run = session.exec(
        select(EvaluationRun)
        .where(EvaluationRun.ai_system_id == ai_system_id)
        .where(EvaluationRun.id != current_run_id)
        .where(EvaluationRun.status.in_(["completed", "report_ready"]))
        .order_by(EvaluationRun.completed_at.desc())
    ).first()

    if prior_run is None:
        return {}

    prior_metrics = session.exec(
        select(MetricResult).where(MetricResult.run_id == prior_run.id)
    ).all()

    return {m.metric_id: m.normalized_score for m in prior_metrics}
