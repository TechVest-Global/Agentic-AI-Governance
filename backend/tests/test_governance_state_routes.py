from uuid import UUID, uuid4

import app.db.session as db_session
from app.schemas.governance import GovernanceStateEntryCreate
from app.services import governance_state
from fastapi.testclient import TestClient
from sqlmodel import Session


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


def test_verify_state_chain_checks_beyond_the_old_1000_entry_cap(
    client: TestClient,
) -> None:
    # verify_state_chain used to fetch only the first 1000 entries via
    # list_state_entries(offset=0, limit=1000), so a run with more than 1000
    # entries would silently report entry_count=1000 and valid=True even
    # though the tail of the chain was never inspected. Insert more than 1000
    # entries directly (bulk via the service, to keep the test fast) and
    # confirm the verify endpoint reports the TRUE total.
    run = create_run(client)
    run_id = UUID(run["id"])
    total_entries = 1005

    with Session(db_session.engine) as session:
        for i in range(total_entries):
            governance_state.append_state_entry(
                session,
                run_id=run_id,
                payload=GovernanceStateEntryCreate(
                    entry_type=f"bulk_entry_{i}",
                    source="test_harness",
                    phase="metric_execution",
                    payload={},
                ),
            )

    verify_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/state/verify")
    assert verify_response.status_code == 200
    body = verify_response.json()
    assert body["valid"] is True
    assert body["entry_count"] == total_entries


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
