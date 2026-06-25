"""Adaptive orchestrator / evaluation planner (Layer 2, tasks P014-P015).

Builds a deterministic evaluation plan from the run's metric plan, the system's
risk tier, and the Layer 1 coverage gaps: it activates the responsible agents,
allocates a probe budget that sums to 100, sets per-agent priorities and
instructions, elevates coverage gaps to priority targets, and records a risk
rationale.

The plan is persisted append-only as an ``evaluation_plan_prepared``
GovernanceState entry (source ``adaptive_orchestrator``, phase
``adaptive_orchestrator``) plus an ``evaluation_plan.prepared`` audit-ledger
entry, and the run transitions to status ``planned``. The full plan lives in the
state-entry payload so it is reconstructable from state alone.
"""

from collections import defaultdict
from uuid import UUID

from sqlmodel import Session, desc, select

from app.core.exceptions import ResourceNotFoundError
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.models.state import GovernanceStateEntry
from app.schemas.governance import (
    AgentPlanItem,
    AuditLedgerEntryCreate,
    CoverageGapRead,
    EvaluationPlanCreate,
    EvaluationPlanRead,
    GovernanceStateEntryCreate,
    MetricPlanItem,
    PriorityTarget,
)
from app.services import audit_ledger, context_assembly, governance_state
from app.services.specialist_agents import metric_plans
from app.services.adaptive_orchestrator.base import (
    ADAPTIVE_ORCHESTRATOR_ACTOR_ID,
    ADAPTIVE_ORCHESTRATOR_SOURCE,
    EVALUATION_PLAN_ENTRY_TYPE,
    EVALUATION_PLAN_EVENT_TYPE,
    METRIC_WEIGHT,
    PROBE_BUDGET_TOTAL,
    RISK_TIER_BONUS,
    SEVERITY_WEIGHT,
    priority_from_severity,
)
from app.services.adaptive_orchestrator.budget import allocate_probe_budget
from app.services.run_validation import get_run_or_raise


def prepare_evaluation_plan(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationPlanCreate,
) -> EvaluationPlanRead:
    plan = build_evaluation_plan(session, run_id=run_id)

    state_payload = _plan_state_payload(plan, payload=payload)
    state_entry = governance_state.append_state_entry(
        session,
        run_id=run_id,
        payload=GovernanceStateEntryCreate(
            entry_type=EVALUATION_PLAN_ENTRY_TYPE,
            source=ADAPTIVE_ORCHESTRATOR_SOURCE,
            phase=RunPhase.adaptive_orchestrator,
            payload=state_payload,
        ),
    )
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type=EVALUATION_PLAN_EVENT_TYPE,
            actor_type=LedgerActorType.system,
            actor_id=ADAPTIVE_ORCHESTRATOR_ACTOR_ID,
            payload={"phase": RunPhase.adaptive_orchestrator, **plan.counts},
        ),
    )

    run = get_run_or_raise(session, run_id)
    run.status = RunStatus.planned
    run.current_phase = RunPhase.adaptive_orchestrator
    run.started_at = run.started_at or plan.generated_at
    run.result_summary = {**(run.result_summary or {}), "evaluation_plan": plan.counts}
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    plan.state_sequence_number = state_entry.sequence_number
    plan.state_entry_hash = state_entry.entry_hash
    return plan


