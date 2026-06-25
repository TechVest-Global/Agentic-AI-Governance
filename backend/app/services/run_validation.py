from uuid import UUID

from sqlmodel import Session

from app.core.exceptions import ApplicationError, ResourceNotFoundError
from app.models.ai_system import AISystemCapability
from app.models.evaluation import EvaluationRun
from app.models.evidence import EvidenceRecord


def get_run_or_raise(session: Session, run_id: UUID) -> EvaluationRun:
    run = session.get(EvaluationRun, run_id)
    if run is None:
        raise ResourceNotFoundError("Evaluation run", str(run_id))
    return run


def validate_capability_for_run(
    session: Session,
    *,
    run: EvaluationRun,
    capability_id: UUID | None,
) -> None:
    if capability_id is None:
        return

    capability = session.get(AISystemCapability, capability_id)
    if capability is None or capability.ai_system_id != run.ai_system_id:
        raise ResourceNotFoundError("AI system capability", str(capability_id))


def validate_evidence_ids_for_run(
    session: Session,
    *,
    run_id: UUID,
    evidence_ids: list[str],
) -> None:
    for evidence_id in evidence_ids:
        try:
            evidence_uuid = UUID(evidence_id)
        except ValueError as exc:
            raise ApplicationError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Evidence ID must be a valid UUID.",
                details={"evidence_id": evidence_id},
            ) from exc

        evidence = session.get(EvidenceRecord, evidence_uuid)
        if evidence is None or evidence.run_id != run_id:
            raise ResourceNotFoundError("Evidence record", evidence_id)
