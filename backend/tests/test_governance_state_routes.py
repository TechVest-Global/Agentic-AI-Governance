from uuid import uuid4

from fastapi.testclient import TestClient


def create_run(client: TestClient) -> dict[str, object]:
    system_response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "State Test System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert system_response.status_code == 201

    run_response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_response.json()["id"]},
    )
    assert run_response.status_code == 201
    return run_response.json()


def test_state_entries_append_in_sequence_with_hash_chain(
    client: TestClient,
) -> None:
    run = create_run(client)
    state_url = f"/api/v1/evaluation-runs/{run['id']}/state"

    first_response = client.post(
        state_url,
        json={
            "entry_type": "context_assembled",
            "source": "context_assembly",
            "phase": "context_assembly",
            "payload": {"profile_loaded": True},
        },
    )
    second_response = client.post(
        state_url,
        json={
            "entry_type": "plan_created",
            "source": "adaptive_orchestrator",
            "phase": "adaptive_orchestrator",
            "payload": {"agents": ["bias_auditor", "compliance_mapper"]},
        },
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first = first_response.json()
    second = second_response.json()
    assert first["sequence_number"] == 1
    assert first["previous_hash"] is None
    assert second["sequence_number"] == 2
    assert second["previous_hash"] == first["entry_hash"]
    assert second["entry_hash"] != first["entry_hash"]

    list_response = client.get(state_url)
    assert list_response.status_code == 200
    assert [entry["sequence_number"] for entry in list_response.json()] == [1, 2]

    verify_response = client.get(f"{state_url}/verify")
    assert verify_response.status_code == 200
    assert verify_response.json() == {
        "valid": True,
        "entry_count": 2,
        "failed_sequence": None,
        "reason": None,
    }


def test_state_entries_can_be_filtered_by_phase_and_source(
    client: TestClient,
) -> None:
    run = create_run(client)
    state_url = f"/api/v1/evaluation-runs/{run['id']}/state"

    client.post(
        state_url,
        json={
            "entry_type": "context_assembled",
            "source": "context_assembly",
            "phase": "context_assembly",
            "payload": {},
        },
    )
    client.post(
        state_url,
        json={
            "entry_type": "bias_probe_complete",
            "source": "bias_auditor",
            "phase": "specialist_agents",
            "payload": {},
        },
    )

    phase_response = client.get(state_url, params={"phase": "specialist_agents"})
    assert phase_response.status_code == 200
    assert [entry["source"] for entry in phase_response.json()] == ["bias_auditor"]

    source_response = client.get(state_url, params={"source": "context_assembly"})
    assert source_response.status_code == 200
    assert [entry["phase"] for entry in source_response.json()] == [
        "context_assembly"
    ]


def test_state_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/state",
        json={
            "entry_type": "context_assembled",
            "source": "context_assembly",
            "phase": "context_assembly",
            "payload": {},
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
