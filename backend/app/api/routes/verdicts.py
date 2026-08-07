from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.api.routes.auth import get_current_user
from app.core.exceptions import ApplicationError
from app.db.session import get_session
from app.schemas.governance import VerdictCreate, VerdictOverrideCreate, VerdictRead
from app.services import verdicts as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/verdict")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=VerdictRead, status_code=status.HTTP_201_CREATED)
def create_verdict(
    run_id: UUID,
    payload: VerdictCreate,
    session: SessionDependency,
    current_user: Annotated[object, Depends(get_current_user)] = None,
) -> VerdictRead:
    """Record a verdict by hand for a run that has reached the council.

    The council writes its own verdict internally and never comes through this
    route, so anything arriving here is a human decision and is attributed to
    the authenticated caller in the ledger. Attribution is mandatory rather than
    best-effort: an unattributable verdict is exactly the artefact this route
    must not be able to produce.
    """
    if current_user is None:
        raise ApplicationError(
            status_code=401,
            code="UNAUTHORIZED",
            message="Recording a verdict requires an authenticated identity.",
        )
    return service.create_verdict(
        session, run_id=run_id, payload=payload, created_by=current_user.email
    )


@router.get("", response_model=VerdictRead)
def get_verdict(
    run_id: UUID,
    session: SessionDependency,
) -> VerdictRead:
    return service.get_verdict(session, run_id=run_id)


@router.post("/override", response_model=VerdictRead)
def override_verdict(
    run_id: UUID,
    payload: VerdictOverrideCreate,
    session: SessionDependency,
    current_user: Annotated[object, Depends(get_current_user)] = None,
) -> VerdictRead:
    overridden_by = current_user.name if current_user is not None else None
    return service.override_verdict(
        session, run_id=run_id, payload=payload, overridden_by=overridden_by
    )
