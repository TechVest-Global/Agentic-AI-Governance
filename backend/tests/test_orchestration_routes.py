from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Orchestrated Governance System",
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
            "selected_metrics": ["GOV-M001", "GOV-M002"],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_governance_pipeline_orchestrates_metrics_agents_council_and_report(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_agent"],
            "requested_by": "backend_test",
            "notes": "Run full governance pipeline.",
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["run_id"] == run["id"]
    assert result["metric_execution"]["metric_results_created"] == 2
    assert result["agent_run"]["agents_run"][0]["agent_name"] == "risk_agent"
    assert result["agent_run"]["executions"][0]["status"] == "completed"
    assert result["council"]["verdict"]["label"] == "approved"
    assert result["report"]["run"]["id"] == run["id"]
    assert result["report"]["counts"]["metric_results"] == 2
    assert result["report"]["counts"]["agent_executions"] == 1
    assert result["report"]["counts"]["state_entries"] == 4
    assert result["report"]["verdict"]["label"] == "approved"
    assert result["report"]["state_chain"]["valid"] is True

    state_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/state")
    assert state_response.status_code == 200
    state_entries = state_response.json()
    assert [entry["entry_type"] for entry in state_entries] == [
        "metric_execution_completed",
        "agent_execution_completed",
        "council_deliberation_completed",
        "governance_report_generated",
    ]
    assert [entry["sequence_number"] for entry in state_entries] == [1, 2, 3, 4]

    ledger_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger")
    assert ledger_response.status_code == 200
    ledger_entries = ledger_response.json()
    assert [entry["event_type"] for entry in ledger_entries] == [
        "metric_execution.completed",
        "agent_execution.completed",
        "council_deliberation.completed",
        "governance_report.generated",
    ]

    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/state/verify").json() == {
        "valid": True,
        "entry_count": 4,
        "failed_sequence": None,
        "reason": None,
    }
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger/verify").json() == {
        "valid": True,
        "entry_count": 4,
        "failed_entry_id": None,
        "reason": None,
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    assert updated_run["current_phase"] == "deliberation_council"
    assert updated_run["result_summary"]["council_label"] == "approved"


def test_governance_pipeline_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(f"/api/v1/evaluation-runs/{run_id}/orchestrate", json={})

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
