"""Context assembly entrypoint (Layer 1, tasks P011-P015).

Runs the deterministic log analyzer, regulatory ingester, and coverage-gap
detector, then persists the assembled context append-only:

1. a ``context_assembled`` GovernanceState entry (hash-chained, reconstructable),
2. a ``context_assembly.completed`` audit-ledger entry, and
3. an in-order run transition to the ``context_assembly`` phase/status.

The assembled context is stored entirely inside the state entry payload, so a run
can be reconstructed from state alone (no process-local memory), satisfying the
append-only and recovery invariants in the spec.
"""

from uuid import UUID

from sqlmodel import Session, desc, select

from app.core.exceptions import ApplicationError, ResourceNotFoundError
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.state import GovernanceStateEntry
from app.schemas.governance import (
    AuditLedgerEntryCreate,
    ContextAssemblyCreate,
    ContextAssemblyRead,
    CoverageGapRead,
    GovernanceStateEntryCreate,
    LogAnalysisSummary,
    RegulatoryContextRead,
)
from app.services import audit_ledger, governance_state
from app.services.context_assembly.base import (
    CONTEXT_ASSEMBLED_ENTRY_TYPE,
    CONTEXT_ASSEMBLY_ACTOR_ID,
    CONTEXT_ASSEMBLY_EVENT_TYPE,
    CONTEXT_ASSEMBLY_SOURCE,
)
from app.services.context_assembly.coverage_gap_detector import (
    detect_coverage_gaps,
    highest_gap_severity,
)
from app.services.context_assembly.log_analyzer import analyze_logs
from app.services.context_assembly.regulatory_ingester import ingest_regulations
from app.services.run_validation import get_run_or_raise

TERMINAL_RUN_STATUSES = {
    RunStatus.completed,
    RunStatus.failed,
    RunStatus.cancelled,
}


def assemble_context(
    session: Session,
    *,
    run_id: UUID,
    payload: ContextAssemblyCreate,
) -> ContextAssemblyRead:
    run = get_run_or_raise(session, run_id)
    _ensure_can_assemble(run)

    log_analysis = analyze_logs(payload.logs)
    regulatory_context = ingest_regulations(
        session,
        selected_frameworks=run.selected_frameworks,
    )
    coverage_gaps = detect_coverage_gaps(
        log_analysis=log_analysis,
        regulatory_context=regulatory_context,
    )
    highest = highest_gap_severity(coverage_gaps)
    generated_at = utc_now()
    counts = _build_counts(
        log_analysis=log_analysis,
        regulatory_context=regulatory_context,
        coverage_gaps=coverage_gaps,
    )

    state_payload = _state_payload(
        log_analysis=log_analysis,
        regulatory_context=regulatory_context,
        coverage_gaps=coverage_gaps,
        highest=highest,
        counts=counts,
        generated_at=generated_at,
        requested_by=payload.requested_by,
        notes=payload.notes,
    )
    state_entry = governance_state.append_state_entry(
        session,
        run_id=run_id,
        payload=GovernanceStateEntryCreate(
            entry_type=CONTEXT_ASSEMBLED_ENTRY_TYPE,
            source=CONTEXT_ASSEMBLY_SOURCE,
            phase=RunPhase.context_assembly,
            payload=state_payload,
        ),
    )
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type=CONTEXT_ASSEMBLY_EVENT_TYPE,
            actor_type=LedgerActorType.system,
            actor_id=CONTEXT_ASSEMBLY_ACTOR_ID,
            payload={"phase": RunPhase.context_assembly, **counts},
        ),
    )

    run.status = RunStatus.context_assembly
    run.current_phase = RunPhase.context_assembly
    run.started_at = run.started_at or generated_at
    run.result_summary = {**(run.result_summary or {}), "context_assembly": counts}
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    return ContextAssemblyRead(
        run_id=run_id,
        state_sequence_number=state_entry.sequence_number,
        state_entry_hash=state_entry.entry_hash,
        generated_at=generated_at,
        log_analysis=log_analysis,
        regulatory_context=regulatory_context,
        coverage_gaps=coverage_gaps,
        gap_count=len(coverage_gaps),
        highest_gap_severity=highest,
        counts=counts,
        notes=payload.notes,
    )


def get_latest_context(session: Session, *, run_id: UUID) -> ContextAssemblyRead:
    get_run_or_raise(session, run_id)
    entry = session.exec(
        select(GovernanceStateEntry)
        .where(GovernanceStateEntry.run_id == run_id)
        .where(GovernanceStateEntry.entry_type == CONTEXT_ASSEMBLED_ENTRY_TYPE)
        .order_by(desc(GovernanceStateEntry.sequence_number))
        .limit(1)
    ).first()
    if entry is None:
        raise ResourceNotFoundError("Context assembly", str(run_id))

    payload = entry.payload
    return ContextAssemblyRead(
        run_id=run_id,
        state_sequence_number=entry.sequence_number,
        state_entry_hash=entry.entry_hash,
        generated_at=payload["generated_at"],
        log_analysis=LogAnalysisSummary(**payload["log_analysis"]),
        regulatory_context=RegulatoryContextRead(**payload["regulatory_context"]),
        coverage_gaps=[CoverageGapRead(**gap) for gap in payload.get("coverage_gaps", [])],
        gap_count=payload.get("gap_count", 0),
        highest_gap_severity=payload.get("highest_gap_severity"),
        counts=payload.get("counts", {}),
        notes=payload.get("notes"),
    )


def _ensure_can_assemble(run: EvaluationRun) -> None:
    if run.status in TERMINAL_RUN_STATUSES:
        raise ApplicationError(
            status_code=409,
            code="INVALID_RUN_TRANSITION",
            message="Context cannot be assembled for a run in a terminal state.",
            details={
                "run_id": str(run.id),
                "current_status": run.status,
            },
        )


def _build_counts(
    *,
    log_analysis: LogAnalysisSummary,
    regulatory_context: RegulatoryContextRead,
    coverage_gaps: list[CoverageGapRead],
) -> dict[str, int]:
    return {
        "log_requests": log_analysis.total_requests,
        "frameworks_resolved": len(regulatory_context.resolved_frameworks),
        "frameworks_missing": len(regulatory_context.missing_frameworks),
        "regulatory_controls": regulatory_context.control_count,
        "probe_templates": sum(
            len(framework.probe_templates) for framework in regulatory_context.frameworks
        ),
        "coverage_gaps": len(coverage_gaps),
    }


def _state_payload(
    *,
    log_analysis: LogAnalysisSummary,
    regulatory_context: RegulatoryContextRead,
    coverage_gaps: list[CoverageGapRead],
    highest,
    counts: dict[str, int],
    generated_at,
    requested_by: str | None,
    notes: str | None,
) -> dict[str, object]:
    return {
        "log_analysis": log_analysis.model_dump(mode="json"),
        "regulatory_context": regulatory_context.model_dump(mode="json"),
        "coverage_gaps": [gap.model_dump(mode="json") for gap in coverage_gaps],
        "gap_count": len(coverage_gaps),
        "highest_gap_severity": highest.value if highest is not None else None,
        "counts": counts,
        "generated_at": generated_at.isoformat(),
        "requested_by": requested_by,
        "notes": notes,
    }
