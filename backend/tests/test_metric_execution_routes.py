from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Metric Execution System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": "Task Fulfilment",
            "primary_agent": "orchestrator",
            "tool_name": "promptfoo",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.8},
            "scoring_config": {"direction": "higher_is_better"},
        },
    )
    assert response.status_code == 201
    return response.json()


def create_mapping(client: TestClient, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": "nist_ai_rmf",
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": "MAP-1",
            "control_title": "Context is established",
            "control_category": "map",
            "jurisdiction": "US",
            "metric_ids": [metric_id],
            "agent_names": ["orchestrator"],
            "risk_tiers": ["medium"],
            "evidence_requirements": ["metric_result"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": [metric_id],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_mock_metric_execution_creates_evidence_and_metric_results(
    client: TestClient,
) -> None:
    system = create_system(client)
    create_metric(client, "M-RUN")
    create_mapping(client, "M-RUN")
    run = create_run(client, system["id"], "M-RUN")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.92, "source_name": "local_mock_runner"},
    )

    assert response.status_code == 201
    execution = response.json()
    assert execution["run_id"] == run["id"]
    assert execution["evidence_created"] == 1
    assert execution["metric_results_created"] == 1
    assert execution["evidence"][0]["source_type"] == "mock_metric"
    assert execution["evidence"][0]["source_name"] == "local_mock_runner"
    assert execution["evidence"][0]["passed"] is True
    assert execution["metric_results"][0]["metric_id"] == "M-RUN"
    assert execution["metric_results"][0]["status"] == "passed"
    assert execution["metric_results"][0]["evidence_ids"] == [
        execution["evidence"][0]["id"]
    ]

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    assert updated_run["status"] == "metrics_running"
    assert updated_run["current_phase"] == "metric_execution"
    assert updated_run["result_summary"]["metric_results_created"] == 1


def test_mock_metric_execution_can_force_status(client: TestClient) -> None:
    system = create_system(client)
    create_metric(client, "M-FORCE")
    create_mapping(client, "M-FORCE")
    run = create_run(client, system["id"], "M-FORCE")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.2, "force_status": "skipped"},
    )

    assert response.status_code == 201
    execution = response.json()
    assert execution["metric_results"][0]["status"] == "skipped"
    assert execution["metric_results"][0]["passed"] is False


def test_mock_metric_execution_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/metrics/run",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def test_mock_metric_execution_validates_score(client: TestClient) -> None:
    system = create_system(client)
    create_metric(client, "M-INVALID")
    create_mapping(client, "M-INVALID")
    run = create_run(client, system["id"], "M-INVALID")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 1.5},
    )

    assert response.status_code == 422
