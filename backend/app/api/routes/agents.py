from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import AgentExecutionRead, AgentRunCreate, AgentRunRead
from app.services.specialist_agents import agent_execution as service

router = APIRouter(prefix="/evaluation-runs/{run_id}/agents")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/run", response_model=AgentRunRead, status_code=status.HTTP_201_CREATED)
def run_agents(
    run_id: UUID,
    payload: AgentRunCreate,
    session: SessionDependency,
) -> AgentRunRead:
    return service.run_agents(session, run_id=run_id, payload=payload)


@router.get("/executions", response_model=list[AgentExecutionRead])
def list_agent_executions(
    run_id: UUID,
    session: SessionDependency,
) -> list[AgentExecutionRead]:
    return service.list_agent_executions(session, run_id=run_id)
