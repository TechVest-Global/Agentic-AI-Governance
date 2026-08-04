import functools
import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
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
from app.services.agents.helpers import agent_failed_finding, unprobed_endpoints_finding
from app.services.agents.registry import select_agents
from app.services.concurrency_settings import (
    agent_execution_budget_seconds,
    agent_execution_max_workers,
)
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

# Floor on what the aggregate stage gets when the fan-out has already consumed
# the whole phase budget. It reasons over findings that are already durable, so
# giving it nothing would throw away the composite risk score over a few seconds
# — but it must still be bounded, which is the whole point of the change.
_AGGREGATE_MIN_BUDGET_SECONDS = 120.0

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
#
# Hard wall-clock budget for the parallel fan-out, mirroring metric_execution's
# guard: an agent blocked on an unbounded network call would otherwise hang the
# pool join forever and park the run in `agents_running`. Any agent still in
# flight when the budget expires is recorded as failed, so the run always
# advances to a terminal state. Override with AGENT_EXECUTION_BUDGET_SECONDS.
#
# Both resolve through concurrency_settings per call rather than os.getenv at
# import: the app reads its config from <repo>/.env via pydantic-settings, which
# never populates os.environ, so setting either of these in .env did nothing at
# all despite the comments above documenting them as the override mechanism.


class _LateLogSink:
    """Hands the audit buffer's post-drain tail to abandoned agents' callbacks.

    ``drain_log_capture()`` returns the live buffer list and detaches it from the
    contextvar, but abandoned straggler threads still hold a reference through
    ``bind_log_capture`` and keep appending to it. Anything they appended after
    the drain was written to a list nobody read again — the LLM calls a
    still-running agent made simply vanished from ``llm_call_logs``.

    The cursor records how many entries the main thread actually persisted; each
    orphan callback then claims the slice past it, under a lock so two
    stragglers finishing together cannot both take the same entries.
    """

    def __init__(self, buffer: list[dict] | None) -> None:
        self._buffer = buffer
        self._cursor = 0
        self._lock = threading.Lock()

    def mark_drained(self, persisted_count: int) -> None:
        with self._lock:
            self._cursor = persisted_count

    def take_late_entries(self) -> list[dict]:
        if self._buffer is None:
            return []
        with self._lock:
            late = self._buffer[self._cursor:]
            self._cursor += len(late)
            return late


