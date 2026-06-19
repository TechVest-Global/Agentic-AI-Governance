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


def create_capability(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={
            "name": "answer_question",
            "capability_type": "generation",
            "endpoint_ref": "/api/answer",
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


def create_evidence(client: TestClient, run_id: str, capability_id: str) -> dict[str, object]:
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/evidence",
        json={
            "ai_system_capability_id": capability_id,
            "source_type": "tool",
            "source_name": "promptfoo",
            "payload": {"case_id": "tc-001"},
        },
    )
    assert response.status_code == 201
    return response.json()


def test_finding_can_be_created_listed_filtered_and_retrieved(
    client: TestClient,
) -> None:
    system = create_system(client, "Finding System")
    capability = create_capability(client, system["id"])
    run = create_run(client, system["id"])
    evidence = create_evidence(client, run["id"], capability["id"])
    findings_url = f"/api/v1/evaluation-runs/{run['id']}/findings"

    create_response = client.post(
        findings_url,
        json={
            "ai_system_capability_id": capability["id"],
            "finding_type": "quality",
            "title": "Answer missed required element",
            "summary": "The response omitted the escalation policy.",
            "severity": "medium",
            "confidence": 0.82,
            "dimension": "Task Fulfilment",
            "framework_refs": ["nist_ai_rmf:map-1"],
            "evidence_ids": [evidence["id"]],
            "agent_name": "explainability_agent",
            "recommended_action": "Add escalation policy coverage to the prompt.",
            "payload": {"missing_element": "escalation_policy"},
        },
    )

    assert create_response.status_code == 201
    finding = create_response.json()
    assert finding["run_id"] == run["id"]
    assert finding["status"] == "open"
    assert finding["ai_system_capability_id"] == capability["id"]
    assert finding["evidence_ids"] == [evidence["id"]]

    filter_response = client.get(
        findings_url,
        params={
            "severity": "medium",
            "agent_name": "explainability_agent",
            "ai_system_capability_id": capability["id"],
        },
    )
    assert filter_response.status_code == 200
    assert [item["id"] for item in filter_response.json()] == [finding["id"]]

    get_response = client.get(f"{findings_url}/{finding['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == finding


def test_finding_rejects_evidence_from_another_run(client: TestClient) -> None:
    first_system = create_system(client, "First")
    second_system = create_system(client, "Second")
    first_capability = create_capability(client, first_system["id"])
    second_capability = create_capability(client, second_system["id"])
    first_run = create_run(client, first_system["id"])
    second_run = create_run(client, second_system["id"])
    second_evidence = create_evidence(client, second_run["id"], second_capability["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{first_run['id']}/findings",
        json={
            "ai_system_capability_id": first_capability["id"],
            "finding_type": "quality",
            "title": "Cross-run evidence",
            "summary": "This should fail.",
            "dimension": "Task Fulfilment",
            "evidence_ids": [second_evidence["id"]],
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evidence record",
        "id": second_evidence["id"],
    }


def test_finding_rejects_capability_from_another_system(client: TestClient) -> None:
    first_system = create_system(client, "First Capability System")
    second_system = create_system(client, "Second Capability System")
    capability = create_capability(client, second_system["id"])
    run = create_run(client, first_system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        json={
            "ai_system_capability_id": capability["id"],
            "finding_type": "quality",
            "title": "Wrong capability",
            "summary": "This should fail.",
            "dimension": "Task Fulfilment",
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "AI system capability",
        "id": capability["id"],
    }


def test_finding_requires_existing_run(client: TestClient) -> None:
    response = client.post(
        f"/api/v1/evaluation-runs/{uuid4()}/findings",
        json={
            "finding_type": "quality",
            "title": "Missing run",
            "summary": "This should fail.",
            "dimension": "Task Fulfilment",
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"
