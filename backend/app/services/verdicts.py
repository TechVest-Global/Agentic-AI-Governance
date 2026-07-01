from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceConflictError, ResourceNotFoundError
from app.models.verdict import Verdict
from app.schemas.governance import VerdictCreate
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
