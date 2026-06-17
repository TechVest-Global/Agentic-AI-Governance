import hashlib
import json
from uuid import UUID

from sqlmodel import Session, desc, select

from app.core.exceptions import ResourceNotFoundError
from app.models.ledger import AuditLedgerEntry
from app.schemas.governance import AuditLedgerEntryCreate
from app.services.run_validation import get_run_or_raise


def append_ledger_entry(
    session: Session,
    *,
    run_id: UUID,
    payload: AuditLedgerEntryCreate,
) -> AuditLedgerEntry:
    get_run_or_raise(session, run_id)

    previous_entry = get_latest_ledger_entry(session, run_id=run_id)
    previous_hash = None if previous_entry is None else previous_entry.entry_hash
    entry_hash = _calculate_entry_hash(
        run_id=run_id,
        event_type=payload.event_type,
        actor_type=payload.actor_type,
        actor_id=payload.actor_id,
        payload=payload.payload,
        previous_hash=previous_hash,
    )
    entry = AuditLedgerEntry(
        run_id=run_id,
        event_type=payload.event_type,
        actor_type=payload.actor_type,
        actor_id=payload.actor_id,
        payload=payload.payload,
        previous_hash=previous_hash,
        entry_hash=entry_hash,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def list_ledger_entries(
    session: Session,
    *,
    run_id: UUID,
    offset: int,
    limit: int,
    event_type: str | None = None,
    actor_type: str | None = None,
) -> list[AuditLedgerEntry]:
    get_run_or_raise(session, run_id)

    statement = select(AuditLedgerEntry).where(AuditLedgerEntry.run_id == run_id)
    if event_type is not None:
        statement = statement.where(AuditLedgerEntry.event_type == event_type)
    if actor_type is not None:
        statement = statement.where(AuditLedgerEntry.actor_type == actor_type)
    statement = statement.order_by(AuditLedgerEntry.created_at.asc()).offset(offset).limit(limit)
    return list(session.exec(statement).all())


def get_latest_ledger_entry(
    session: Session,
    *,
    run_id: UUID,
) -> AuditLedgerEntry | None:
    statement = (
        select(AuditLedgerEntry)
        .where(AuditLedgerEntry.run_id == run_id)
        .order_by(desc(AuditLedgerEntry.created_at))
        .limit(1)
    )
    return session.exec(statement).first()


def verify_ledger_chain(session: Session, *, run_id: UUID) -> dict[str, object]:
    entries = list_ledger_entries(session, run_id=run_id, offset=0, limit=1000)
    expected_previous_hash: str | None = None

    for entry in entries:
        expected_hash = _calculate_entry_hash(
            run_id=entry.run_id,
            event_type=entry.event_type,
            actor_type=entry.actor_type,
            actor_id=entry.actor_id,
            payload=entry.payload,
            previous_hash=entry.previous_hash,
        )
        if entry.previous_hash != expected_previous_hash:
            return {
                "valid": False,
                "entry_count": len(entries),
                "failed_entry_id": entry.id,
                "reason": "previous_hash_mismatch",
            }
        if entry.entry_hash != expected_hash:
            return {
                "valid": False,
                "entry_count": len(entries),
                "failed_entry_id": entry.id,
                "reason": "entry_hash_mismatch",
            }
        expected_previous_hash = entry.entry_hash

    return {
        "valid": True,
        "entry_count": len(entries),
        "failed_entry_id": None,
        "reason": None,
    }


def get_ledger_entry(
    session: Session,
    *,
    run_id: UUID,
    entry_id: UUID,
) -> AuditLedgerEntry:
    get_run_or_raise(session, run_id)
    entry = session.get(AuditLedgerEntry, entry_id)
    if entry is None or entry.run_id != run_id:
        raise ResourceNotFoundError("Audit ledger entry", str(entry_id))
    return entry


def _calculate_entry_hash(
    *,
    run_id: UUID,
    event_type: str,
    actor_type: object,
    actor_id: str | None,
    payload: dict[str, object],
    previous_hash: str | None,
) -> str:
    material = {
        "run_id": str(run_id),
        "event_type": event_type,
        "actor_type": str(actor_type),
        "actor_id": actor_id,
        "payload": payload,
        "previous_hash": previous_hash,
    }
    canonical = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
