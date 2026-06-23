from uuid import uuid4

from app.services.agents.base import AgentContext
from fastapi.testclient import TestClient


def create_system(
    client: TestClient,
    *,
    name: str,
    risk_tier: str = "medium",
) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
            "owner": "AI Governance",
            "system_type": "chatbot",
            "risk_tier": risk_tier,
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_capability(
    client: TestClient,
    system_id: str,
    *,
    name: str = "answer_question",
    side_effect_level: str = "none",
    requires_human_review: bool = False,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={
            "name": name,
            "capability_type": "action",
            "endpoint_ref": f"/api/{name}",
            "side_effect_level": side_effect_level,
            "requires_human_review": requires_human_review,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str, dimension: str) -> None:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": dimension,
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


def test_selected_agents_create_findings_from_metric_results(client: TestClient) -> None:
    system = create_system(client, name="Agent Metric System")
    create_metric(client, "bias_fairness_score", "Bias and Fairness")
    create_mapping(client, "bias_fairness_score", "MAP-BIAS")
    run = create_run(client, system["id"], ["bias_fairness_score"])
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.2},
    )
    assert execution.status_code == 201

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["findings_created"] == 1
    assert len(result["agents_run"]) == 1
    assert result["agents_run"][0]["agent_name"] == "bias_agent"
    assert result["agents_run"][0]["finding_count"] == 1
    assert result["agents_run"][0]["status"] == "completed"
    assert result["agents_run"][0]["id"] is not None
    assert len(result["executions"]) == 1
    assert result["executions"][0]["agent_name"] == "bias_agent"
    assert result["executions"][0]["status"] == "completed"
    assert result["executions"][0]["finding_count"] == 1
    assert result["executions"][0]["started_at"] is not None
    assert result["executions"][0]["completed_at"] is not None
    assert result["findings"][0]["agent_name"] == "bias_agent"
    assert result["findings"][0]["finding_type"] == "bias"

    list_response = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        params={"agent_name": "bias_agent"},
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [
        result["findings"][0]["id"]
    ]

    execution_response = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/agents/executions"
    )
    assert execution_response.status_code == 200
    executions = execution_response.json()
    assert [execution["id"] for execution in executions] == [
        result["executions"][0]["id"]
    ]

    report_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/report")
    assert report_response.status_code == 200
    report = report_response.json()
    assert report["counts"]["agent_executions"] == 1
    assert report["agent_executions"][0]["agent_name"] == "bias_agent"


def test_all_agents_can_create_risk_and_misuse_findings(client: TestClient) -> None:
    system = create_system(client, name="High Risk Agent System", risk_tier="high")
    create_capability(
        client,
        system["id"],
        name="delete_account",
        side_effect_level="destructive",
        requires_human_review=False,
    )
    run = create_run(client, system["id"], [])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    finding_types = {finding["finding_type"] for finding in result["findings"]}
    assert {"risk", "misuse"}.issubset(finding_types)
    assert result["findings_created"] >= 2
    assert len(result["executions"]) == 6
    assert {execution["agent_name"] for execution in result["executions"]} >= {
        "risk_agent",
        "misuse_agent",
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    assert run_response.json()["status"] == "agents_running"
    assert run_response.json()["current_phase"] == "specialist_agents"


def test_agent_failure_is_stored_as_degraded_execution(
    client: TestClient,
    monkeypatch,
) -> None:
    class FailingAgent:
        name = "failing_agent"

        def evaluate(self, context: AgentContext) -> list[object]:
            raise RuntimeError("agent tool unavailable")

    system = create_system(client, name="Failing Agent System")
    run = create_run(client, system["id"], [])
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None: [FailingAgent()],
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["findings_created"] == 0
    assert result["agents_run"] == [
        {
            "id": result["executions"][0]["id"],
            "agent_name": "failing_agent",
            "finding_count": 0,
            "status": "failed",
        }
    ]
    assert result["executions"][0]["error_summary"] == {
        "error_type": "RuntimeError",
        "message": "agent tool unavailable",
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    run_body = run_response.json()
    assert run_body["status"] == "degraded"
    assert run_body["result_summary"]["agent_executions_failed"] == 1


def test_agent_run_rejects_unknown_agent(client: TestClient) -> None:
    system = create_system(client, name="Unknown Agent System")
    run = create_run(client, system["id"], [])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={"agent_names": ["not_a_real_agent"]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"] == {
        "unknown_agents": ["not_a_real_agent"]
    }


def test_agent_run_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
