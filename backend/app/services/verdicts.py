from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceConflictError, ResourceNotFoundError
from app.models.base import utc_now
from app.models.enums import LedgerActorType
from app.models.verdict import Verdict
from app.schemas.governance import AuditLedgerEntryCreate, VerdictCreate, VerdictOverrideCreate
from app.services import audit_ledger
from app.services.run_validation import get_run_or_raise


def create_verdict(
    session: Session,
    *,
    run_id: UUID,
    payload: VerdictCreate,
) -> Verdict:
    get_run_or_raise(session, run_id)

    existing_verdict = session.exec(
        select(Verdict).where(Verdict.run_id == run_id)
    ).first()
    if existing_verdict is not None:
        raise ResourceConflictError("Verdict", "run_id", str(run_id))

    verdict = Verdict(run_id=run_id, **payload.model_dump())
    session.add(verdict)
    session.commit()
    session.refresh(verdict)
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