def _record_orphaned_agent_completion(
    run_id: UUID,
    agent_name: str,
    late_logs: _LateLogSink,
    future: Future,
) -> None:
    """Ledger-record a specialist agent that finished after its phase timed out.

    ``pool.shutdown(wait=False)`` deliberately does not block on stragglers so a
    single hung agent can never park the run — but the thread keeps running,
    keeps probing the live target system, and keeps committing execution
    artifacts on its own session, all against a run whose execution row already
    says the agent failed with a timeout. Without this callback none of that was
    recorded anywhere: the audit trail claimed the agent produced nothing while
    its artifacts were quietly landing in the database.

    Mirrors metric_execution._record_orphaned_completion. The agent's findings
    are deliberately NOT persisted — the phase is closed and its content digest
    already checkpointed, so folding late findings in would silently invalidate
    it. The count is recorded instead, so the loss is visible rather than
    implicit. Runs on the straggler's own thread with its own session, since the
    pipeline session is long closed by then.
    """
    try:
        outcome = "completed"
        detail: str | None = None
        finding_count = 0
        probe_count = 0
        try:
            result = future.result()
            if result is not None:
                finding_count = len(result.findings)
                probe_count = result.probe_count
                if result.error:
                    outcome = "error"
                    detail = result.error.get("message")
        except Exception as exc:  # noqa: BLE001
            outcome = "error"
            detail = str(exc)

        late_entries = late_logs.take_late_entries()
        with Session(db_session.engine) as session:
            for entry in late_entries:
                session.add(LLMCallLog(run_id=run_id, **entry))
            if late_entries:
                session.commit()
            audit_ledger.append_ledger_entry(
                session,
                run_id=run_id,
                payload=AuditLedgerEntryCreate(
                    event_type="agent.orphaned_after_timeout",
                    actor_type=LedgerActorType.system,
                    actor_id="agent_execution",
                    payload={
                        "agent_name": agent_name,
                        "outcome": outcome,
                        "detail": detail,
                        # Recorded, not persisted — see the docstring.
                        "findings_discarded": finding_count,
                        "probes_sent": probe_count,
                        "late_llm_calls_recovered": len(late_entries),
                        "note": (
                            "This agent was abandoned when the specialist-agent phase hit its "
                            "time budget and is recorded as failed. It kept running afterward "
                            "and may have sent further probes to the target system and written "
                            "execution artifacts; its findings were discarded."
                        ),
                    },
                ),
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "Could not record orphaned-agent completion for %s (run %s)", agent_name, run_id
        )


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
    # Probes the agent planned to send. Reported alongside probe_count rather
    # than instead of it: the gap between them IS the finding when a target is
    # unreachable, and conflating the two let a plan be reported as evidence.
    probes_planned: int = 0
    probes_skipped: list[dict] = field(default_factory=list)
    # Probes that were sent and errored. Captured even when the agent SUCCEEDS,
    # so a partially-degraded evaluation is visible in the audit record rather
    # than only in the logs — a reviewer must be able to tell that this agent
    # reasoned over fewer probes than the plan allocated.
    probes_failed: list[dict] = field(default_factory=list)


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
        # Own probes PLUS evidence-tool probes. Both are real requests to the
        # audited system, and this total is what the Council reads as
        # sample_sizes — an agent whose evidence came from garak/deepeval used to
        # report 0 here, so the Devil's Advocate objected that its findings
        # rested on no probes at all and the verdict's confidence was docked for
        # an evidence deficit that never existed.
        probe_count=(
            context.probe_counts.get(agent.name, 0)
            + context.tool_probe_counts.get(agent.name, 0)
        ),
        # What the agent INTENDED to send, kept separately so the difference is
        # legible. When probing raises, planned stays high and sent stays 0 —
        # previously the planned figure sat in probe_counts and was reported as
        # sent, so five agents claimed 79 probes on a run where 3 landed.
        probes_planned=context.probe_plan_counts.get(agent.name, 0),
        probes_skipped=context.probe_skips.get(agent.name, []),
        probes_failed=context.probe_failures.get(agent.name, []),
    )


