from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceNotFoundError
from app.models.enums import MetricResultStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.schemas.governance import EvidenceRecordCreate, MetricResultCreate
from app.services.run_validation import (
    get_run_or_raise,
    validate_capability_for_run,
    validate_evidence_ids_for_run,
)


def create_evidence_record(
    session: Session,
    *,
    run_id: UUID,
    payload: EvidenceRecordCreate,
) -> EvidenceRecord:
    run = get_run_or_raise(session, run_id)
    validate_capability_for_run(
        session,
        run=run,
        capability_id=payload.ai_system_capability_id,
    )

    evidence = EvidenceRecord(run_id=run_id, **payload.model_dump())
    session.add(evidence)
    session.commit()
    session.refresh(evidence)
    return evidence


def list_evidence_records(
    session: Session,
    *,
    run_id: UUID,
    offset: int,
    limit: int,
    source_type: str | None = None,
    source_name: str | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[EvidenceRecord]:
    run = get_run_or_raise(session, run_id)
    validate_capability_for_run(
        session,
        run=run,
        capability_id=ai_system_capability_id,
    )

    statement = select(EvidenceRecord).where(EvidenceRecord.run_id == run_id)
    if source_type is not None:
        statement = statement.where(EvidenceRecord.source_type == source_type)
    if source_name is not None:
        statement = statement.where(EvidenceRecord.source_name == source_name)
    if ai_system_capability_id is not None:
        statement = statement.where(
            EvidenceRecord.ai_system_capability_id == ai_system_capability_id
        )
    statement = statement.order_by(EvidenceRecord.created_at.desc()).offset(offset).limit(limit)
    return list(session.exec(statement).all())


def get_evidence_record(
    session: Session,
    *,
    run_id: UUID,
    evidence_id: UUID,
) -> EvidenceRecord:
    get_run_or_raise(session, run_id)
    evidence = session.get(EvidenceRecord, evidence_id)
    if evidence is None or evidence.run_id != run_id:
        raise ResourceNotFoundError("Evidence record", str(evidence_id))
    return evidence


def create_metric_result(
    session: Session,
    *,
    run_id: UUID,
    payload: MetricResultCreate,
) -> MetricResult:
    run = get_run_or_raise(session, run_id)
    validate_capability_for_run(
        session,
        run=run,
        capability_id=payload.ai_system_capability_id,
    )
    validate_evidence_ids_for_run(
        session,
        run_id=run_id,
        evidence_ids=payload.evidence_ids,
    )

    metric_result = MetricResult(run_id=run_id, **payload.model_dump())
    session.add(metric_result)
    session.commit()
    session.refresh(metric_result)
    return metric_result


def list_metric_results(
    session: Session,
    *,
    run_id: UUID,
    offset: int,
    limit: int,
    metric_id: str | None = None,
    status: MetricResultStatus | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[MetricResult]:
    run = get_run_or_raise(session, run_id)
    validate_capability_for_run(
        session,
        run=run,
        capability_id=ai_system_capability_id,
    )

    statement = select(MetricResult).where(MetricResult.run_id == run_id)
    if metric_id is not None:
        statement = statement.where(MetricResult.metric_id == metric_id)
    if status is not None:
        statement = statement.where(MetricResult.status == status)
    if ai_system_capability_id is not None:
        statement = statement.where(
            MetricResult.ai_system_capability_id == ai_system_capability_id
        )
    statement = statement.order_by(MetricResult.created_at.desc()).offset(offset).limit(limit)
    return list(session.exec(statement).all())


def get_metric_result(
    session: Session,
    *,
    run_id: UUID,
    metric_result_id: UUID,
) -> MetricResult:
    get_run_or_raise(session, run_id)
    metric_result = session.get(MetricResult, metric_result_id)
    if metric_result is None or metric_result.run_id != run_id:
        raise ResourceNotFoundError("Metric result", str(metric_result_id))
    return metric_result
