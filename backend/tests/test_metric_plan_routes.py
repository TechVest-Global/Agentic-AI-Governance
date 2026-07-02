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


def create_metric(
    client: TestClient,
    metric_id: str,
    *,
    frameworks: list[str] | None = None,
    enabled: bool = True,
) -> dict[str, object]:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": "Task Fulfilment",
            "primary_agent": "orchestrator",
            "tool_name": "promptfoo",
            "framework_ids": frameworks or ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.9},
            "scoring_config": {"direction": "higher_is_better"},
            "enabled": enabled,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_mapping(
    client: TestClient,
    control_ref: str,
    *,
    metric_ids: list[str],
    framework_id: str = "nist_ai_rmf",
    enabled: bool = True,
) -> dict[str, object]:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": framework_id,
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": control_ref,
            "control_title": "Context is established",
            "control_category": "map",
            "jurisdiction": "US",
            "metric_ids": metric_ids,
            "agent_names": ["orchestrator"],
            "risk_tiers": ["medium"],
            "evidence_requirements": ["metric_result"],
            "enabled": enabled,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(
    client: TestClient,
    system_id: str,
    *,
    selected_frameworks: list[str] | None = None,
    selected_metrics: list[str] | None = None,
) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": selected_frameworks or [],
            "selected_metrics": selected_metrics or [],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_metric_plan_uses_explicit_selected_metrics(client: TestClient) -> None:
    system = create_system(client, "Explicit Metric Plan System")
    create_metric(client, "M01")
    create_metric(client, "M02")
    create_mapping(client, "MAP-1", metric_ids=["M01", "M02"])
    run = create_run(
        client,
        system["id"],
        selected_frameworks=["nist_ai_rmf"],
        selected_metrics=["M02"],
    )

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/metric-plan")

    assert response.status_code == 200
    plan = response.json()
    assert plan["run_id"] == run["id"]
    assert plan["ai_system_id"] == system["id"]
    assert plan["metric_count"] == 1
    assert plan["control_count"] == 1
    assert plan["metrics"][0]["metric_id"] == "M02"
    assert plan["metrics"][0]["controls"][0]["control_ref"] == "MAP-1"


def test_metric_plan_can_be_derived_from_selected_frameworks(
    client: TestClient,
) -> None:
    system = create_system(client, "Framework Metric Plan System")
    create_metric(client, "M10", frameworks=["nist_ai_rmf"])
    create_metric(client, "M20", frameworks=["eu_ai_act"])
    create_metric(client, "M30", frameworks=["nist_ai_rmf"], enabled=False)
    create_mapping(client, "MAP-10", metric_ids=["M10"])
    create_mapping(client, "ACT-20", metric_ids=["M20"], framework_id="eu_ai_act")
    create_mapping(client, "MAP-30", metric_ids=["M30"])
    run = create_run(
        client,
        system["id"],
        selected_frameworks=["nist_ai_rmf"],
    )

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/metric-plan")

    assert response.status_code == 200
    plan = response.json()
    assert plan["metric_count"] == 1
    assert [metric["metric_id"] for metric in plan["metrics"]] == ["M10"]
    assert plan["metrics"][0]["controls"][0]["control_ref"] == "MAP-10"


def test_metric_plan_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.get(f"/api/v1/evaluation-runs/{run_id}/metric-plan")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def add_capability(
    client: TestClient,
    system_id: str,
    *,
    capability_type: str,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={
            "name": f"{capability_type} capability",
            "capability_type": capability_type,
            "endpoint_ref": "/invoke",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_metric_plan_excludes_capability_gated_metric_when_system_lacks_it(
    client: TestClient,
) -> None:
    system = create_system(client, "Non-Retrieval System")
    universal = create_metric(client, "M40")
    gated = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": "M41",
            "name": "Retrieval only metric",
            "dimension": "Retrieval",
            "primary_agent": "orchestrator",
            "tool_name": "ragas",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.9},
            "scoring_config": {"direction": "higher_is_better"},
            "applicable_capability_types": ["retrieval"],
            "enabled": True,
        },
    )
    assert gated.status_code == 201
    create_mapping(client, "MAP-40", metric_ids=["M40"])
    create_mapping(client, "MAP-41", metric_ids=["M41"])
    run = create_run(client, system["id"], selected_frameworks=["nist_ai_rmf"])

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/metric-plan")

    assert response.status_code == 200
    plan = response.json()
    metric_ids = [metric["metric_id"] for metric in plan["metrics"]]
    assert universal["metric_id"] in metric_ids
    assert "M41" not in metric_ids


def test_metric_plan_includes_capability_gated_metric_when_system_has_it(
    client: TestClient,
) -> None:
    system = create_system(client, "Retrieval System")
    add_capability(client, system["id"], capability_type="retrieval")
    gated = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": "M42",
            "name": "Retrieval only metric",
            "dimension": "Retrieval",
            "primary_agent": "orchestrator",
            "tool_name": "ragas",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.9},
            "scoring_config": {"direction": "higher_is_better"},
            "applicable_capability_types": ["retrieval"],
            "enabled": True,
        },
    )
    assert gated.status_code == 201
    create_mapping(client, "MAP-42", metric_ids=["M42"])
    run = create_run(client, system["id"], selected_frameworks=["nist_ai_rmf"])

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/metric-plan")

    assert response.status_code == 200
    plan = response.json()
    metric_ids = [metric["metric_id"] for metric in plan["metrics"]]
    assert "M42" in metric_ids


def test_metric_plan_explicit_selected_metrics_bypasses_capability_filter(
    client: TestClient,
) -> None:
    system = create_system(client, "Explicit Override System")
    gated = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": "M43",
            "name": "Retrieval only metric",
            "dimension": "Retrieval",
            "primary_agent": "orchestrator",
            "tool_name": "ragas",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.9},
            "scoring_config": {"direction": "higher_is_better"},
            "applicable_capability_types": ["retrieval"],
            "enabled": True,
        },
    )
    assert gated.status_code == 201
    create_mapping(client, "MAP-43", metric_ids=["M43"])
    run = create_run(
        client,
        system["id"],
        selected_frameworks=["nist_ai_rmf"],
        selected_metrics=["M43"],
    )

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/metric-plan")

    assert response.status_code == 200
    plan = response.json()
    assert [metric["metric_id"] for metric in plan["metrics"]] == ["M43"]
