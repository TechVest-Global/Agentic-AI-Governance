"""Shared constants for the Layer 1 context-assembly subsystem."""

from app.models.enums import Severity

# GovernanceState / audit-ledger identifiers for context-assembly writes.
CONTEXT_ASSEMBLY_SOURCE = "context_assembly"
CONTEXT_ASSEMBLED_ENTRY_TYPE = "context_assembled"
CONTEXT_ASSEMBLY_EVENT_TYPE = "context_assembly.completed"
CONTEXT_ASSEMBLY_ACTOR_ID = "context_assembly_service"

# Ranking used to prioritize coverage gaps and pick the highest severity.
SEVERITY_ORDER: dict[Severity, int] = {
    Severity.info: 0,
    Severity.low: 1,
    Severity.medium: 2,
    Severity.high: 3,
    Severity.critical: 4,
}


def coerce_severity(value: str) -> Severity:
    """Map a config severity string to a ``Severity``, defaulting to medium."""

    try:
        return Severity(value.strip().lower())
    except ValueError:
        return Severity.medium
