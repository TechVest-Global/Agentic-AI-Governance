from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceNotFoundError
from app.models.assessment_request import AssessmentRequest
from app.models.base import utc_now
from app.models.enums import AssessmentRequestStatus
from app.schemas.governance import AssessmentRequestCreate, AssessmentRequestStatusUpdate
from app.services.ai_systems import get_ai_system


def create_assessment_request(
    session: Session,
    *,
    ai_system_id: UUID,
    payload: AssessmentRequestCreate,
    requested_by_name: str,
    requested_by_email: str,
    requested_by_role: str,
) -> AssessmentRequest:
    get_ai_system(session, ai_system_id)  # 404s if the system doesn't exist
    request = AssessmentRequest(
        ai_system_id=ai_system_id,
        requested_by_name=requested_by_name,
        requested_by_email=requested_by_email,
        requested_by_role=requested_by_role,
        **payload.model_dump(),
    )
    session.add(request)
    session.commit()
    session.refresh(request)
    return request


def list_assessment_requests(session: Session, *, ai_system_id: UUID) -> list[AssessmentRequest]:
    statement = (
        select(AssessmentRequest)
        .where(AssessmentRequest.ai_system_id == ai_system_id)
        .order_by(AssessmentRequest.created_at.desc())
    )
    return list(session.exec(statement).all())


def list_all_assessment_requests(
    session: Session,
    *,
    statuses: list[AssessmentRequestStatus] | None = None,
    limit: int = 100,
) -> list[AssessmentRequest]:
    """Cross-system inbox feed — the developer-side "requests" surface and its
    notification badge both read from this rather than looping per system."""
    statement = select(AssessmentRequest)
    if statuses:
        statement = statement.where(AssessmentRequest.status.in_(statuses))
    statement = statement.order_by(AssessmentRequest.created_at.desc()).limit(limit)
    return list(session.exec(statement).all())


def update_assessment_request_status(
    session: Session,
    *,
    request_id: UUID,
    payload: AssessmentRequestStatusUpdate,
) -> AssessmentRequest:
    request = session.get(AssessmentRequest, request_id)
    if request is None:
        raise ResourceNotFoundError("Assessment request", str(request_id))
    request.status = payload.status
    if payload.resolved_run_id is not None:
        request.resolved_run_id = payload.resolved_run_id
    if payload.status in (AssessmentRequestStatus.resolved, AssessmentRequestStatus.dismissed):
        request.resolved_at = utc_now()
    request.updated_at = utc_now()
    session.add(request)
    session.commit()
    session.refresh(request)
    return request
