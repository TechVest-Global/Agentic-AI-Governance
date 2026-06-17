from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import AgentRunCreate, AgentRunRead
from app.services import agent_execution as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/agents")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/run", response_model=AgentRunRead, status_code=status.HTTP_201_CREATED)
def run_agents(
    run_id: UUID,
    payload: AgentRunCreate,
    session: SessionDependency,
) -> AgentRunRead:
    return service.run_agents(session, run_id=run_id, payload=payload)
