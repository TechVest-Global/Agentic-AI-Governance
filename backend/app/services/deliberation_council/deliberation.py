"""Layer 4 — Deliberation Council orchestrator.

Wires the three council agents (Synthesis → Devil's Advocate → Verdict)
into a bounded remediation loop with three exits:

  1. Sufficient evidence  →  proceed to Layer 5 (action tier)
  2. Loop exhausted       →  human review with an uncertainty memo
  3. Insufficient + under cap  →  re-enter pipeline at the cheapest fix point

Architecture: Deliberation Council Remediation Loop addendum (June 2026).

Key invariants preserved:
  - Append-only: every iteration's artifacts are written with an iteration index.
  - Counter persistence: the iteration count is stored in run.result_summary so a
    crash-and-resume never resets it to zero.
  - Forced dissent: the Devil's Advocate fires on EVERY pass, not just the first.
  - Full council re-run: re-entering at any point always flows through the complete
    Synthesis → DA → Verdict chain.
  - No new DB schema: artifacts are stored in the GovernanceState payload and the
    Verdict record (existing schema), keeping the backend unchanged.
  - re_plan activates a dormant specialist for a dimension an upheld
    objection names but nothing has probed yet this run (see
    _resolve_re_plan_target) — a no-op only when no upheld objection names
    a real, not-yet-covered dimension.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlmodel import Session, select

from app.configs.prompt_registry import PromptRegistry
from app.core.exceptions import ResourceConflictError
from app.models.agent import AgentExecution
from app.models.base import utc_now
from app.models.enums import (
    ActionTier,
    AgentExecutionStatus,
    FindingStatus,
    LedgerActorType,
    RunPhase,
    RunStatus,
)
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.models.llm_call_log import LLMCallLog
from app.models.verdict import Verdict
from app.schemas.governance import (
    AuditLedgerEntryCreate,
    CouncilDeliberationCreate,
    CouncilDeliberationRead,
    GovernanceStateEntryCreate,
)
from app.services import audit_ledger, governance_state
from app.services.agents.registry import DIMENSION_TO_AGENT_NAME
from app.services.deliberation_council.devils_advocate_agent import (
    DevilsAdvocateAgent,
    Objection,
)
from app.services.deliberation_council.remediation_router import (
    MAX_ITERATIONS,
    RouterExit,
    build_exhaustion_memo,
    route,
)
from app.services.deliberation_council.synthesis_agent import SynthesisAgent, SynthesisMemo
from app.services.deliberation_council.verdict_agent import VerdictAgent, VerdictOutput
from app.services.model_clients.gateway import (
    bind_log_capture,
    drain_log_capture,
    get_log_buffer,
    start_log_capture,
)
from app.services.model_clients.mock import MockGovernanceModelClient
from app.services.model_clients.registry import get_governance_model_client
from app.services.run_validation import get_run_or_raise

logger = logging.getLogger(__name__)

# re_probe remediation needs a *bit* more sample size to address a sample-
# adequacy objection, not a full plan-scaled re-run (which can be up to 100
# probes/agent) — that would turn one remediation loop into another full
# audit pass. This cap keeps mid-council remediation fast.
RE_PROBE_BUDGET_CAP = 8


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def deliberate(
    session: Session,
    *,
    run_id: UUID,
    payload: CouncilDeliberationCreate,
) -> CouncilDeliberationRead:
    """Run the Deliberation Council with a bounded remediation loop.

    Guards:
    - Raises ResourceConflictError if a Verdict already exists for this run.
    - Reads the persisted iteration counter from result_summary so crash-resume
      does not reset the cap.
    """
    run = get_run_or_raise(session, run_id)

    existing_verdict = session.exec(
        select(Verdict).where(Verdict.run_id == run_id)
    ).first()
    if existing_verdict is not None:
        raise ResourceConflictError("Verdict", "run_id", str(run_id))

    start_log_capture()

    # Build council agents — share one registry load across all three agents
    governance_client = _get_governance_client()
    registry = PromptRegistry.from_directory()
    synthesis_agent = SynthesisAgent(governance_client, registry)
    da_agent = DevilsAdvocateAgent(governance_client, registry)
    verdict_agent = VerdictAgent(governance_client, registry)

    # Load persisted iteration counter (survives crash-resume)
    starting_iteration = _read_iteration_counter(run)

    findings = _list_open_findings(session, run_id)
    metric_results = _list_metric_results(session, run_id)

    # -----------------------------------------------------------------------
    # Remediation loop
    # -----------------------------------------------------------------------
    iteration = starting_iteration
    last_verdict: VerdictOutput | None = None
    last_memo: SynthesisMemo | None = None
    all_objections: list[Objection] = []

    while True:
        iteration += 1
        logger.info("Council iteration %d/%d for run %s", iteration, MAX_ITERATIONS, run_id)

        # Apply "latest iteration per agent" read rule: use all findings but
        # pass them sorted so the synthesis sees the most recent data first.
        current_findings = _latest_findings_per_agent(findings)
        # Re-read every iteration: a re_probe remediation between iterations
        # adds more AgentExecution rows, so the real count can grow mid-loop.
        real_probe_counts = _get_real_probe_counts(session, run_id)

        # Pass 1: Synthesis
        memo = synthesis_agent.synthesize(
            findings=current_findings,
            metric_results=metric_results,
            iteration=iteration,
            real_probe_counts=real_probe_counts,
        )

        # Pass 2: Devil's Advocate (forced dissent on every iteration) — sees
        # the same raw findings Synthesis was built from, not just the memo,
        # so it can catch an omission rather than only critiquing prose.
        objections = da_agent.object_to(memo, current_findings)
        all_objections.extend(objections)

        # Pass 3: Verdict
        verdict_out = verdict_agent.adjudicate(
            memo=memo,
            objections=objections,
            findings=current_findings,
            metric_results=metric_results,
            iteration=iteration,
        )

        last_verdict = verdict_out
        last_memo = memo

        # Persist iteration counter before routing so a crash here does not
        # reset the count on resume
        _persist_iteration_counter(session, run, iteration)

        # Write append-only state entry for this iteration's artifacts
        _append_council_iteration_state(
            session,
            run_id=run_id,
            iteration=iteration,
            memo=memo,
            objections=objections,
            verdict=verdict_out,
        )

        # Commit now (not just flush) so a concurrent request polling this run
        # can observe real per-iteration progress instead of the whole 1-3
        # iteration loop being invisible until it fully completes.
        session.commit()
        session.refresh(run)

        # Deterministic routing — three exits, checked in priority order
        decision = route(verdict_out, iteration)
        logger.info(
            "Router exit=%s reason=%s (iteration %d)",
            decision.exit,
            decision.reason,
            iteration,
        )

        if decision.exit == RouterExit.action:
            # Exit 1: sufficient — proceed to Layer 5
            break

        if decision.exit == RouterExit.exhausted:
            # Exit 2: cap reached — force verdict at current confidence
            logger.warning(
                "Council exhausted after %d iterations for run %s", iteration, run_id
            )
            break

        # Exit 3: remediate — re-enter at the right upstream point
        # For re_probe: in the MVP the specialist re-runs within this process;
        # findings list is refreshed from the DB after the re-probe.
        if decision.remediation_type is not None:
            findings, metric_results = _apply_remediation(
                session,
                run_id=run_id,
                remediation_type=str(decision.remediation_type),
                target_agent=decision.target_agent,
                objections=objections,
                objections_upheld=verdict_out.objections_upheld,
            )

    # -----------------------------------------------------------------------
    # Persist verdict
    # -----------------------------------------------------------------------
    assert last_verdict is not None
    assert last_memo is not None

    exhaustion_memo: dict | None = None
    if decision.exit == RouterExit.exhausted:
        exhaustion_memo = build_exhaustion_memo(last_verdict, iteration)

    open_findings = [f for f in findings if f.status == FindingStatus.open]
    all_findings = _list_all_findings(session, run_id)

    verdict_record = _persist_verdict(
        session,
        run_id=run_id,
        verdict_out=last_verdict,
        memo=last_memo,
        all_objections=all_objections,
        open_findings=open_findings,
        exhaustion_memo=exhaustion_memo,
        iteration=iteration,
    )

    # Update run phase/status
    label = last_verdict.label
    confidence = last_verdict.confidence_score
    _update_run(
        session,
        run=run,
        label=label,
        confidence=confidence,
        iteration=iteration,
        exhausted=(decision.exit == RouterExit.exhausted),
    )

    # Audit ledger entry
    _append_council_ledger(
        session,
        run_id=run_id,
        requested_by=payload.requested_by,
        label=label,
        action_tier=last_verdict.action_tier,
        confidence=confidence,
        iteration=iteration,
        exhausted=(decision.exit == RouterExit.exhausted),
        finding_count=len(all_findings),
        open_finding_count=len(open_findings),
        metric_count=len(metric_results),
    )

    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))
    session.commit()
    session.refresh(verdict_record)

    return CouncilDeliberationRead(
        run_id=run_id,
        verdict=verdict_record,
        finding_count=len(all_findings),
        open_finding_count=len(open_findings),
        metric_result_count=len(metric_results),
        failed_metric_count=sum(
            1 for m in metric_results
            if m.status in {"failed", "error"} or m.passed is False
        ),
        pending_metric_count=sum(
            1 for m in metric_results
            if m.status in {"pending", "skipped"}
        ),
        highest_severity=_highest_severity(open_findings),
        created_verdict=True,
    )


def get_existing_deliberation(session: Session, *, run_id: UUID) -> CouncilDeliberationRead:
    """Reconstruct a CouncilDeliberationRead for a run that already has a Verdict.

    Used when resuming an interrupted run: ``deliberate()`` raises
    ResourceConflictError if a Verdict exists (a run can only ever have one),
    so resume must fetch the existing council outcome instead of treating
    that as a failure to retry.
    """
    get_run_or_raise(session, run_id)
    verdict = session.exec(select(Verdict).where(Verdict.run_id == run_id)).one()
    findings = _list_open_findings(session, run_id)
    all_findings = list(
        session.exec(select(Finding).where(Finding.run_id == run_id)).all()
    )
    metric_results = _list_metric_results(session, run_id)
    return CouncilDeliberationRead(
        run_id=run_id,
        verdict=verdict,
        finding_count=len(all_findings),
        open_finding_count=len(findings),
        metric_result_count=len(metric_results),
        failed_metric_count=sum(
            1 for m in metric_results
            if m.status in {"failed", "error"} or m.passed is False
        ),
        pending_metric_count=sum(
            1 for m in metric_results
            if m.status in {"pending", "skipped"}
        ),
        highest_severity=_highest_severity(findings),
        created_verdict=False,
    )


# ---------------------------------------------------------------------------
# Remediation helpers
# ---------------------------------------------------------------------------


def _resolve_re_plan_target(
    session: Session, *, run_id: UUID, upheld_objections: list[Objection]
) -> tuple[str | None, str | None]:
    """Pick a dormant specialist to activate for re_plan.

    Unlike re_probe (re-sample a dimension an agent already covered this
    run), re_plan is meant for a dimension NO agent has covered yet — so this
    only returns an agent that hasn't already produced a completed execution
    this run. Matches an upheld objection's argument/suggested_fix text
    against the registered probe dimensions (same keyword-matching style each
    specialist already uses for its own metric_ids). Returns
    ``(agent_name, matched_dimension)``, or ``(None, None)`` if no upheld
    objection names a dimension that's both real and not already covered.
    """
    already_run = {
        execution.agent_name
        for execution in session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .where(AgentExecution.status == AgentExecutionStatus.completed)
        ).all()
    }
    for objection in upheld_objections:
        haystack = f"{objection.argument} {objection.suggested_fix}".lower()
        for dimension, agent_name in DIMENSION_TO_AGENT_NAME.items():
            if dimension in haystack and agent_name not in already_run:
                return agent_name, dimension
    return None, None


def _apply_remediation(
    session: Session,
    *,
    run_id: UUID,
    remediation_type: str,
    target_agent: str | None,
    objections: list[Objection],
    objections_upheld: list[str],
) -> tuple[list[Finding], list[MetricResult]]:
    """Apply the remediation action and return refreshed evidence.

    re_deliberate: no new evidence needed — same findings, new synthesis next iteration.
    re_probe:      re-run the named specialist (more samples on a dimension
                   already covered) so it appends a new finding.
    re_plan:       activate a DIFFERENT, previously-dormant specialist for a
                   dimension an upheld objection names but nothing has probed
                   yet this run — see _resolve_re_plan_target.
    """
    matched_dimension: str | None = None
    if remediation_type == "re_plan":
        upheld = [o for o in objections if o.objection_id in objections_upheld]
        target_agent, matched_dimension = _resolve_re_plan_target(
            session, run_id=run_id, upheld_objections=upheld
        )
        if target_agent is None:
            logger.info(
                "re_plan: no upheld objection named an uncovered dimension "
                "for run %s; no-op this iteration",
                run_id,
            )

    if remediation_type in ("re_probe", "re_plan") and target_agent:
        logger.info(
            "%s: re-running specialist agent '%s' with a capped probe budget (%d)",
            remediation_type,
            target_agent,
            RE_PROBE_BUDGET_CAP,
        )
        # deliberate() is mid-capture (start_log_capture() was called once, at
        # the top, into a contextvar-backed buffer). run_agents() does its own
        # start/drain capture cycle: start_log_capture() replaces the buffer
        # with a brand-new list, and drain_log_capture() sets the buffer back
        # to None once it has written that agent run's entries to LLMCallLog.
        # Left alone, every LLM call deliberate() makes AFTER this point
        # (remaining synthesis/DA/verdict passes) would silently vanish —
        # _append_log() no-ops when the buffer is None. Save the parent
        # buffer's reference first, then rebind it once the nested call
        # returns (success or failure) so subsequent calls keep landing in
        # the same per-run audit capture.
        parent_log_buffer = get_log_buffer()
        try:
            from app.schemas.governance import AgentRunCreate
            from app.services.specialist_agents.agent_execution import run_agents

            run_agents(
                session,
                run_id=run_id,
                payload=AgentRunCreate(agent_names=[target_agent]),
                probe_budget_override=RE_PROBE_BUDGET_CAP,
                is_remediation_call=True,
            )
            if remediation_type == "re_plan":
                # Record which dimension triggered activating this previously
                # -dormant specialist — without this, "why did this run
                # suddenly activate compliance_mapper mid-council" is only
                # reconstructable from the state entry's raw objection text.
                audit_ledger.append_ledger_entry(
                    session,
                    run_id=run_id,
                    payload=AuditLedgerEntryCreate(
                        event_type="remediation.re_plan_activated",
                        actor_type=LedgerActorType.system,
                        actor_id="deliberation_council",
                        payload={
                            "target_agent": target_agent,
                            "matched_dimension": matched_dimension,
                        },
                    ),
                )
        except Exception as exc:
            logger.error(
                "%s of '%s' failed: %s — continuing with existing evidence",
                remediation_type,
                target_agent,
                exc,
            )
            # A silently-wasted remediation iteration (e.g. a hallucinated
            # target_agent that select_agents rejects) previously left only
            # a log line — nothing in the audit trail explained why a
            # council iteration burned its budget with no new evidence.
            try:
                audit_ledger.append_ledger_entry(
                    session,
                    run_id=run_id,
                    payload=AuditLedgerEntryCreate(
                        event_type=f"remediation.{remediation_type}_failed",
                        actor_type=LedgerActorType.system,
                        actor_id="deliberation_council",
                        payload={
                            "target_agent": target_agent,
                            "error_type": exc.__class__.__name__,
                            "message": str(exc),
                        },
                    ),
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Could not ledger-record %s failure for run %s", remediation_type, run_id
                )
        finally:
            bind_log_capture(parent_log_buffer)

    # Refresh findings from DB (new findings appended by re_probe will appear)
    updated_findings = _list_open_findings(session, run_id)
    updated_metrics = _list_metric_results(session, run_id)
    return updated_findings, updated_metrics


# ---------------------------------------------------------------------------
# Iteration counter persistence (uses existing result_summary JSON column)
# ---------------------------------------------------------------------------

_COUNTER_KEY = "_council_iteration_count"


def _read_iteration_counter(run) -> int:
    summary = run.result_summary or {}
    return int(summary.get(_COUNTER_KEY, 0))


def _persist_iteration_counter(session: Session, run, iteration: int) -> None:
    run.result_summary = {
        **(run.result_summary or {}),
        _COUNTER_KEY: iteration,
    }
    run.updated_at = utc_now()
    session.add(run)
    session.flush()


# ---------------------------------------------------------------------------
# Append-only audit state per iteration
# ---------------------------------------------------------------------------


def _append_council_iteration_state(
    session: Session,
    *,
    run_id: UUID,
    iteration: int,
    memo: SynthesisMemo,
    objections: list[Objection],
    verdict: VerdictOutput,
) -> None:
    """Write one GovernanceState entry per Council iteration.

    Each entry carries an iteration index and is appended, never overwritten,
    satisfying the append-only integrity rule from Section 5 of the spec.
    """
    governance_state.append_state_entry(
        session,
        run_id=run_id,
        payload=GovernanceStateEntryCreate(
            entry_type="council_iteration",
            source="deliberation_council",
            phase=RunPhase.deliberation_council,
            payload={
                "iteration": iteration,
                "synthesis": {
                    "narrative": memo.narrative,
                    "risk_summary": memo.risk_summary,
                    "dimensions": memo.dimensions,
                    "sample_sizes": memo.sample_sizes,
                    "conflicts": memo.conflicts,
                },
                "objections": [
                    {
                        "objection_id": o.objection_id,
                        "target_agent": o.target_agent,
                        "category": o.category,
                        "argument": o.argument,
                        "suggested_fix": o.suggested_fix,
                        "remediation_hint": o.remediation_hint,
                    }
                    for o in objections
                ],
                "verdict": {
                    "confidence_score": verdict.confidence_score,
                    "sufficient": verdict.sufficient,
                    "label": verdict.label,
                    "action_tier": str(verdict.action_tier),
                    "reasoning": verdict.reasoning,
                    "remediation_type": verdict.remediation_type,
                    "target_agent": verdict.target_agent,
                    "objections_addressed": verdict.objections_addressed,
                    "objections_upheld": verdict.objections_upheld,
                    "iteration_penalty": verdict.iteration_penalty,
                },
            },
        ),
    )


# ---------------------------------------------------------------------------
# Verdict persistence
# ---------------------------------------------------------------------------


def _persist_verdict(
    session: Session,
    *,
    run_id: UUID,
    verdict_out: VerdictOutput,
    memo: SynthesisMemo,
    all_objections: list[Objection],
    open_findings: list[Finding],
    exhaustion_memo: dict | None,
    iteration: int,
) -> Verdict:
    objections_payload = [
        {
            "objection_id": o.objection_id,
            "target_agent": o.target_agent,
            "category": o.category,
            "argument": o.argument,
            "suggested_fix": o.suggested_fix,
            "remediation_hint": o.remediation_hint,
        }
        for o in all_objections
    ]

    # When loop is exhausted, force human_review regardless of what the
    # last verdict said so the action tier correctly reflects uncertainty.
    action_tier = verdict_out.action_tier
    if exhaustion_memo is not None:
        action_tier = ActionTier.human_review

    required_actions: list[dict] = []
    if exhaustion_memo is not None:
        required_actions = [
            {
                "action": exhaustion_memo["recommended_human_action"],
                "severity": "high",
                "owner": "human_reviewer",
                "context": "loop_exhaustion",
            }
        ]
    else:
        # Surface each open finding's recommended remediation as a required
        # action so conditional approvals carry an explicit action list. This
        # is deterministic — derived from the findings, not the governance
        # LLM's verdict text — so the action list is stable across runs.
        required_actions = [
            {
                "action": finding.recommended_action,
                "severity": str(finding.severity),
                "owner": "system_owner",
                "context": "open_finding",
                "finding_id": str(finding.id),
            }
            for finding in open_findings
            if finding.recommended_action
        ]

    verdict = Verdict(
        run_id=run_id,
        confidence_score=verdict_out.confidence_score,
        action_tier=action_tier,
        label=verdict_out.label if exhaustion_memo is None else "blocked",
        synthesis=memo.narrative,
        objections=objections_payload,
        reasoning=verdict_out.reasoning,
        required_actions=required_actions,
    )

    # Embed exhaustion memo and iteration metadata in the verdict's reasoning
    # (the schema has no dedicated columns, so we pack them into reasoning text)
    extra_context = f"\n\n[Council iterations: {iteration}"
    if verdict_out.iteration_penalty > 0:
        extra_context += f" | iteration_penalty applied: {verdict_out.iteration_penalty:.3f}"
    if exhaustion_memo:
        extra_context += (
            f" | LOOP EXHAUSTION: {exhaustion_memo['distinction']}"
        )
    extra_context += "]"
    verdict.reasoning = (verdict.reasoning or "") + extra_context

    session.add(verdict)
    session.flush()
    return verdict


# ---------------------------------------------------------------------------
# Run state update
# ---------------------------------------------------------------------------


def _update_run(
    session: Session,
    *,
    run,
    label: str,
    confidence: float,
    iteration: int,
    exhausted: bool,
) -> None:
    run.status = RunStatus.council_running
    run.current_phase = RunPhase.deliberation_council
    run.result_summary = {
        **(run.result_summary or {}),
        "council_label": label if not exhausted else "blocked",
        "council_confidence_score": confidence,
        "council_deliberated_at": utc_now().isoformat(),
        "council_iterations": iteration,
        "council_exhausted": exhausted,
    }
    run.updated_at = utc_now()
    session.add(run)


# ---------------------------------------------------------------------------
# Audit ledger
# ---------------------------------------------------------------------------


def _append_council_ledger(
    session: Session,
    *,
    run_id: UUID,
    requested_by: str | None,
    label: str,
    action_tier,
    confidence: float,
    iteration: int,
    exhausted: bool,
    finding_count: int,
    open_finding_count: int,
    metric_count: int,
) -> None:
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type="council_deliberation.completed",
            actor_type=LedgerActorType.system,
            actor_id="deliberation_council",
            payload={
                "requested_by": requested_by,
                "label": label if not exhausted else "blocked",
                "action_tier": str(action_tier),
                "confidence_score": confidence,
                "iterations": iteration,
                "exhausted": exhausted,
                "finding_count": finding_count,
                "open_finding_count": open_finding_count,
                "metric_count": metric_count,
            },
        ),
    )


# ---------------------------------------------------------------------------
# DB queries
# ---------------------------------------------------------------------------


def _list_open_findings(session: Session, run_id: UUID) -> list[Finding]:
    return list(
        session.exec(
            select(Finding).where(
                Finding.run_id == run_id,
                Finding.status == FindingStatus.open,
            )
        ).all()
    )


def _list_all_findings(session: Session, run_id: UUID) -> list[Finding]:
    return list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())


def _list_metric_results(session: Session, run_id: UUID) -> list[MetricResult]:
    return list(session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all())


def _get_real_probe_counts(session: Session, run_id: UUID) -> dict[str, int]:
    """Sum each agent's real probe_count across every execution recorded for it.

    Grounds the Synthesis Agent's sample_sizes in actual telemetry
    (AgentExecution.metadata_json['probe_count'], set by agent_execution.py)
    instead of leaving the LLM to infer sample size from finding text alone —
    which it cannot do reliably, since an agent typically writes one finding
    regardless of how many probes it actually sent. Summed across executions
    so a mid-council re_probe remediation's extra probes count toward the
    total evidence gathered, not just the original pass.
    """
    executions = session.exec(
        select(AgentExecution).where(AgentExecution.run_id == run_id)
    ).all()
    counts: dict[str, int] = {}
    for execution in executions:
        probe_count = (execution.metadata_json or {}).get("probe_count", 0)
        counts[execution.agent_name] = counts.get(execution.agent_name, 0) + int(probe_count or 0)
    return counts


def _latest_findings_per_agent(findings: list[Finding]) -> list[Finding]:
    """Latest-iteration read rule: for synthesis, the most recently created
    finding per agent is authoritative; all are retained in the DB for audit."""
    seen: dict[str, Finding] = {}
    for f in sorted(findings, key=lambda x: x.created_at or utc_now()):
        key = f.agent_name or "_unknown"
        seen[key] = f
    return list(seen.values())


def _highest_severity(findings: list[Finding]):
    from app.models.enums import Severity
    _ORDER = {
        Severity.info: 0,
        Severity.low: 1,
        Severity.medium: 2,
        Severity.high: 3,
        Severity.critical: 4,
    }
    if not findings:
        return None
    return max((f.severity for f in findings), key=lambda s: _ORDER.get(s, 0))


# ---------------------------------------------------------------------------
# Model client construction
# ---------------------------------------------------------------------------


def _get_governance_client():
    """Return the configured governance model client.

    Falls back to the mock client when the registry is unavailable
    (e.g. no API key configured) so the pipeline always produces a verdict.
    """
    try:
        return get_governance_model_client()
    except Exception as exc:
        logger.warning(
            "Could not obtain live governance client (%s); falling back to mock", exc
        )
        return MockGovernanceModelClient(
            provider="mock",
            deployment_name="mock-governance",
        )