def _agent_inputs(
    agent: GovernanceAgent,
    *,
    snapshot: _WorkerSnapshot,
    probe_budgets: dict[str, int],
    selected_capabilities: list[str],
    evaluation_plan: EvaluationPlanRead | None,
) -> dict:
    """What this agent was handed, recorded BEFORE it runs.

    An execution row used to say only how an agent was scheduled. Its outputs
    (probes, findings) arrived at the end, and its INPUTS were never recorded at
    all — so an agent that failed, timed out, or exited early left nothing
    explaining what it had been asked to check. On a run where the audited
    target was out of quota, six agents failed with an error string and zero
    findings, and the record could not answer "what was bias_agent even
    looking at?".

    Written at row-creation time so it is queryable while the phase is still
    running, not only after the agent returns.
    """
    plan_item = None
    if evaluation_plan is not None:
        plan_item = next(
            (a for a in evaluation_plan.activated_agents if a.agent_name == agent.name), None
        )

    # Metrics this agent owns. The plan is authoritative when present; otherwise
    # fall back to the metric plan's own primary_agent attribution.
    if plan_item is not None and plan_item.assigned_metric_ids:
        owned_ids = list(plan_item.assigned_metric_ids)
    else:
        owned_ids = [
            item.metric_id
            for item in (snapshot.metric_plan_items or [])
            if getattr(item, "primary_agent", None) == agent.name
        ]

    # Human names for the IDs, from the run's own metric plan — "CM-017" means
    # nothing to a reader, "Disparate Failure Rate" does. Taken from the plan
    # rather than a hardcoded UI lookup table so the label can never drift from
    # the catalog the run actually used.
    names = {
        item.metric_id: item.name
        for item in (snapshot.metric_plan_items or [])
        if getattr(item, "name", None)
    }
    dimensions = {
        item.metric_id: item.dimension
        for item in (snapshot.metric_plan_items or [])
        if getattr(item, "dimension", None)
    }

    # The upstream state those metrics were in — this is the evidence the agent
    # reasons over, and what decides whether it probes at all.
    owned = [m for m in snapshot.metric_results if m.metric_id in set(owned_ids)]
    return {
        "dimension": getattr(agent, "probe_dimension", None) or agent.name,
        "assigned_metric_ids": owned_ids,
        "assigned_metrics": [
            {"metric_id": mid, "name": names.get(mid, mid), "dimension": dimensions.get(mid)}
            for mid in owned_ids
        ],
        "probe_budget": probe_budgets.get(agent.name),
        "priority": getattr(plan_item, "priority", None),
        "activation_rationale": getattr(plan_item, "rationale", None),
        "audit_scope_capabilities": selected_capabilities or ["<whole application>"],
        # Statuses drive the probe/skip decision, so record them as seen.
        "assigned_metric_states": [
            {
                "metric_id": m.metric_id,
                "name": names.get(m.metric_id, m.metric_id),
                "dimension": m.dimension,
                "status": str(getattr(m.status, "value", m.status)),
                "normalized_score": m.normalized_score,
                "threshold": m.threshold,
                "passed": m.passed,
            }
            for m in owned
        ],
        "visible_metric_results": len(snapshot.metric_results),
        "visible_evidence_records": len(snapshot.evidence),
        "visible_prior_findings": len(snapshot.existing_findings),
    }


