from uuid import uuid4

from fastapi.testclient import TestClient


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
    second_response = client.post(
        ledger_url,
        json={
            "event_type": "metric_execution_completed",
            "actor_type": "tool",
            "actor_id": "mock_metric_runner",
            "payload": {"metric_results_created": 1},
        },
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first = first_response.json()
    second = second_response.json()
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
    }


def test_audit_ledger_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/ledger",
        json={"event_type": "missing_run"},
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
    entry = client.post(first_ledger_url, json={"event_type": "scoped"}).json()

    response = client.get(f"{second_ledger_url}/{entry['id']}")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Audit ledger entry",
        "id": entry["id"],
    }
