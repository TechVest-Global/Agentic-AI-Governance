"""Shared constants and helpers for the Layer 2 adaptive orchestrator."""

from app.models.enums import Severity

# GovernanceState / audit-ledger identifiers for evaluation-plan writes.
ADAPTIVE_ORCHESTRATOR_SOURCE = "adaptive_orchestrator"
EVALUATION_PLAN_ENTRY_TYPE = "evaluation_plan_prepared"
EVALUATION_PLAN_EVENT_TYPE = "evaluation_plan.prepared"
ADAPTIVE_ORCHESTRATOR_ACTOR_ID = "adaptive_orchestrator_service"

# Total probe budget allocated across activated agents (spec invariant: == 100).
PROBE_BUDGET_TOTAL = 100

# Weight contributed by one coverage gap of a given severity when sizing budgets.
SEVERITY_WEIGHT: dict[Severity, int] = {
    Severity.info: 1,
    Severity.low: 2,
    Severity.medium: 3,
    Severity.high: 5,
    Severity.critical: 8,
}

# Each assigned metric contributes this much baseline weight to its agent.
METRIC_WEIGHT = 2

# Extra weight per activated agent based on the system's risk tier.
RISK_TIER_BONUS: dict[str, int] = {"low": 0, "medium": 1, "high": 2}


def priority_from_severity(severity: Severity) -> str:
    if severity in (Severity.high, Severity.critical):
        return "high"
    if severity == Severity.medium:
        return "medium"
    return "low"
