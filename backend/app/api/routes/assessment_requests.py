from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.api.routes.auth import get_current_user
from app.core.exceptions import ApplicationError
from app.db.session import get_session
from app.models.enums import AssessmentRequestStatus
from app.schemas.governance import (
    AssessmentRequestCreate,
    AssessmentRequestRead,
    AssessmentRequestStatusUpdate,
)
from app.services import assessment_requests as service

router = APIRouter()
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/assessment-requests", response_model=list[AssessmentRequestRead])
def list_all_assessment_requests(
    session: SessionDependency,
    status: Annotated[list[AssessmentRequestStatus] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[AssessmentRequestRead]:
    return service.list_all_assessment_requests(session, statuses=status, limit=limit)


@router.post(
    "/ai-systems/{ai_system_id}/assessment-requests",
    response_model=AssessmentRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_assessment_request(
    ai_system_id: UUID,
    payload: AssessmentRequestCreate,
    session: SessionDependency,
    current_user: Annotated[object, Depends(get_current_user)] = None,
) -> AssessmentRequestRead:
    # Who asked comes from the authenticated token, never the request body —
    # same rule as ledger writes and plan approval (app.api.routes.auth.get_current_user).
    # No fallback identity here (unlike approve-plan): a request with no
    # verifiable requester isn't meaningful, and the auth middleware already
    # guarantees a token on this POST, so current_user is None only if that
    # middleware was bypassed.
    if current_user is None:
        raise ApplicationError(
            status_code=401, code="UNAUTHORIZED", message="Authentication required."
        )
    return service.create_assessment_request(
        session,
        ai_system_id=ai_system_id,
        payload=payload,
        requested_by_name=current_user.name,
        requested_by_email=current_user.email,
        requested_by_role=current_user.role,
    )


@router.get(
    "/ai-systems/{ai_system_id}/assessment-requests",
    response_model=list[AssessmentRequestRead],
)
def list_assessment_requests(
    ai_system_id: UUID,
    session: SessionDependency,
) -> list[AssessmentRequestRead]:
    return service.list_assessment_requests(session, ai_system_id=ai_system_id)


@router.patch(
    "/assessment-requests/{request_id}",
    response_model=AssessmentRequestRead,
)
def update_assessment_request_status(
    request_id: UUID,
    payload: AssessmentRequestStatusUpdate,
    session: SessionDependency,
) -> AssessmentRequestRead:
    return service.update_assessment_request_status(session, request_id=request_id, payload=payload)
