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
            "selected_metrics": ["CM-005", "CM-026"],
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

    # Orchestration is now fire-and-forget: the endpoint returns 202 and the
    # pipeline runs in a BackgroundTask (executed synchronously by TestClient
    # before this call returns).
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_scorer"],
            "requested_by": "backend_test",
            "notes": "Run full governance pipeline.",
        },
    )
    assert response.status_code == 202
    assert response.json()["run_id"] == run["id"]

    # The pipeline finalizes the run to a terminal state (previously it parked at
    # council_running, which hung SSE + completion polling).
    run_after = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert run_after["status"] == "completed"
    assert run_after["current_phase"] == "completed"

    report = client.get(f"/api/v1/evaluation-runs/{run['id']}/report").json()
    assert report["run"]["id"] == run["id"]
    assert report["counts"]["metric_results"] == 2
    assert report["counts"]["agent_executions"] == 1
    # 6 state entries once the run is finalized (this GET /report is taken after
    # completion, so it includes the governance_report_generated entry — the old
    # value of 5 came from a mid-pipeline snapshot in the orchestrate response).
    assert report["counts"]["state_entries"] == 6
    assert report["state_chain"]["valid"] is True

    plan = client.get(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan").json()
    assert plan["probe_budget_allocated"] == 100

    agents = client.get(f"/api/v1/evaluation-runs/{run['id']}/agents/executions").json()
    assert agents[0]["agent_name"] == "risk_scorer"
    assert agents[0]["status"] == "completed"

    state_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/state")
    assert state_response.status_code == 200
    state_entries = state_response.json()
    assert [entry["entry_type"] for entry in state_entries] == [
        "evaluation_plan_prepared",
        "metric_execution_completed",
        "agent_execution_completed",
        "council_iteration",
        "council_deliberation_completed",
        "governance_report_generated",
    ]
    assert [entry["sequence_number"] for entry in state_entries] == [1, 2, 3, 4, 5, 6]

    ledger_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger")
    assert ledger_response.status_code == 200
    ledger_entries = ledger_response.json()
    assert [entry["event_type"] for entry in ledger_entries] == [
        "evaluation_plan.prepared",
        "metric_execution.completed",
        "agent_execution.completed",
        "council_deliberation.completed",
        "governance_report.generated",
    ]

    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/state/verify").json() == {
        "valid": True,
        "entry_count": 6,
        "failed_sequence": None,
        "reason": None,
    }
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger/verify").json() == {
        "valid": True,
        "entry_count": 5,
        "failed_entry_id": None,
        "reason": None,
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    # The pipeline now finalizes the run instead of leaving it parked at
    # deliberation_council.
    assert updated_run["current_phase"] == "completed"
    assert updated_run["status"] == "completed"
    # Deterministic mock-council output for this all-pass single-agent scenario.
    # (Was "approved" before commit 958dd58 capped re_probe remediation budget,
    # which changed the mock deliberation's verdict; assertion updated to match.)
    assert updated_run["result_summary"]["council_label"] == "conditional_approval"


def test_governance_pipeline_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(f"/api/v1/evaluation-runs/{run_id}/orchestrate", json={})

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