def _agent_outputs(outcome: "_AgentOutcome") -> dict:
    """What this agent produced, in the same place its inputs are recorded."""
    by_severity: dict[str, int] = {}
    for f in outcome.findings:
        key = str(getattr(f.severity, "value", f.severity))
        by_severity[key] = by_severity.get(key, 0) + 1
    return {
        "probes_sent": outcome.probe_count,
        "probes_planned": outcome.probes_planned,
        # The honest headline when a target refuses: planned 30, sent 0.
        "probes_not_sent": max(0, outcome.probes_planned - outcome.probe_count),
        "probes_skipped": len(outcome.probes_skipped),
        "probes_failed": len(getattr(outcome, "probes_failed", []) or []),
        "finding_count": len(outcome.findings),
        "findings_by_severity": by_severity,
        "finding_titles": [f.title for f in outcome.findings],
        "error": outcome.error,
    }


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
            probe_failures={},
            tool_probe_counts={},
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
                # What this agent was handed. Written now, while its status is
                # still `running`, so the inputs are visible during the phase and
                # survive a failure that produces no outputs at all.
                "inputs": _agent_inputs(
                    agent,
                    snapshot=snapshot,
                    probe_budgets=probe_budgets,
                    selected_capabilities=selected_capabilities,
                    evaluation_plan=evaluation_plan,
                ),
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

    def _run_aggregate_in_worker(
        agent: GovernanceAgent, existing_findings: list[Finding]
    ) -> _AgentOutcome:
        """Same isolation as _run_in_worker, but over the post-barrier finding set.

        On a thread rather than inline so the aggregate stage can be held to the
        phase budget — see the aggregate loop below.
        """
        with Session(db_session.engine) as worker_session:
            return _execute_agent(
                agent,
                _context_for(
                    own_session=worker_session,
                    existing_findings=existing_findings,
                ),
                capture_buffer=capture_buffer,
            )

    # Late LLM calls made by any agent abandoned below are recovered through
    # this sink; see _LateLogSink and _record_orphaned_agent_completion.
    late_logs = _LateLogSink(capture_buffer)
    # Start of the phase's wall-clock budget, shared by both stages.
    phase_started_at = utc_now()

    outcomes: dict[str, _AgentOutcome] = {}
    if len(fanout_agents) == 1:
        # Single agent (e.g. the council's re_probe remediation): skip the pool
        # and stay on this thread, as _execute_probe_plan does for one probe.
        outcomes[fanout_agents[0].name] = _run_in_worker(fanout_agents[0])
    elif fanout_agents:
        phase_budget_seconds = agent_execution_budget_seconds()
        worker_count = max(1, min(agent_execution_max_workers(), len(fanout_agents)))
        # Collect as agents complete, up to a hard budget; shutdown(wait=False)
        # is deliberate — stragglers are abandoned, never blocked on.
        pool = ThreadPoolExecutor(max_workers=worker_count)
        future_to_agent = {pool.submit(_run_in_worker, a): a for a in fanout_agents}
        try:
            for future in as_completed(future_to_agent, timeout=phase_budget_seconds):
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
            pending = {f: a for f, a in future_to_agent.items() if not f.done()}
            logger.warning(
                "Specialist agents hit the %.0fs budget; abandoning %d unfinished agent(s): %s",
                phase_budget_seconds,
                len(pending),
                [a.name for a in pending.values()],
            )
            # An abandoned agent keeps running, keeps probing the target and
            # keeps committing execution artifacts against this run. Attach a
            # completion callback so what it actually did lands in the ledger
            # instead of only its timeout stub appearing in the audit record.
            for pending_future, pending_agent in pending.items():
                pending_future.add_done_callback(
                    functools.partial(
                        _record_orphaned_agent_completion,
                        run_id,
                        pending_agent.name,
                        late_logs,
                    )
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
            "probes_planned": outcome.probes_planned,
            "probes_skipped": outcome.probes_skipped,
            "probes_failed": outcome.probes_failed,
            # Paired with `inputs` above, so one row answers both "what was this
            # agent asked to check" and "what did it come back with" — including
            # when the answer is "nothing, and here is why".
            "outputs": _agent_outputs(outcome),
        }
        execution.updated_at = utc_now()
        if outcome.error:
            failed_execution_count += 1
        session.add(execution)
        # A failed agent produced no findings, so its dimension contributed
        # nothing to the report — and the council counts findings, so silence
        # read as "clean". Record the failure AS a finding so the coverage loss
        # is visible in the evidence package, not only in an execution row's
        # error column that no report renders.
        emitted = list(outcome.findings)
        if outcome.error and not emitted:
            emitted.append(
                agent_failed_finding(
                    agent_name=agent.name,
                    dimension=getattr(agent, "probe_dimension", None) or agent.name,
                    error=outcome.error,
                )
            )
            execution.finding_count = len(emitted)
        for finding_payload in emitted:
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
                    # `emitted`, not outcome.findings: a failed agent's synthetic
                    # coverage finding must be counted here too, or the ledger
                    # disagrees with the execution row it describes.
                    "finding_count": len(emitted),
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

    # The phase budget bounded the fan-out only — it is an `as_completed`
    # timeout on that pool, and the aggregate stage ran straight on this thread
    # with no bound at all. On a run against a throttled target, risk_scorer
    # blocked here for 7.8 HOURS against a 900s phase budget, holding the run at
    # `agents_running` and the request thread with it. Give the aggregate stage
    # whatever remains of the same budget, on the same abandon-never-block terms
    # as the fan-out.
    for agent in aggregate_agents:
        remaining = max(
            _AGGREGATE_MIN_BUDGET_SECONDS,
            agent_execution_budget_seconds() - (utc_now() - phase_started_at).total_seconds(),
        )
        aggregate_pool = ThreadPoolExecutor(max_workers=1)
        aggregate_future = aggregate_pool.submit(
            _run_aggregate_in_worker, agent, _list_findings(session, run_id=run_id)
        )
        try:
            aggregate_outcome = aggregate_future.result(timeout=remaining)
        except FuturesTimeout:
            logger.warning(
                "Aggregate agent %s exceeded its %.0fs share of the phase budget; abandoning it",
                agent.name,
                remaining,
            )
            aggregate_outcome = _AgentOutcome(
                started_at=utc_now(),
                completed_at=utc_now(),
                error={
                    "error_type": "TimeoutError",
                    "message": (
                        "aggregate agent exceeded the specialist-agent phase time budget"
                    ),
                },
            )
        finally:
            aggregate_pool.shutdown(wait=False)
        _finalize(agent, aggregate_outcome)

    # ---- Endpoint coverage -------------------------------------------------
    # Every probe this phase sent has now been logged with the endpoint it hit,
    # so this is the first point where "which registered surfaces did we
    # actually reach" can be answered. Recorded here, inside the phase, so the
    # finding is part of `created_findings` and therefore covered by the content
    # digest the orchestrator checkpoints — a coverage claim added afterwards
    # would sit outside the integrity record it belongs to.
    #
    # Skipped for a remediation call: a council re_probe deliberately targets one
    # agent, so "endpoints it didn't reach" is not a coverage gap, just its scope.
    if not is_remediation_call:
        _finalize_endpoint_coverage(
            session,
            run_id=run_id,
            ai_system_id=run.ai_system_id,
            capture_buffer=capture_buffer,
            created_findings=created_findings,
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
            "max_parallel_workers": max(
                1, min(agent_execution_max_workers(), len(fanout_agents) or 1)
            ),
        }
    run.updated_at = utc_now()
    session.add(run)
    # Snapshot the length BEFORE iterating: an abandoned straggler may still be
    # appending to this same list, and the cursor handed to late_logs has to be
    # exactly what we persisted here, so its callback claims the tail and
    # nothing is either dropped or written twice.
    drained = drain_log_capture()
    persisted_log_count = len(drained)
    for entry in drained[:persisted_log_count]:
        session.add(LLMCallLog(run_id=run_id, **entry))
    late_logs.mark_drained(persisted_log_count)
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


