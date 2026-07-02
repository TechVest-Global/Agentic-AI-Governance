from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError, ResourceConflictError, ResourceNotFoundError
from app.models.ai_system import (
    AISystem,
    AISystemCapability,
    ApplicationContextProfile,
    RetrievalContextDocument,
)
from app.models.base import utc_now
from app.models.enums import AISystemStatus
from app.schemas.governance import (
    AISystemCapabilityCreate,
    AISystemCreate,
    AISystemUpdate,
    ApplicationContextProfileCreate,
    RetrievalContextDocumentCreate,
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


def ingest_context_document(
    session: Session,
    system_id: UUID,
    *,
    title: str | None,
    content: str,
    source_filename: str | None = None,
    tags: list[str] | None = None,
) -> RetrievalContextDocument:
    """Store uploaded/pasted context as a retrieval-context document.

    Backs the "upload file/context" flow. Derives a title from the filename
    when none is given and rejects empty content with a clear validation error.
    """
    text = (content or "").strip()
    if not text:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Uploaded context is empty — provide a non-empty file or text.",
        )
    resolved_title = (title or "").strip() or (source_filename or "").strip() or "Uploaded context"
    document = RetrievalContextDocument(
        ai_system_id=system_id,
        title=resolved_title[:300],
        content=text,
        source_uri=source_filename,
        tags=tags or [],
    )
    get_ai_system(session, system_id)
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def create_retrieval_context_document(
    session: Session,
    system_id: UUID,
    payload: RetrievalContextDocumentCreate,
) -> RetrievalContextDocument:
    get_ai_system(session, system_id)
    document = RetrievalContextDocument(ai_system_id=system_id, **payload.model_dump())
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def list_retrieval_context_documents(
    session: Session,
    system_id: UUID,
    *,
    offset: int,
    limit: int,
) -> list[RetrievalContextDocument]:
    get_ai_system(session, system_id)
    statement = (
        select(RetrievalContextDocument)
        .where(RetrievalContextDocument.ai_system_id == system_id)
        .order_by(RetrievalContextDocument.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def delete_retrieval_context_document(
    session: Session,
    system_id: UUID,
    document_id: UUID,
) -> None:
    get_ai_system(session, system_id)
    statement = select(RetrievalContextDocument).where(
        RetrievalContextDocument.id == document_id,
        RetrievalContextDocument.ai_system_id == system_id,
    )
    document = session.exec(statement).one_or_none()
    if document is None:
        raise ResourceNotFoundError("Retrieval context document", str(document_id))
    session.delete(document)
    session.commit()
