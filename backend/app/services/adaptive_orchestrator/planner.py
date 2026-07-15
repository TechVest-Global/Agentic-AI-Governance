"""Adaptive orchestrator / evaluation planner (Layer 2, tasks P014-P015).

Builds a deterministic evaluation plan from the run's metric plan, the system's
risk tier, and the Layer 1 coverage gaps: it activates the responsible agents,
allocates a probe budget that sums to 100, sets per-agent priorities and
instructions, elevates coverage gaps to priority targets, and records a risk
rationale.

Selection is two-stage: the DETERMINISTIC pass (metric applicability filters on
capability types/modality/frameworks) decides the candidate set, then an LLM
REVIEW pass evaluates that set against the target system's context and may drop
metrics that are clearly unsuitable. The LLM can only narrow the deterministic
set, never widen it, and the review (or its unavailability) is recorded in the
plan payload for audit. Dropped metric ids are persisted to
``run.selected_metrics`` so the metric-execution layer honors the refinement.

The plan is persisted append-only as an ``evaluation_plan_prepared``
GovernanceState entry (source ``adaptive_orchestrator``, phase
``adaptive_orchestrator``) plus an ``evaluation_plan.prepared`` audit-ledger
entry, and the run transitions to status ``planned``. The full plan lives in the
state-entry payload so it is reconstructable from state alone.
"""

import json
import logging
from collections import defaultdict
from uuid import UUID

from sqlmodel import Session, desc, select

from app.core.exceptions import ResourceNotFoundError
from app.models.ai_system import AISystem
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.models.llm_call_log import LLMCallLog
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
from app.services.model_clients.gateway import drain_log_capture, start_log_capture
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents import metric_plans

logger = logging.getLogger(__name__)

# The LLM review may only narrow the deterministic metric set. If it tries to
# drop more than this fraction, the review is treated as unreliable and ignored
# (the deterministic set stands).
_MAX_LLM_DROP_FRACTION = 0.5


def prepare_evaluation_plan(
    session: Session,
    *,
    run_id: UUID,
    payload: EvaluationPlanCreate,
) -> EvaluationPlanRead:
    # Stage 1 (deterministic): applicability-filtered metric plan -> agent
    # activation + budgets. Stage 2 (LLM): review the deterministic selection
    # against the target system's context; persists any accepted refinement to
    # run.selected_metrics BEFORE the final plan is built so the plan, metric
    # execution, and agent activation all see the same refined set.
    start_log_capture()
    llm_review = _apply_llm_plan_review(session, run_id=run_id)
    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))

    plan = build_evaluation_plan(session, run_id=run_id)
    plan.llm_review = llm_review

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


_PLAN_REVIEW_PROMPT = """\
You are the audit-planning reviewer of an AI governance platform.

A deterministic planner selected candidate metrics for auditing this system:

Target system: {system_name}
  type: {system_type} | risk tier: {risk_tier} | modality: {modality}
  description: {description}
  capability types: {capability_types}
  context: {context_summary}

Candidate metrics (id | name | dimension):
{metric_lines}

Evaluate whether each metric is suitable for THIS system. Drop ONLY metrics
that are clearly unsuitable for the system's type, modality, or usage context
(e.g. retrieval-grounding metrics for a system with no retrieval, agentic
tool-use metrics for a plain chat assistant). When in doubt, keep the metric.

Return ONLY a valid JSON object, no markdown, in this exact shape:
{{"drop": [{{"metric_id": "CM-000", "reason": "..."}}], "rationale": "one-paragraph summary"}}
"""


