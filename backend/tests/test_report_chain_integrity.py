"""The governance report must attest to BOTH append-only chains.

A run keeps two hash-chained records: the GovernanceState chain and the audit
ledger. The report verified only the state chain, yet it is the artefact a
reviewer actually reads — so a report attesting to chain integrity implied the
audit trail had been checked when it had not. verify_ledger_chain existed and was
routed, but nothing in the report ever called it.
"""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from tests.test_agent_routes import create_run, create_system


def _run_pipeline(client: TestClient) -> str:
    system = create_system(client, name="Chain Integrity System")
    run = create_run(client, system["id"], [])
    assert client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"mock_score": 0.9, "requested_by": "test"},
    ).status_code == 202
    return run["id"]


def test_report_verifies_both_chains(client: TestClient) -> None:
    run_id = _run_pipeline(client)

    report = client.get(f"/api/v1/evaluation-runs/{run_id}/report").json()

    assert report["state_chain"]["valid"] is True
    assert report["ledger_chain"]["valid"] is True
    # Both chains must actually contain entries — a vacuously "valid" empty chain
    # would satisfy the assertions above while attesting to nothing.
    assert report["state_chain"]["entry_count"] > 0
    assert report["ledger_chain"]["entry_count"] > 0


def test_report_surfaces_a_tampered_ledger(client: TestClient) -> None:
    """The point of verifying: tampering must show up in the report.

    Without this the ledger_chain field could be hardcoded true and nobody would
    notice.
    """
    from app.db import session as db_session
    from app.models.ledger import AuditLedgerEntry

    run_id = _run_pipeline(client)

    with Session(db_session.engine) as session:
        entry = session.exec(
            select(AuditLedgerEntry)
            .where(AuditLedgerEntry.run_id == UUID(run_id))
            .order_by(AuditLedgerEntry.sequence_number.asc())
        ).first()
        assert entry is not None
        entry.payload = {**(entry.payload or {}), "tampered": True}
        session.add(entry)
        session.commit()

    report = client.get(f"/api/v1/evaluation-runs/{run_id}/report").json()

    assert report["ledger_chain"]["valid"] is False
    assert report["ledger_chain"]["reason"] == "entry_hash_mismatch"
    # The state chain is a separate record and must be unaffected — proving the
    # two are verified independently rather than sharing one result.
    assert report["state_chain"]["valid"] is True


def test_report_surfaces_a_tampered_state_chain(client: TestClient) -> None:
    from app.db import session as db_session
    from app.models.state import GovernanceStateEntry

    run_id = _run_pipeline(client)

    with Session(db_session.engine) as session:
        entry = session.exec(
            select(GovernanceStateEntry)
            .where(GovernanceStateEntry.run_id == UUID(run_id))
            .order_by(GovernanceStateEntry.sequence_number.asc())
        ).first()
        assert entry is not None
        entry.payload = {**(entry.payload or {}), "tampered": True}
        session.add(entry)
        session.commit()

    report = client.get(f"/api/v1/evaluation-runs/{run_id}/report").json()

    assert report["state_chain"]["valid"] is False
    assert report["ledger_chain"]["valid"] is True
