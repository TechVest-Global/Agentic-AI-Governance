from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import VerdictCreate, VerdictRead
from app.services import verdicts as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/verdict")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=VerdictRead, status_code=status.HTTP_201_CREATED)
def create_verdict(
    run_id: UUID,
    payload: VerdictCreate,
    session: SessionDependency,
) -> VerdictRead:
    return service.create_verdict(session, run_id=run_id, payload=payload)


@router.get("", response_model=VerdictRead)
def get_verdict(
    run_id: UUID,
    session: SessionDependency,
) -> VerdictRead:
    return service.get_verdict(session, run_id=run_id)
