"""Covers the atomicity fix for approve_plan's status-change + ledger-append.

Previously the run's status change (planned -> metrics_running) was committed
independently of the audit_ledger.append_ledger_entry() call that records
"plan.approved". If the ledger insert then failed, the run had already
silently transitioned state with no corresponding ledger entry. approve_plan
now builds the ledger entry with commit=False and commits both the run
status change and the ledger entry together in one transaction.
"""

from uuid import UUID

import app.db.session as db_session
import pytest
from app.schemas.governance import PlanApprovalCreate
from app.services import audit_ledger, evaluation_runs
from fastapi.testclient import TestClient
from sqlmodel import Session


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Atomicity Test System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "risk_tier": "medium",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["CM-005", "CM-026"],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_approve_plan_rolls_back_run_status_if_ledger_append_fails(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    # Gate the run so it parks at 'planned', awaiting approval.
    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_scorer"],
            "requested_by": "backend_test",
            "require_plan_approval": True,
        },
    )
    assert orchestrate.status_code == 202

    paused = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert paused["status"] == "planned"
    assert paused["plan_approved_at"] is None

    def boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated ledger append failure")

    # Simulate the ledger insert failing (e.g. a unique-constraint race).
    monkeypatch.setattr(audit_ledger, "append_ledger_entry", boom)

    run_id = UUID(run["id"])
    with Session(db_session.engine) as session:
        with pytest.raises(RuntimeError, match="simulated ledger append failure"):
            evaluation_runs.approve_plan(
                session,
                run_id=run_id,
                payload=PlanApprovalCreate(approved_by="R. Sharma"),
            )
        # Whatever the failed call staged on the session must not survive.
        session.rollback()

    monkeypatch.undo()

    # The run's status change must NOT have partially persisted: it should
    # still be parked at 'planned', not advanced to metrics_running.
    still_paused = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert still_paused["status"] == "planned"
    assert still_paused["current_phase"] == "adaptive_orchestrator"
    assert still_paused["plan_approved_at"] is None

    ledger_events = [
        e["event_type"]
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert "plan.approved" not in ledger_events
