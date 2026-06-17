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


def create_capability(
    client: TestClient,
    system_id: str,
    name: str = "answer_question",
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={
            "name": name,
            "capability_type": "generation",
            "endpoint_ref": f"/api/{name}",
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_metrics": ["M01"]},
    )
    assert response.status_code == 201
    return response.json()


def test_evidence_can_be_created_listed_filtered_and_retrieved(
    client: TestClient,
) -> None:
    system = create_system(client, "Evidence System")
    capability = create_capability(client, system["id"])
    run = create_run(client, system["id"])
    evidence_url = f"/api/v1/evaluation-runs/{run['id']}/evidence"

    create_response = client.post(
        evidence_url,
        json={
            "ai_system_capability_id": capability["id"],
            "source_type": "tool",
            "source_name": "promptfoo",
            "tool_name": "promptfoo",
            "tool_version": "0.1",
            "raw_score": 0.92,
            "normalized_score": 0.92,
            "threshold": 0.9,
            "passed": True,
            "trace_id": "trace-001",
            "payload": {"case_id": "tc-001"},
        },
    )

    assert create_response.status_code == 201
    evidence = create_response.json()
    assert evidence["run_id"] == run["id"]
    assert evidence["ai_system_capability_id"] == capability["id"]
    assert evidence["sensitivity"] == "internal"

    filter_response = client.get(
        evidence_url,
        params={
            "source_type": "tool",
            "ai_system_capability_id": capability["id"],
        },
    )
    assert filter_response.status_code == 200
    assert [item["id"] for item in filter_response.json()] == [evidence["id"]]

    get_response = client.get(f"{evidence_url}/{evidence['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == evidence


def test_metric_result_can_link_to_evidence_and_capability(
    client: TestClient,
) -> None:
    system = create_system(client, "Metric System")
    capability = create_capability(client, system["id"])
    run = create_run(client, system["id"])
    base_url = f"/api/v1/evaluation-runs/{run['id']}"
    evidence = client.post(
        f"{base_url}/evidence",
        json={
            "ai_system_capability_id": capability["id"],
            "source_type": "tool",
            "source_name": "deepeval",
            "payload": {"prompt": "Summarize policy."},
        },
    ).json()

    create_response = client.post(
        f"{base_url}/metric-results",
        json={
            "ai_system_capability_id": capability["id"],
            "metric_id": "M01",
            "dimension": "Task Fulfilment",
            "tool_name": "deepeval",
            "status": "passed",
            "raw_score": 0.97,
            "normalized_score": 0.97,
            "threshold": 0.9,
            "passed": True,
            "evidence_ids": [evidence["id"]],
        },
    )

    assert create_response.status_code == 201
    metric_result = create_response.json()
    assert metric_result["evidence_ids"] == [evidence["id"]]
    assert metric_result["ai_system_capability_id"] == capability["id"]

    list_response = client.get(
        f"{base_url}/metric-results",
        params={"metric_id": "M01", "status": "passed"},
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [metric_result["id"]]

    get_response = client.get(f"{base_url}/metric-results/{metric_result['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == metric_result


def test_evidence_rejects_capability_from_another_system(client: TestClient) -> None:
    first_system = create_system(client, "First")
    second_system = create_system(client, "Second")
    capability = create_capability(client, second_system["id"])
    run = create_run(client, first_system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/evidence",
        json={
            "ai_system_capability_id": capability["id"],
            "source_type": "tool",
            "source_name": "promptfoo",
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "AI system capability",
        "id": capability["id"],
    }


def test_metric_result_rejects_evidence_from_another_run(client: TestClient) -> None:
    first_system = create_system(client, "First Run System")
    second_system = create_system(client, "Second Run System")
    first_run = create_run(client, first_system["id"])
    second_run = create_run(client, second_system["id"])
    evidence = client.post(
        f"/api/v1/evaluation-runs/{second_run['id']}/evidence",
        json={"source_type": "tool", "source_name": "promptfoo"},
    ).json()

    response = client.post(
        f"/api/v1/evaluation-runs/{first_run['id']}/metric-results",
        json={
            "metric_id": "M01",
            "dimension": "Task Fulfilment",
            "tool_name": "promptfoo",
            "evidence_ids": [evidence["id"]],
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evidence record",
        "id": evidence["id"],
    }


def test_evidence_requires_existing_run(client: TestClient) -> None:
    response = client.post(
        f"/api/v1/evaluation-runs/{uuid4()}/evidence",
        json={"source_type": "tool", "source_name": "promptfoo"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"