def build_evaluation_plan(session: Session, *, run_id: UUID) -> EvaluationPlanRead:
    run = get_run_or_raise(session, run_id)
    ai_system = session.get(AISystem, run.ai_system_id)
    risk_tier = str(ai_system.risk_tier) if ai_system is not None else "medium"

    metric_plan = metric_plans.build_metric_plan(session, run_id=run_id)
    coverage_gaps = _load_coverage_gaps(session, run_id=run_id)

    agent_metrics: dict[str, list[MetricPlanItem]] = defaultdict(list)
    control_agents: dict[str, set[str]] = defaultdict(set)
    for metric in metric_plan.metrics:
        if metric.primary_agent:
            agent_metrics[metric.primary_agent].append(metric)
        for control in metric.controls:
            for agent_name in control.agent_names:
                control_agents[control.control_ref].add(agent_name)

    activated = sorted(agent_metrics)
    agent_dimensions = {
        agent_name: {metric.dimension for metric in metrics}
        for agent_name, metrics in agent_metrics.items()
    }
    agent_gaps = _assign_gaps_to_agents(
        coverage_gaps=coverage_gaps,
        activated=activated,
        agent_dimensions=agent_dimensions,
        control_agents=control_agents,
    )

    risk_bonus = RISK_TIER_BONUS.get(risk_tier, 1)
    weights = {
        agent_name: (
            METRIC_WEIGHT * len(agent_metrics[agent_name])
            + sum(SEVERITY_WEIGHT[gap.severity] for gap in agent_gaps[agent_name])
            + risk_bonus
        )
        for agent_name in activated
    }
    budget = allocate_probe_budget(weights, total=PROBE_BUDGET_TOTAL) if activated else {}

    agent_items = [
        _build_agent_item(
            agent_name=agent_name,
            metrics=agent_metrics[agent_name],
            gaps=agent_gaps[agent_name],
            probe_budget=budget.get(agent_name, 0),
            weight=weights[agent_name],
            risk_tier=risk_tier,
        )
        for agent_name in activated
    ]
    priority_targets = _build_priority_targets(coverage_gaps)
    allocated = sum(budget.values())
    counts = {
        "activated_agents": len(activated),
        "metrics_planned": metric_plan.metric_count,
        "coverage_gaps_considered": len(coverage_gaps),
        "priority_targets": len(priority_targets),
        "probe_budget_allocated": allocated,
    }

    return EvaluationPlanRead(
        run_id=run.id,
        ai_system_id=run.ai_system_id,
        state_sequence_number=0,
        state_entry_hash="",
        generated_at=utc_now(),
        risk_tier=risk_tier,
        selected_frameworks=run.selected_frameworks,
        metric_count=metric_plan.metric_count,
        coverage_gap_count=len(coverage_gaps),
        probe_budget_total=PROBE_BUDGET_TOTAL,
        probe_budget_allocated=allocated,
        activated_agents=agent_items,
        priority_targets=priority_targets,
        risk_rationale=_risk_rationale(
            risk_tier=risk_tier,
            activated=activated,
            metric_count=metric_plan.metric_count,
            coverage_gaps=coverage_gaps,
            allocated=allocated,
        ),
        counts=counts,
    )


def get_latest_plan(session: Session, *, run_id: UUID) -> EvaluationPlanRead:
    get_run_or_raise(session, run_id)
    entry = session.exec(
        select(GovernanceStateEntry)
        .where(GovernanceStateEntry.run_id == run_id)
        .where(GovernanceStateEntry.entry_type == EVALUATION_PLAN_ENTRY_TYPE)
        .order_by(desc(GovernanceStateEntry.sequence_number))
        .limit(1)
    ).first()
    if entry is None:
        raise ResourceNotFoundError("Evaluation plan", str(run_id))

    return EvaluationPlanRead(
        **{
            **entry.payload,
            "state_sequence_number": entry.sequence_number,
            "state_entry_hash": entry.entry_hash,
        }
    )


def _load_coverage_gaps(session: Session, *, run_id: UUID) -> list[CoverageGapRead]:
    try:
        context = context_assembly.get_latest_context(session, run_id=run_id)
    except ResourceNotFoundError:
        return []
    return context.coverage_gaps


def _assign_gaps_to_agents(
    *,
    coverage_gaps: list[CoverageGapRead],
    activated: list[str],
    agent_dimensions: dict[str, set[str]],
    control_agents: dict[str, set[str]],
) -> dict[str, list[CoverageGapRead]]:
    agent_gaps: dict[str, list[CoverageGapRead]] = defaultdict(list)
    for gap in coverage_gaps:
        matched = [
            agent_name
            for agent_name in activated
            if gap.dimension in agent_dimensions[agent_name]
        ]
        if not matched and gap.control_refs:
            ref_agents: set[str] = set()
            for control_ref in gap.control_refs:
                ref_agents |= control_agents.get(control_ref, set())
            matched = [agent_name for agent_name in activated if agent_name in ref_agents]
        for agent_name in matched:
            agent_gaps[agent_name].append(gap)
    return agent_gaps


