from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import (
    AISystemCapabilityCreate,
    AISystemCapabilityRead,
    AISystemCreate,
    AISystemRead,
    AISystemUpdate,
    ApplicationContextProfileCreate,
    ApplicationContextProfileRead,
)
from app.services import ai_systems as service

router = APIRouter(prefix="/ai-systems")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=AISystemRead, status_code=status.HTTP_201_CREATED)
def create_ai_system(
    payload: AISystemCreate,
    session: SessionDependency,
) -> AISystemRead:
    return service.create_ai_system(session, payload)


@router.get("", response_model=list[AISystemRead])
def list_ai_systems(
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AISystemRead]:
    return service.list_ai_systems(session, offset=offset, limit=limit)


@router.get("/{system_id}", response_model=AISystemRead)
def get_ai_system(system_id: UUID, session: SessionDependency) -> AISystemRead:
    return service.get_ai_system(session, system_id)


@router.patch("/{system_id}", response_model=AISystemRead)
def update_ai_system(
    system_id: UUID,
    payload: AISystemUpdate,
    session: SessionDependency,
) -> AISystemRead:
    return service.update_ai_system(session, system_id, payload)


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ai_system(system_id: UUID, session: SessionDependency) -> None:
    service.archive_ai_system(session, system_id)


@router.post(
    "/{system_id}/capabilities",
    response_model=AISystemCapabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_capability(
    system_id: UUID,
    payload: AISystemCapabilityCreate,
    session: SessionDependency,
) -> AISystemCapabilityRead:
    return service.create_capability(session, system_id, payload)


@router.get(
    "/{system_id}/capabilities",
    response_model=list[AISystemCapabilityRead],
)
def list_capabilities(
    system_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    enabled: bool | None = None,
) -> list[AISystemCapabilityRead]:
    return service.list_capabilities(
        session,
        system_id,
        offset=offset,
        limit=limit,
        enabled=enabled,
    )


@router.get(
    "/{system_id}/capabilities/{capability_id}",
    response_model=AISystemCapabilityRead,
)
def get_capability(
    system_id: UUID,
    capability_id: UUID,
    session: SessionDependency,
) -> AISystemCapabilityRead:
    return service.get_capability(session, system_id, capability_id)


@router.get(
    "/{system_id}/context-profile",
    response_model=ApplicationContextProfileRead,
)
def get_context_profile(
    system_id: UUID,
    session: SessionDependency,
) -> ApplicationContextProfileRead:
    return service.get_context_profile(session, system_id)


@router.put(
    "/{system_id}/context-profile",
    response_model=ApplicationContextProfileRead,
)
def upsert_context_profile(
    system_id: UUID,
    payload: ApplicationContextProfileCreate,
    session: SessionDependency,
) -> ApplicationContextProfileRead:
    return service.upsert_context_profile(session, system_id, payload)
