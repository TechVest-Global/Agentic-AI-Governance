from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient, name: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
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


def create_mapping(client: TestClient, metric_id: str, control_ref: str) -> None:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": "nist_ai_rmf",
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": control_ref,
            "metric_ids": [metric_id],
        },
    )
    assert response.status_code == 201


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


def prepare_run_with_metric(
    client: TestClient,
    *,
    name: str,
    metric_id: str,
    control_ref: str,
    mock_score: float,
) -> tuple[dict[str, object], dict[str, object]]:
    system = create_system(client, name)
    create_metric(client, metric_id)
    create_mapping(client, metric_id, control_ref)
    run = create_run(client, system["id"], metric_id)
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": mock_score},
    )
    assert execution.status_code == 201
    return run, execution.json()


def test_council_deliberation_approves_clean_run(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Approved System",
        metric_id="COUNCIL-PASS",
        control_ref="MAP-APPROVE",
        mock_score=0.95,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"requested_by": "prakriti"},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["metric_result_count"] == 1
    assert result["failed_metric_count"] == 0
    assert result["open_finding_count"] == 0
    assert result["verdict"]["label"] == "approved"
    assert result["verdict"]["action_tier"] == "autonomous"
    assert result["verdict"]["required_actions"] == []

    verdict_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/verdict")
    assert verdict_response.status_code == 200
    assert verdict_response.json()["id"] == result["verdict"]["id"]


def test_council_deliberation_conditionally_approves_open_medium_finding(
    client: TestClient,
) -> None:
    run, execution = prepare_run_with_metric(
        client,
        name="Council Conditional System",
        metric_id="COUNCIL-REVIEW",
        control_ref="MAP-REVIEW",
        mock_score=0.9,
    )
    evidence_id = execution["evidence"][0]["id"]
    finding = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        json={
            "finding_type": "compliance",
            "title": "Needs review",
            "summary": "A medium issue remains.",
            "severity": "medium",
            "confidence": 0.8,
            "dimension": "Task Fulfilment",
            "framework_refs": ["nist_ai_rmf:MAP-REVIEW"],
            "evidence_ids": [evidence_id],
            "recommended_action": "Review mitigation evidence.",
        },
    )
    assert finding.status_code == 201

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"notes": "Deliberate after metric execution."},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["verdict"]["label"] == "conditional_approval"
    assert result["verdict"]["action_tier"] == "supervised"
    assert result["open_finding_count"] == 1
    assert result["highest_severity"] == "medium"
    assert result["verdict"]["required_actions"][0]["action"] == (
        "Review mitigation evidence."
    )


def test_council_deliberation_blocks_failed_metric(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Blocked System",
        metric_id="COUNCIL-FAIL",
        control_ref="MAP-BLOCK",
        mock_score=0.2,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["failed_metric_count"] == 1
    assert result["verdict"]["label"] == "blocked"
    assert result["verdict"]["action_tier"] == "human_review"


def test_council_deliberation_rejects_existing_verdict(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Duplicate Verdict System",
        metric_id="COUNCIL-DUP",
        control_ref="MAP-DUP",
        mock_score=0.9,
    )
    url = f"/api/v1/evaluation-runs/{run['id']}/council/deliberate"
    assert client.post(url, json={}).status_code == 201

    response = client.post(url, json={})

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {
        "resource": "Verdict",
        "field": "run_id",
        "value": run["id"],
    }


def test_council_deliberation_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/council/deliberate",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
