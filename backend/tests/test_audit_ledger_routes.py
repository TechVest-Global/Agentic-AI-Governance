from uuid import UUID, uuid4

import app.db.session as db_session
from app.models.enums import LedgerActorType
from app.schemas.governance import AuditLedgerEntryCreate
from app.services import audit_ledger
from fastapi.testclient import TestClient
from sqlmodel import Session


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Ledger System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id},
    )
    assert response.status_code == 201
    return response.json()


def test_audit_ledger_entries_are_appended_listed_and_verified(
    client: TestClient,
) -> None:
    system = create_system(client)
    run = create_run(client, system["id"])
    ledger_url = f"/api/v1/evaluation-runs/{run['id']}/ledger"

    first_response = client.post(
        ledger_url,
        json={
            "event_type": "run_started",
            "actor_type": "user",
            "actor_id": "prakriti",
            "payload": {"source": "manual"},
        },
    )
    # The public route only accepts user-attributed entries (see
    # test_audit_ledger_post_rejects_non_user_actor_type below); system/tool
    # entries are written by internal pipeline code via the service function
    # directly, exercised here the same way orchestration.py does.
    with Session(db_session.engine) as session:
        audit_ledger.append_ledger_entry(
            session,
            run_id=UUID(run["id"]),
            payload=AuditLedgerEntryCreate(
                event_type="metric_execution_completed",
                actor_type=LedgerActorType.tool,
                actor_id="mock_metric_runner",
                payload={"metric_results_created": 1},
            ),
        )

    assert first_response.status_code == 201
    first = first_response.json()
    second = client.get(ledger_url).json()[1]
    assert first["previous_hash"] is None
    assert second["previous_hash"] == first["entry_hash"]

    list_response = client.get(ledger_url)
    assert list_response.status_code == 200
    assert [entry["event_type"] for entry in list_response.json()] == [
        "run_started",
        "metric_execution_completed",
    ]

    filtered_response = client.get(
        ledger_url,
        params={"event_type": "run_started", "actor_type": "user"},
    )
    assert filtered_response.status_code == 200
    assert [entry["id"] for entry in filtered_response.json()] == [first["id"]]

    get_response = client.get(f"{ledger_url}/{second['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == second

    verify_response = client.get(f"{ledger_url}/verify")
    assert verify_response.status_code == 200
    assert verify_response.json() == {
        "valid": True,
        "entry_count": 2,
        "failed_entry_id": None,
        "reason": None,
        # No content_digest was recorded on either manually-created entry, so
        # there is nothing to content-check here.
        "content_valid": None,
        "content_checks": [],
    }


def test_verify_ledger_chain_checks_beyond_the_old_1000_entry_cap(
    client: TestClient,
) -> None:
    # verify_ledger_chain used to fetch only the first 1000 entries via
    # list_ledger_entries(offset=0, limit=1000), so a run with more than 1000
    # entries would silently report entry_count=1000 and valid=True even
    # though the tail of the chain was never inspected. Insert more than 1000
    # entries directly (bulk via the service, to keep the test fast) and
    # confirm the verify endpoint reports the TRUE total.
    system = create_system(client)
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])
    total_entries = 1005

    with Session(db_session.engine) as session:
        for i in range(total_entries):
            audit_ledger.append_ledger_entry(
                session,
                run_id=run_id,
                payload=AuditLedgerEntryCreate(
                    event_type=f"bulk_event_{i}",
                    actor_type=LedgerActorType.system,
                ),
            )

    verify_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger/verify")
    assert verify_response.status_code == 200
    body = verify_response.json()
    assert body["valid"] is True
    assert body["entry_count"] == total_entries


def test_audit_ledger_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/ledger",
        json={"event_type": "missing_run", "actor_type": "user"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def test_audit_ledger_entry_is_scoped_to_run(client: TestClient) -> None:
    first_system = create_system(client)
    second_system = create_system(client)
    first_run = create_run(client, first_system["id"])
    second_run = create_run(client, second_system["id"])
    first_ledger_url = f"/api/v1/evaluation-runs/{first_run['id']}/ledger"
    second_ledger_url = f"/api/v1/evaluation-runs/{second_run['id']}/ledger"
    entry = client.post(
        first_ledger_url, json={"event_type": "scoped", "actor_type": "user"}
    ).json()

    response = client.get(f"{second_ledger_url}/{entry['id']}")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Audit ledger entry",
        "id": entry["id"],
    }


def test_audit_ledger_post_rejects_non_user_actor_type(client: TestClient) -> None:
    # Only manual, human-attributed annotations may be created through the
    # public route — system/agent/tool entries must come from internal
    # pipeline code calling the service directly, never a client-forgeable
    # HTTP body, otherwise anyone could inject a fabricated pipeline event
    # into the hash chain.
    system = create_system(client)
    run = create_run(client, system["id"])
    ledger_url = f"/api/v1/evaluation-runs/{run['id']}/ledger"

    for forged_actor_type in ("system", "agent", "tool"):
        response = client.post(
            ledger_url,
            json={
                "event_type": "forged_event",
                "actor_type": forged_actor_type,
                "actor_id": "attacker-controlled",
            },
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    assert client.get(ledger_url).json() == []