def _finalize_endpoint_coverage(
    session: Session,
    *,
    run_id: UUID,
    ai_system_id: UUID,
    capture_buffer: list[dict] | None,
    created_findings: list[Finding],
) -> None:
    """Record any registered endpoint this run's probes never reached.

    Reads the phase's own capture buffer rather than re-querying llm_call_logs,
    because those rows are not written until the final commit below — and a
    coverage claim has to be computed from what this phase actually did, not
    from whatever happens to be in the table.
    """
    probed: set[str] = {
        str(entry.get("endpoint_ref"))
        for entry in (capture_buffer or [])
        if entry.get("call_type") == "target" and entry.get("endpoint_ref")
    }
    registered = list(
        session.exec(
            select(AISystemCapability).where(
                AISystemCapability.ai_system_id == ai_system_id
            )
        ).all()
    )
    # Nothing to claim either way when a system declares no capability
    # endpoints — the audit ran against its single base endpoint.
    if len(registered) < 2:
        return
    unprobed = [(c.endpoint_ref, c.name) for c in registered if c.endpoint_ref not in probed]
    if not unprobed or len(unprobed) == len(registered):
        # All reached, or none were — the latter is already loud (every agent
        # failed, the run is degraded), and claiming a coverage gap on top would
        # just add noise to an outage.
        return
    finding = Finding(
        run_id=run_id,
        **unprobed_endpoints_finding(
            agent_name="agent_orchestrator", endpoints=unprobed
        ).model_dump(),
    )
    session.add(finding)
    created_findings.append(finding)
    session.commit()


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
