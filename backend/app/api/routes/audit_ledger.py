from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.api.routes.auth import get_current_user
from app.core.exceptions import ApplicationError
from app.db.session import get_session
from app.models.enums import LedgerActorType
from app.schemas.governance import (
    AuditLedgerChainVerification,
    AuditLedgerEntryCreate,
    AuditLedgerEntryRead,
)
from app.services import audit_ledger as service
from app.services import content_integrity

router = APIRouter(prefix="/evaluation-runs/{run_id}/ledger")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "",
    response_model=AuditLedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
)
def append_ledger_entry(
    run_id: UUID,
    payload: AuditLedgerEntryCreate,
    session: SessionDependency,
    current_user: Annotated[object, Depends(get_current_user)] = None,
) -> AuditLedgerEntryRead:
    # This public route is for manual, human-attributed annotations only.
    # system/agent/tool-attributed entries are written exclusively by internal
    # pipeline code calling the audit_ledger service directly (never this HTTP
    # route) — allowing a caller to POST those actor_types here would let any
    # authenticated user forge an entry that looks like it came from the
    # pipeline itself, indistinguishable once hash-chained.
    if payload.actor_type != LedgerActorType.user:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Only user-attributed ledger entries may be created via this route.",
            details={"actor_type": str(payload.actor_type)},
        )
    # Who that user *is* comes from the authenticated identity, never the
    # request body — otherwise anyone could write an entry claiming to be a
    # different approver/user.
    if current_user is not None:
        payload = payload.model_copy(update={"actor_id": current_user.email})
    return service.append_ledger_entry(session, run_id=run_id, payload=payload)


@router.get("", response_model=list[AuditLedgerEntryRead])
def list_ledger_entries(
    run_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    event_type: str | None = None,
    actor_type: LedgerActorType | None = None,
) -> list[AuditLedgerEntryRead]:
    return service.list_ledger_entries(
        session,
        run_id=run_id,
        offset=offset,
        limit=limit,
        event_type=event_type,
        actor_type=actor_type,
    )


@router.get("/verify", response_model=AuditLedgerChainVerification)
def verify_ledger_chain(
    run_id: UUID,
    session: SessionDependency,
) -> AuditLedgerChainVerification:
    chain_result = service.verify_ledger_chain(session, run_id=run_id)
    content_result = content_integrity.verify_content_integrity(session, run_id=run_id)
    return AuditLedgerChainVerification(
        **chain_result,
        content_valid=content_result["valid"],
        content_checks=content_result["checks"],
    )


@router.get("/{entry_id}", response_model=AuditLedgerEntryRead)
def get_ledger_entry(
    run_id: UUID,
    entry_id: UUID,
    session: SessionDependency,
) -> AuditLedgerEntryRead:
    return service.get_ledger_entry(session, run_id=run_id, entry_id=entry_id)
