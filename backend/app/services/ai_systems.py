from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceConflictError, ResourceNotFoundError
from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.base import utc_now
from app.models.enums import AISystemStatus
from app.schemas.governance import (
    AISystemCapabilityCreate,
    AISystemCreate,
    AISystemUpdate,
    ApplicationContextProfileCreate,
)


def create_ai_system(session: Session, payload: AISystemCreate) -> AISystem:
    system = AISystem(**payload.model_dump())
    session.add(system)
    session.commit()
    session.refresh(system)
    return system


def list_ai_systems(session: Session, *, offset: int, limit: int) -> list[AISystem]:
    statement = (
        select(AISystem)
        .where(AISystem.status != AISystemStatus.archived)
        .order_by(AISystem.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def get_ai_system(session: Session, system_id: UUID) -> AISystem:
    system = session.get(AISystem, system_id)
    if system is None:
        raise ResourceNotFoundError("AI system", str(system_id))
    return system


def update_ai_system(
    session: Session,
    system_id: UUID,
    payload: AISystemUpdate,
) -> AISystem:
    system = get_ai_system(session, system_id)
    values = payload.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(system, field, value)
    system.updated_at = utc_now()
    session.add(system)
    session.commit()
    session.refresh(system)
    return system


def archive_ai_system(session: Session, system_id: UUID) -> None:
    system = get_ai_system(session, system_id)
    system.status = AISystemStatus.archived
    system.updated_at = utc_now()
    session.add(system)
    session.commit()


def create_capability(
    session: Session,
    system_id: UUID,
    payload: AISystemCapabilityCreate,
) -> AISystemCapability:
    get_ai_system(session, system_id)
    duplicate_statement = select(AISystemCapability).where(
        AISystemCapability.ai_system_id == system_id,
        AISystemCapability.name == payload.name,
    )
    if session.exec(duplicate_statement).first() is not None:
        raise ResourceConflictError("AI system capability", "name", payload.name)

    capability = AISystemCapability(ai_system_id=system_id, **payload.model_dump())
    session.add(capability)
    session.commit()
    session.refresh(capability)
    return capability


def list_capabilities(
    session: Session,
    system_id: UUID,
    *,
    offset: int,
    limit: int,
    enabled: bool | None = None,
) -> list[AISystemCapability]:
    get_ai_system(session, system_id)
    statement = select(AISystemCapability).where(
        AISystemCapability.ai_system_id == system_id
    )
    if enabled is not None:
        statement = statement.where(AISystemCapability.enabled == enabled)
    statement = (
        statement.order_by(AISystemCapability.created_at.asc()).offset(offset).limit(limit)
    )
    return list(session.exec(statement).all())


def get_capability(
    session: Session,
    system_id: UUID,
    capability_id: UUID,
) -> AISystemCapability:
    get_ai_system(session, system_id)
    statement = select(AISystemCapability).where(
        AISystemCapability.id == capability_id,
        AISystemCapability.ai_system_id == system_id,
    )
    capability = session.exec(statement).one_or_none()
    if capability is None:
        raise ResourceNotFoundError("AI system capability", str(capability_id))
    return capability


def get_context_profile(session: Session, system_id: UUID) -> ApplicationContextProfile:
    get_ai_system(session, system_id)
    statement = select(ApplicationContextProfile).where(
        ApplicationContextProfile.ai_system_id == system_id
    )
    profile = session.exec(statement).one_or_none()
    if profile is None:
        raise ResourceNotFoundError("Application context profile", str(system_id))
    return profile


def upsert_context_profile(
    session: Session,
    system_id: UUID,
    payload: ApplicationContextProfileCreate,
) -> ApplicationContextProfile:
    get_ai_system(session, system_id)
    statement = select(ApplicationContextProfile).where(
        ApplicationContextProfile.ai_system_id == system_id
    )
    profile = session.exec(statement).one_or_none()
    values = payload.model_dump()

    if profile is None:
        profile = ApplicationContextProfile(ai_system_id=system_id, **values)
    else:
        for field, value in values.items():
            setattr(profile, field, value)
        profile.updated_at = utc_now()

    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile
