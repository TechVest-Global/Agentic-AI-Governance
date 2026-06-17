from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceNotFoundError
from app.models.enums import FindingStatus, Severity
from app.models.finding import Finding
from app.schemas.governance import FindingCreate
from app.services.run_validation import (
    get_run_or_raise,
    validate_capability_for_run,
    validate_evidence_ids_for_run,
)


def create_finding(
    session: Session,
    *,
    run_id: UUID,
    payload: FindingCreate,
) -> Finding:
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

    finding = Finding(run_id=run_id, **payload.model_dump())
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return finding


def list_findings(
    session: Session,
    *,
    run_id: UUID,
    offset: int,
    limit: int,
    severity: Severity | None = None,
    status: FindingStatus | None = None,
    agent_name: str | None = None,
    dimension: str | None = None,
    ai_system_capability_id: UUID | None = None,
) -> list[Finding]:
    run = get_run_or_raise(session, run_id)
    validate_capability_for_run(
        session,
        run=run,
        capability_id=ai_system_capability_id,
    )

    statement = select(Finding).where(Finding.run_id == run_id)
    if severity is not None:
        statement = statement.where(Finding.severity == severity)
    if status is not None:
        statement = statement.where(Finding.status == status)
    if agent_name is not None:
        statement = statement.where(Finding.agent_name == agent_name)
    if dimension is not None:
        statement = statement.where(Finding.dimension == dimension)
    if ai_system_capability_id is not None:
        statement = statement.where(
            Finding.ai_system_capability_id == ai_system_capability_id
        )
    statement = statement.order_by(Finding.created_at.desc()).offset(offset).limit(limit)
    return list(session.exec(statement).all())


def get_finding(
    session: Session,
    *,
    run_id: UUID,
    finding_id: UUID,
) -> Finding:
    get_run_or_raise(session, run_id)
    finding = session.get(Finding, finding_id)
    if finding is None or finding.run_id != run_id:
        raise ResourceNotFoundError("Finding", str(finding_id))
    return finding
