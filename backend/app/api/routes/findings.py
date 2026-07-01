from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
from app.models.enums import FindingStatus, Severity
from app.schemas.governance import FindingCreate, FindingRead
from app.services import findings as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/findings")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=FindingRead, status_code=status.HTTP_201_CREATED)
def create_finding(
    run_id: UUID,
    payload: FindingCreate,
    session: SessionDependency,
) -> FindingRead:
    return service.create_finding(session, run_id=run_id, payload=payload)


@router.get("", response_model=list[FindingRead])
def list_findings(
    run_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    severity: Severity | None = None,
    status: FindingStatus | None = None,
    agent_name: str | None = None,
    dimension: str | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[FindingRead]:
    return service.list_findings(
        session,
        run_id=run_id,
        offset=offset,
        limit=limit,
        severity=severity,
        status=status,
        agent_name=agent_name,
        dimension=dimension,
        ai_system_capability_id=ai_system_capability_id,
    )


@router.get("/{finding_id}", response_model=FindingRead)
def get_finding(
    run_id: UUID,
    finding_id: UUID,
    session: SessionDependency,
) -> FindingRead:
    return service.get_finding(session, run_id=run_id, finding_id=finding_id)
