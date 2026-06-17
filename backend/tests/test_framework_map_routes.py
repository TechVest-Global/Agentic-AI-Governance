from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Framework Map System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str) -> None:
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


def create_mapping(client: TestClient, control_ref: str, metric_id: str) -> None:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": "nist_ai_rmf",
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": control_ref,
            "control_title": f"{control_ref} control",
            "control_category": "map",
            "jurisdiction": "US",
            "metric_ids": [metric_id],
            "agent_names": ["orchestrator"],
            "risk_tiers": ["medium"],
            "evidence_requirements": ["metric_result"],
        },
    )
    assert response.status_code == 201


def create_run(client: TestClient, system_id: str, metric_ids: list[str]) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": metric_ids,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_framework_map_reports_passed_failed_review_and_not_evaluated_controls(
    client: TestClient,
) -> None:
    system = create_system(client)
    for metric_id, control_ref in [
        ("MAP-PASS-M", "MAP-PASS"),
        ("MAP-FAIL-M", "MAP-FAIL"),
        ("MAP-REVIEW-M", "MAP-REVIEW"),
        ("MAP-NONE-M", "MAP-NONE"),
    ]:
        create_metric(client, metric_id)
        create_mapping(client, control_ref, metric_id)

    passing_run = create_run(client, system["id"], ["MAP-PASS-M"])
    assert (
        client.post(
            f"/api/v1/evaluation-runs/{passing_run['id']}/metrics/run",
            json={"mock_score": 0.9},
        ).status_code
        == 201
    )
    passed_response = client.get(
        f"/api/v1/evaluation-runs/{passing_run['id']}/framework-map"
    )
    assert passed_response.status_code == 200
    passed_controls = {
        control["control_ref"]: control for control in passed_response.json()["controls"]
    }
    assert passed_controls["MAP-PASS"]["status"] == "passed"
    assert passed_controls["MAP-FAIL"]["status"] == "not_evaluated"

    failing_run = create_run(client, system["id"], ["MAP-FAIL-M"])
    assert (
        client.post(
            f"/api/v1/evaluation-runs/{failing_run['id']}/metrics/run",
            json={"mock_score": 0.2},
        ).status_code
        == 201
    )
    failed_response = client.get(
        f"/api/v1/evaluation-runs/{failing_run['id']}/framework-map"
    )
    assert failed_response.status_code == 200
    failed_controls = {
        control["control_ref"]: control for control in failed_response.json()["controls"]
    }
    assert failed_controls["MAP-FAIL"]["status"] == "failed"
    assert failed_controls["MAP-FAIL"]["failed_metric_count"] == 1

    review_run = create_run(client, system["id"], ["MAP-REVIEW-M"])
    execution = client.post(
        f"/api/v1/evaluation-runs/{review_run['id']}/metrics/run",
        json={"mock_score": 0.9},
    )
    assert execution.status_code == 201
    evidence_id = execution.json()["evidence"][0]["id"]
    finding = client.post(
        f"/api/v1/evaluation-runs/{review_run['id']}/findings",
        json={
            "finding_type": "compliance",
            "title": "Reviewer attention needed",
            "summary": "The control passed metrics but still has an open issue.",
            "severity": "medium",
            "confidence": 0.8,
            "dimension": "Task Fulfilment",
            "framework_refs": ["nist_ai_rmf:MAP-REVIEW"],
            "evidence_ids": [evidence_id],
        },
    )
    assert finding.status_code == 201
    review_response = client.get(
        f"/api/v1/evaluation-runs/{review_run['id']}/framework-map"
    )
    assert review_response.status_code == 200
    review_controls = {
        control["control_ref"]: control for control in review_response.json()["controls"]
    }
    assert review_controls["MAP-REVIEW"]["status"] == "needs_review"
    assert review_controls["MAP-REVIEW"]["highest_severity"] == "medium"
    assert review_controls["MAP-REVIEW"]["finding_count"] == 1


def test_framework_map_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.get(f"/api/v1/evaluation-runs/{run_id}/framework-map")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
