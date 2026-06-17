import hashlib
import json
from uuid import UUID

from sqlmodel import Session, desc, select

from app.core.exceptions import ResourceNotFoundError
from app.models.evaluation import EvaluationRun
from app.models.state import GovernanceStateEntry
from app.schemas.governance import GovernanceStateEntryCreate


def _canonical_json(value: dict[str, object]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _calculate_entry_hash(
    *,
    run_id: UUID,
    sequence_number: int,
    entry_type: str,
    source: str,
    phase: str,
    payload: dict[str, object],
    previous_hash: str | None,
) -> str:
    material = {
        "run_id": str(run_id),
        "sequence_number": sequence_number,
        "entry_type": entry_type,
        "source": source,
        "phase": phase,
        "payload": payload,
        "previous_hash": previous_hash,
    }
    return hashlib.sha256(_canonical_json(material).encode("utf-8")).hexdigest()


def append_state_entry(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernanceStateEntryCreate,
) -> GovernanceStateEntry:
    if session.get(EvaluationRun, run_id) is None:
        raise ResourceNotFoundError("Evaluation run", str(run_id))

    previous_entry = get_latest_state_entry(session, run_id=run_id)
    next_sequence = 1 if previous_entry is None else previous_entry.sequence_number + 1
    previous_hash = None if previous_entry is None else previous_entry.entry_hash
    entry_hash = _calculate_entry_hash(
        run_id=run_id,
        sequence_number=next_sequence,
        entry_type=payload.entry_type,
        source=payload.source,
        phase=payload.phase,
        payload=payload.payload,
        previous_hash=previous_hash,
    )

    entry = GovernanceStateEntry(
        run_id=run_id,
        sequence_number=next_sequence,
        entry_type=payload.entry_type,
        source=payload.source,
        phase=payload.phase,
        payload=payload.payload,
        previous_hash=previous_hash,
        entry_hash=entry_hash,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def list_state_entries(
    session: Session,
    *,
    run_id: UUID,
    offset: int,
    limit: int,
    phase: str | None = None,
    source: str | None = None,
) -> list[GovernanceStateEntry]:
    if session.get(EvaluationRun, run_id) is None:
        raise ResourceNotFoundError("Evaluation run", str(run_id))

    statement = select(GovernanceStateEntry).where(GovernanceStateEntry.run_id == run_id)
    if phase is not None:
        statement = statement.where(GovernanceStateEntry.phase == phase)
    if source is not None:
        statement = statement.where(GovernanceStateEntry.source == source)
    statement = (
        statement.order_by(GovernanceStateEntry.sequence_number.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(session.exec(statement).all())


def get_latest_state_entry(
    session: Session,
    *,
    run_id: UUID,
) -> GovernanceStateEntry | None:
    statement = (
        select(GovernanceStateEntry)
        .where(GovernanceStateEntry.run_id == run_id)
        .order_by(desc(GovernanceStateEntry.sequence_number))
        .limit(1)
    )
    return session.exec(statement).first()


def verify_state_chain(session: Session, *, run_id: UUID) -> dict[str, object]:
    entries = list_state_entries(session, run_id=run_id, offset=0, limit=1000)
    expected_previous_hash: str | None = None

    for expected_sequence, entry in enumerate(entries, start=1):
        expected_hash = _calculate_entry_hash(
            run_id=entry.run_id,
            sequence_number=entry.sequence_number,
            entry_type=entry.entry_type,
            source=entry.source,
            phase=entry.phase,
            payload=entry.payload,
            previous_hash=entry.previous_hash,
        )
        if entry.sequence_number != expected_sequence:
            return {
                "valid": False,
                "entry_count": len(entries),
                "failed_sequence": entry.sequence_number,
                "reason": "sequence_gap",
            }
        if entry.previous_hash != expected_previous_hash:
            return {
                "valid": False,
                "entry_count": len(entries),
                "failed_sequence": entry.sequence_number,
                "reason": "previous_hash_mismatch",
            }
        if entry.entry_hash != expected_hash:
            return {
                "valid": False,
                "entry_count": len(entries),
                "failed_sequence": entry.sequence_number,
                "reason": "entry_hash_mismatch",
            }
        expected_previous_hash = entry.entry_hash

    return {"valid": True, "entry_count": len(entries), "failed_sequence": None}
