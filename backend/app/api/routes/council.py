from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import CouncilDeliberationCreate, CouncilDeliberationRead
from app.services.deliberation_council import deliberation as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/council")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/deliberate",
    response_model=CouncilDeliberationRead,
    status_code=status.HTTP_201_CREATED,
)
def deliberate(
    run_id: UUID,
    payload: CouncilDeliberationCreate,
    session: SessionDependency,
) -> CouncilDeliberationRead:
    return service.deliberate(session, run_id=run_id, payload=payload)