def _build_agent_item(
    *,
    agent_name: str,
    metrics: list[MetricPlanItem],
    gaps: list[CoverageGapRead],
    probe_budget: int,
    weight: float,
    risk_tier: str,
) -> AgentPlanItem:
    dimensions = sorted(
        {metric.dimension for metric in metrics} | {gap.dimension for gap in gaps}
    )
    controls = sorted(
        {control.control_ref for metric in metrics for control in metric.controls}
    )
    metric_ids = sorted({metric.metric_id for metric in metrics})
    gap_ids = sorted(gap.gap_id for gap in gaps)
    priority = _agent_priority(gaps, risk_tier)

    instructions = (
        f"Run {agent_name} probes for dimension(s) {', '.join(dimensions) or 'n/a'}. "
        f"Use {probe_budget} of {PROBE_BUDGET_TOTAL} probes. "
        f"Evaluate metric(s) {', '.join(metric_ids) or 'n/a'} against configured "
        f"thresholds."
    )
    if gap_ids:
        instructions += f" Prioritize {len(gap_ids)} coverage gap(s): {', '.join(gap_ids)}."

    rationale = (
        f"Activated for {len(metrics)} assigned metric(s) and {len(gaps)} coverage "
        f"gap(s); weight {weight:g} mapped to {probe_budget} probe(s)."
    )

    return AgentPlanItem(
        agent_name=agent_name,
        priority=priority,
        probe_budget=probe_budget,
        assigned_metric_ids=metric_ids,
        target_dimensions=dimensions,
        target_controls=controls,
        coverage_gap_ids=gap_ids,
        instructions=instructions,
        rationale=rationale,
    )


def _agent_priority(gaps: list[CoverageGapRead], risk_tier: str) -> str:
    if gaps:
        highest = max(gaps, key=lambda gap: SEVERITY_WEIGHT[gap.severity]).severity
        return priority_from_severity(highest)
    return "high" if risk_tier == "high" else "medium"


def _build_priority_targets(coverage_gaps: list[CoverageGapRead]) -> list[PriorityTarget]:
    by_dimension: dict[str, list[CoverageGapRead]] = defaultdict(list)
    for gap in coverage_gaps:
        by_dimension[gap.dimension].append(gap)

    targets: list[PriorityTarget] = []
    for dimension, gaps in by_dimension.items():
        severity = max(gaps, key=lambda gap: SEVERITY_WEIGHT[gap.severity]).severity
        control_refs = sorted({ref for gap in gaps for ref in gap.control_refs})
        gap_ids = sorted(gap.gap_id for gap in gaps)
        targets.append(
            PriorityTarget(
                dimension=dimension,
                severity=severity,
                reason=f"{len(gaps)} coverage gap(s) affecting {dimension}.",
                control_refs=control_refs,
                gap_ids=gap_ids,
            )
        )
    targets.sort(key=lambda target: (-SEVERITY_WEIGHT[target.severity], target.dimension))
    return targets


def _risk_rationale(
    *,
    risk_tier: str,
    activated: list[str],
    metric_count: int,
    coverage_gaps: list[CoverageGapRead],
    allocated: int,
) -> str:
    rationale = (
        f"Risk tier '{risk_tier}': activated {len(activated)} agent(s) across "
        f"{metric_count} planned metric(s) and {len(coverage_gaps)} coverage gap(s); "
        f"allocated {allocated} of {PROBE_BUDGET_TOTAL} probes."
    )
    if coverage_gaps:
        highest = max(coverage_gaps, key=lambda gap: SEVERITY_WEIGHT[gap.severity]).severity
        rationale += f" Highest coverage-gap severity: {highest.value}."
    return rationale


def _plan_state_payload(
    plan: EvaluationPlanRead,
    *,
    payload: EvaluationPlanCreate,
) -> dict[str, object]:
    stored = plan.model_dump(mode="json")
    stored.pop("state_sequence_number", None)
    stored.pop("state_entry_hash", None)
    stored["requested_by"] = payload.requested_by
    stored["notes"] = payload.notes
    return stored
