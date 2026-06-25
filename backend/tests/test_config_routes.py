from uuid import uuid4

from fastapi.testclient import TestClient


def metric_payload(
    metric_id: str = "M01",
    *,
    enabled: bool = True,
) -> dict[str, object]:
    return {
        "metric_id": metric_id,
        "name": "Task success rate",
        "description": "Measures whether the application capability completes the task.",
        "dimension": "Task Fulfilment",
        "primary_agent": "orchestrator",
        "tool_name": "promptfoo",
        "framework_ids": ["nist_ai_rmf", "iso_42001"],
        "modality": "text",
        "threshold_rules": {"medium_risk_minimum": 0.9},
        "scoring_config": {"direction": "higher_is_better"},
        "version": "v1",
        "enabled": enabled,
    }


def framework_mapping_payload(
    control_ref: str = "MAP-1",
    *,
    enabled: bool = True,
) -> dict[str, object]:
    return {
        "framework_id": "nist_ai_rmf",
        "framework_name": "NIST AI RMF",
        "framework_version": "1.0",
        "control_ref": control_ref,
        "control_title": "Context is established",
        "control_category": "map",
        "jurisdiction": "US",
        "requirement_text": "The system context should be documented.",
        "metric_ids": ["M01", "M02"],
        "agent_names": ["orchestrator", "explainability_agent"],
        "risk_tiers": ["medium", "high"],
        "evidence_requirements": ["metric_result", "state_entry"],
        "enabled": enabled,
    }


def test_default_governance_configs_can_be_bootstrapped_idempotently(
    client: TestClient,
) -> None:
    first_response = client.post("/api/v1/governance-config/bootstrap")

    assert first_response.status_code == 200
    first_result = first_response.json()
    assert first_result["metrics_created"] == 44
    assert first_result["metrics_skipped"] == 0
    assert first_result["framework_mappings_created"] == 5
    assert first_result["framework_mappings_skipped"] == 0
    assert "CM-001" in first_result["metric_ids_created"]
    assert "CM-026" in first_result["metric_ids_created"]
    assert "nist_ai_rmf/1.0/MANAGE-1" in first_result["control_refs_created"]

    second_response = client.post("/api/v1/governance-config/bootstrap")

    assert second_response.status_code == 200
    second_result = second_response.json()
    assert second_result["metrics_created"] == 0
    assert second_result["metrics_skipped"] == 44
    assert second_result["framework_mappings_created"] == 0
    assert second_result["framework_mappings_skipped"] == 5

    metric_response = client.get(
        "/api/v1/metrics",
        params={"framework_id": "nist_ai_rmf", "primary_agent": "misuse_agent"},
    )
    assert metric_response.status_code == 200
    misuse_ids = [m["metric_id"] for m in metric_response.json()]
    assert "CM-026" in misuse_ids  # jailbreak — security/nist_ai_rmf
    assert "CM-022" in misuse_ids  # pii leakage — privacy/nist_ai_rmf

    mapping_response = client.get(
        "/api/v1/framework-mappings",
        params={"framework_id": "nist_ai_rmf", "metric_id": "CM-026"},
    )
    assert mapping_response.status_code == 200
    assert [mapping["control_ref"] for mapping in mapping_response.json()] == [
        "GOVERN-1",
        "MANAGE-1",
        "MAP-1",
        "MEASURE-1",
    ]


def test_metric_config_can_be_created_listed_filtered_and_retrieved(
    client: TestClient,
) -> None:
    first_response = client.post("/api/v1/metrics", json=metric_payload("M01"))
    second_response = client.post(
        "/api/v1/metrics",
        json=metric_payload("M02", enabled=False),
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first_metric = first_response.json()
    assert first_metric["metric_id"] == "M01"
    assert first_metric["framework_ids"] == ["nist_ai_rmf", "iso_42001"]

    list_response = client.get(
        "/api/v1/metrics",
        params={
            "framework_id": "nist_ai_rmf",
            "dimension": "Task Fulfilment",
            "primary_agent": "orchestrator",
        },
    )
    assert list_response.status_code == 200
    assert [item["metric_id"] for item in list_response.json()] == ["M01"]

    disabled_response = client.get("/api/v1/metrics", params={"enabled": False})
    assert disabled_response.status_code == 200
    assert [item["metric_id"] for item in disabled_response.json()] == ["M02"]

    get_response = client.get(f"/api/v1/metrics/{first_metric['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == first_metric


def test_metric_config_rejects_duplicate_metric_id_and_version(
    client: TestClient,
) -> None:
    payload = metric_payload("DUPLICATE")
    assert client.post("/api/v1/metrics", json=payload).status_code == 201

    response = client.post("/api/v1/metrics", json=payload)

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {
        "resource": "Metric config",
        "field": "metric_id/version",
        "value": "DUPLICATE/v1",
    }


def test_missing_metric_config_returns_not_found(client: TestClient) -> None:
    metric_config_id = uuid4()

    response = client.get(f"/api/v1/metrics/{metric_config_id}")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Metric config",
        "id": str(metric_config_id),
    }


def test_framework_mapping_can_be_created_listed_filtered_and_retrieved(
    client: TestClient,
) -> None:
    first_response = client.post(
        "/api/v1/framework-mappings",
        json=framework_mapping_payload("MAP-1"),
    )
    second_response = client.post(
        "/api/v1/framework-mappings",
        json=framework_mapping_payload("GOV-1", enabled=False),
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first_mapping = first_response.json()
    assert first_mapping["control_ref"] == "MAP-1"
    assert first_mapping["metric_ids"] == ["M01", "M02"]

    list_response = client.get(
        "/api/v1/framework-mappings",
        params={
            "framework_id": "nist_ai_rmf",
            "framework_version": "1.0",
            "control_category": "map",
            "risk_tier": "high",
            "metric_id": "M01",
        },
    )
    assert list_response.status_code == 200
    assert [item["control_ref"] for item in list_response.json()] == ["MAP-1"]

    disabled_response = client.get(
        "/api/v1/framework-mappings",
        params={"enabled": False},
    )
    assert disabled_response.status_code == 200
    assert [item["control_ref"] for item in disabled_response.json()] == ["GOV-1"]

    get_response = client.get(
        f"/api/v1/framework-mappings/{first_mapping['id']}"
    )
    assert get_response.status_code == 200
    assert get_response.json() == first_mapping


def test_framework_mapping_rejects_duplicate_control_for_same_framework(
    client: TestClient,
) -> None:
    payload = framework_mapping_payload("MAP-DUPLICATE")
    assert client.post("/api/v1/framework-mappings", json=payload).status_code == 201

    response = client.post("/api/v1/framework-mappings", json=payload)

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {
        "resource": "Framework mapping",
        "field": "framework/control",
        "value": "nist_ai_rmf/1.0/MAP-DUPLICATE",
    }


def test_missing_framework_mapping_returns_not_found(client: TestClient) -> None:
    framework_mapping_id = uuid4()

    response = client.get(f"/api/v1/framework-mappings/{framework_mapping_id}")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Framework mapping",
        "id": str(framework_mapping_id),
    }
