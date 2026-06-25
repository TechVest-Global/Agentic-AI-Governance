from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
from app.models.enums import MetricResultStatus
from app.schemas.governance import (
    EvidenceRecordCreate,
    EvidenceRecordRead,
    MetricResultCreate,
    MetricResultRead,
)
from app.services import evidence as service

router = APIRouter(prefix="/evaluation-runs/{run_id}")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/evidence",
    response_model=EvidenceRecordRead,
    status_code=status.HTTP_201_CREATED,
)
def create_evidence_record(
    run_id: UUID,
    payload: EvidenceRecordCreate,
    session: SessionDependency,
) -> EvidenceRecordRead:
    return service.create_evidence_record(session, run_id=run_id, payload=payload)


@router.get("/evidence", response_model=list[EvidenceRecordRead])
def list_evidence_records(
    run_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    source_type: str | None = None,
    source_name: str | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[EvidenceRecordRead]:
    return service.list_evidence_records(
        session,
        run_id=run_id,
        offset=offset,
        limit=limit,
        source_type=source_type,
        source_name=source_name,
        ai_system_capability_id=ai_system_capability_id,
    )


@router.get("/evidence/{evidence_id}", response_model=EvidenceRecordRead)
def get_evidence_record(
    run_id: UUID,
    evidence_id: UUID,
    session: SessionDependency,
) -> EvidenceRecordRead:
    return service.get_evidence_record(
        session,
        run_id=run_id,
        evidence_id=evidence_id,
    )


@router.post(
    "/metric-results",
    response_model=MetricResultRead,
    status_code=status.HTTP_201_CREATED,
)
def create_metric_result(
    run_id: UUID,
    payload: MetricResultCreate,
    session: SessionDependency,
) -> MetricResultRead:
    return service.create_metric_result(session, run_id=run_id, payload=payload)


@router.get("/metric-results", response_model=list[MetricResultRead])
def list_metric_results(
    run_id: UUID,
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    metric_id: str | None = None,
    status: MetricResultStatus | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[MetricResultRead]:
    return service.list_metric_results(
        session,
        run_id=run_id,
        offset=offset,
        limit=limit,
        metric_id=metric_id,
        status=status,
        ai_system_capability_id=ai_system_capability_id,
    )


@router.get("/metric-results/{metric_result_id}", response_model=MetricResultRead)
def get_metric_result(
    run_id: UUID,
    metric_result_id: UUID,
    session: SessionDependency,
) -> MetricResultRead:
    return service.get_metric_result(
        session,
        run_id=run_id,
        metric_result_id=metric_result_id,
    )
