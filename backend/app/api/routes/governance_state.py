from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import (
    GovernanceStateChainVerification,
    GovernanceStateEntryCreate,
    GovernanceStateEntryRead,
)
from app.services import governance_state as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/state")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "",
    response_model=GovernanceStateEntryRead,
    status_code=status.HTTP_201_CREATED,
)
def append_state_entry(
    run_id: UUID,
    payload: GovernanceStateEntryCreate,
    session: SessionDependency,
) -> GovernanceStateEntryRead:
    return service.append_state_entry(session, run_id=run_id, payload=payload)


@router.get("", response_model=list[GovernanceStateEntryRead])
def list_state_entries(
    run_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    phase: str | None = None,
    source: str | None = None,
) -> list[GovernanceStateEntryRead]:
    return service.list_state_entries(
        session,
        run_id=run_id,
        offset=offset,
        limit=limit,
        phase=phase,
        source=source,
    )


@router.get("/verify", response_model=GovernanceStateChainVerification)
def verify_state_chain(
    run_id: UUID,
    session: SessionDependency,
) -> GovernanceStateChainVerification:
    return service.verify_state_chain(session, run_id=run_id)
