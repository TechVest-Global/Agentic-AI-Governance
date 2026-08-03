from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError, ResourceConflictError, ResourceNotFoundError
from app.models.base import utc_now
from app.models.enums import LedgerActorType, RunPhase
from app.models.verdict import Verdict
from app.schemas.governance import AuditLedgerEntryCreate, VerdictCreate, VerdictOverrideCreate
from app.services import audit_ledger
from app.services.run_validation import get_run_or_raise

# The ledger event the council writes when it reaches a verdict of its own.
# Its presence is what distinguishes a council-produced verdict from one written
# through the public route — see council_produced_verdict below.
COUNCIL_VERDICT_EVENT = "council_deliberation.completed"

# A verdict is the artefact a governance report quotes and exports, so it may
# only be written manually once the run has actually reached the council. Before
# that there is no assessment for it to represent — and because a run can hold
# exactly one verdict, a row written earlier is not merely premature: it makes
# `deliberate()` raise ResourceConflictError, which the pipeline treats as "the
# council already decided" and adopts. A verdict planted on a `created` run
# therefore became the run's official council outcome.
_VERDICT_ELIGIBLE_PHASES = frozenset(
    {
        RunPhase.deliberation_council,
        RunPhase.action_reporting,
        RunPhase.completed,
    }
)


def council_produced_verdict(session: Session, *, run_id: UUID) -> bool:
    """Whether this run's verdict came from the Deliberation Council.

    The Verdict table has no provenance column, so the tamper-evident ledger is
    the source of truth: ``deliberate()`` writes COUNCIL_VERDICT_EVENT as part of
    reaching a verdict, and nothing else does.
    """
    from app.models.ledger import AuditLedgerEntry

    return (
        session.exec(
            select(AuditLedgerEntry.id)
            .where(AuditLedgerEntry.run_id == run_id)
            .where(AuditLedgerEntry.event_type == COUNCIL_VERDICT_EVENT)
        ).first()
        is not None
    )


def create_verdict(
    session: Session,
    *,
    run_id: UUID,
    payload: VerdictCreate,
    created_by: str | None = None,
) -> Verdict:
    """Record a manually-authored verdict for a run that has reached the council.

    The council does NOT come through here — it constructs its Verdict directly
    (see deliberation_council/deliberation.py) — so this path is only ever a
    human writing one by hand, and is gated and ledgered accordingly.
    """
    run = get_run_or_raise(session, run_id)

    if run.current_phase not in _VERDICT_ELIGIBLE_PHASES:
        raise ApplicationError(
            status_code=409,
            code="RUN_NOT_READY_FOR_VERDICT",
            message=(
                "A verdict can only be recorded once the run has reached the deliberation "
                "council. Run the pipeline (or the council) first."
            ),
            details={"run_id": str(run_id), "current_phase": str(run.current_phase)},
        )

    existing_verdict = session.exec(
        select(Verdict).where(Verdict.run_id == run_id)
    ).first()
    if existing_verdict is not None:
        raise ResourceConflictError("Verdict", "run_id", str(run_id))

    verdict = Verdict(run_id=run_id, **payload.model_dump())
    session.add(verdict)
    session.commit()
    session.refresh(verdict)

    # Without this the run's single most consequential artefact could appear
    # with nothing in the hash chain saying where it came from — the council
    # ledgers its own verdict, so a manual one must not get less audit rigor.
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type="verdict.recorded_manually",
            actor_type=LedgerActorType.user,
            actor_id=created_by,
            payload={
                "label": verdict.label,
                "action_tier": str(verdict.action_tier),
                "confidence_score": verdict.confidence_score,
                "note": (
                    "Recorded directly by a user, not produced by the Deliberation Council."
                ),
            },
        ),
    )
    return verdict


def get_verdict(
    session: Session,
    *,
    run_id: UUID,
) -> Verdict:
    get_run_or_raise(session, run_id)

    verdict = session.exec(select(Verdict).where(Verdict.run_id == run_id)).first()
    if verdict is None:
        raise ResourceNotFoundError("Verdict", str(run_id))
    return verdict


def override_verdict(
    session: Session,
    *,
    run_id: UUID,
    payload: VerdictOverrideCreate,
    overridden_by: str | None,
) -> Verdict:
    """Record a human's disagreement with a Verdict — capture only.

    The original verdict fields (confidence_score, label, action_tier, ...)
    are never mutated, so a report that already showed the original verdict
    stays immutable; the override is purely additional data a future
    calibration pass could compare against. Re-overriding replaces the
    previous override (there is one override slot per verdict, matching the
    one-verdict-per-run invariant) — this is intentionally not itself
    versioned, since the ledger entry below already gives each override its
    own permanent, ordered audit record.
    """
    verdict = get_verdict(session, run_id=run_id)

    verdict.human_override_label = payload.human_override_label
    verdict.human_override_reason = payload.human_override_reason
    verdict.overridden_by = overridden_by
    verdict.overridden_at = utc_now()
    session.add(verdict)
    session.commit()
    session.refresh(verdict)

    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type="verdict.overridden",
            actor_type=LedgerActorType.user,
            actor_id=overridden_by,
            payload={
                "original_label": verdict.label,
                "human_override_label": payload.human_override_label,
                "human_override_reason": payload.human_override_reason,
            },
        ),
    )

    return verdict