def _apply_llm_plan_review(session: Session, *, run_id: UUID) -> dict | None:
    """LLM pass over the deterministic metric selection (stage 2 of planning).

    Asks the governance model which candidate metrics are unsuitable for the
    target system and persists accepted drops to ``run.selected_metrics``
    (narrowing only — the deterministic set is the ceiling). Returns the audit
    record of the review, or None when no usable review happened. Never raises:
    planning must succeed even with no LLM available.
    """
    from app.core.config import get_settings

    if not get_settings().adaptive_plan_review_enabled:
        # Review disabled — evaluate the full applicable catalog, no narrowing.
        return {"reviewed": False, "reason": "adaptive plan review disabled by settings"}

    run = get_run_or_raise(session, run_id)
    if run.selected_metrics:
        # The caller explicitly picked metrics — nothing to review/refine.
        return {
            "reviewed": False,
            "reason": "explicit metric selection supplied by caller",
        }

    metric_plan = metric_plans.build_metric_plan(session, run_id=run_id)
    if not metric_plan.metrics:
        return {"reviewed": False, "reason": "no candidate metrics to review"}

    ai_system = session.get(AISystem, run.ai_system_id)
    try:
        from app.services.model_clients.base import GovernanceModelRequest
        from app.services.model_clients.registry import get_governance_model_client

        client = get_governance_model_client()
        metric_lines = "\n".join(
            f"  {m.metric_id} | {m.name} | {m.dimension}" for m in metric_plan.metrics
        )
        response = client.complete(
            GovernanceModelRequest(
                task="evaluation_plan_review",
                prompt=_PLAN_REVIEW_PROMPT.format(
                    system_name=ai_system.name if ai_system else "unknown",
                    system_type=getattr(ai_system, "system_type", "unknown"),
                    risk_tier=getattr(ai_system, "risk_tier", "unknown"),
                    modality=getattr(ai_system, "modality", "unknown"),
                    description=(getattr(ai_system, "description", None) or "n/a")[:400],
                    capability_types=", ".join(
                        sorted(_capability_types(session, run.ai_system_id))
                    )
                    or "none declared",
                    context_summary=_context_summary(session, run.ai_system_id),
                    metric_lines=metric_lines,
                ),
                context={"metric_count": metric_plan.metric_count},
            )
        )
        review = _parse_plan_review(response.content)
    except Exception as exc:  # noqa: BLE001 — review is best-effort by design
        logger.warning("LLM plan review unavailable (%s); keeping deterministic plan", exc)
        return {"reviewed": False, "reason": f"governance model unavailable: {exc}"}

    if review is None:
        return {"reviewed": False, "reason": "governance model returned unusable response"}

    candidate_ids = {m.metric_id for m in metric_plan.metrics}
    drops = [
        d
        for d in review.get("drop", [])
        if isinstance(d, dict) and d.get("metric_id") in candidate_ids
    ]
    audit: dict = {
        "reviewed": True,
        "candidate_count": len(candidate_ids),
        "dropped": drops,
        "rationale": str(review.get("rationale", "")),
    }
    if not drops:
        return audit

    if len(drops) > len(candidate_ids) * _MAX_LLM_DROP_FRACTION:
        audit["applied"] = False
        audit["ignored_reason"] = (
            f"review dropped {len(drops)}/{len(candidate_ids)} metrics — over the "
            f"{_MAX_LLM_DROP_FRACTION:.0%} safety cap, deterministic set kept"
        )
        logger.warning("LLM plan review ignored: %s", audit["ignored_reason"])
        return audit

    dropped_ids = {str(d["metric_id"]) for d in drops}
    kept = sorted(candidate_ids - dropped_ids)
    run.selected_metrics = kept
    run.updated_at = utc_now()
    session.add(run)
    session.flush()
    audit["applied"] = True
    audit["kept_metric_ids"] = kept
    logger.info(
        "LLM plan review dropped %d/%d metrics for run %s: %s",
        len(dropped_ids),
        len(candidate_ids),
        run_id,
        sorted(dropped_ids),
    )
    return audit


def _parse_plan_review(content: str) -> dict | None:
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end == 0:
            return None
        parsed = json.loads(content[start:end])
        return parsed if isinstance(parsed, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


def _capability_types(session: Session, ai_system_id: UUID) -> set[str]:
    from app.models.ai_system import AISystemCapability

    return {
        str(value)
        for value in session.exec(
            select(AISystemCapability.capability_type).where(
                AISystemCapability.ai_system_id == ai_system_id,
                AISystemCapability.enabled == True,  # noqa: E712
            )
        ).all()
    }


def _context_summary(session: Session, ai_system_id: UUID) -> str:
    from app.models.ai_system import ApplicationContextProfile

    profile = session.exec(
        select(ApplicationContextProfile).where(
            ApplicationContextProfile.ai_system_id == ai_system_id
        )
    ).one_or_none()
    if profile is None:
        return "no context profile registered"
    identity = profile.identity_purpose or {}
    parts = [
        str(identity.get(key, ""))
        for key in ("type", "purpose", "intended_use")
        if identity.get(key)
    ]
    summary = " ".join(parts).strip()
    return summary[:600] or "context profile present but empty"


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
