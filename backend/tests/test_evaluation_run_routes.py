from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient, name: str = "System") -> dict[str, object]:
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


def test_create_list_filter_and_get_evaluation_run(client: TestClient) -> None:
    first_system = create_system(client, "First System")
    second_system = create_system(client, "Second System")

    first_response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": first_system["id"],
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["CM-001"],
            "created_by": "prakriti",
        },
    )
    second_response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": second_system["id"]},
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first_run = first_response.json()
    assert first_run["status"] == "created"
    assert first_run["current_phase"] == "created"

    list_response = client.get("/api/v1/evaluation-runs")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 2

    filter_response = client.get(
        "/api/v1/evaluation-runs",
        params={"ai_system_id": first_system["id"]},
    )
    assert filter_response.status_code == 200
    assert [item["id"] for item in filter_response.json()] == [first_run["id"]]

    get_response = client.get(f"/api/v1/evaluation-runs/{first_run['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == first_run


def test_evaluation_run_requires_an_existing_ai_system(client: TestClient) -> None:
    system_id = uuid4()

    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": str(system_id)},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "AI system",
        "id": str(system_id),
    }


def test_missing_evaluation_run_uses_domain_error_shape(client: TestClient) -> None:
    response = client.get(f"/api/v1/evaluation-runs/{uuid4()}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_list_pagination_is_validated(client: TestClient) -> None:
    response = client.get("/api/v1/evaluation-runs", params={"limit": 101})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_evaluation_run_can_be_started(client: TestClient) -> None:
    system = create_system(client, "Startable System")
    run = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system["id"]},
    ).json()

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/start",
        json={"note": "Context assembly begins."},
    )

    assert response.status_code == 200
    started = response.json()
    assert started["status"] == "context_assembly"
    assert started["current_phase"] == "context_assembly"
    assert started["started_at"] is not None
    assert started["result_summary"] == {"start_note": "Context assembly begins."}


def test_evaluation_run_can_be_completed(client: TestClient) -> None:
    system = create_system(client, "Completable System")
    run = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system["id"]},
    ).json()

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/complete",
        json={"result_summary": {"verdict": "approved"}},
    )

    assert response.status_code == 200
    completed = response.json()
    assert completed["status"] == "completed"
    assert completed["current_phase"] == "action_reporting"
    assert completed["started_at"] is not None
    assert completed["completed_at"] is not None
    assert completed["result_summary"] == {"verdict": "approved"}


def test_evaluation_run_can_be_failed(client: TestClient) -> None:
    system = create_system(client, "Failing System")
    run = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system["id"]},
    ).json()

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/fail",
        json={"error_summary": {"reason": "tool timeout"}},
    )

    assert response.status_code == 200
    failed = response.json()
    assert failed["status"] == "failed"
    assert failed["started_at"] is not None
    assert failed["completed_at"] is not None
    assert failed["error_summary"] == {"reason": "tool timeout"}


def test_evaluation_run_can_be_cancelled(client: TestClient) -> None:
    system = create_system(client, "Cancelled System")
    run = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system["id"]},
    ).json()

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/cancel",
        json={"reason": "duplicate request"},
    )

    assert response.status_code == 200
    cancelled = response.json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["completed_at"] is not None
    assert cancelled["error_summary"] == {"reason": "duplicate request"}


def test_terminal_evaluation_run_rejects_later_transition(
    client: TestClient,
) -> None:
    system = create_system(client, "Terminal System")
    run = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system["id"]},
    ).json()
    assert (
        client.post(
            f"/api/v1/evaluation-runs/{run['id']}/complete",
            json={},
        ).status_code
        == 200
    )

    response = client.post(f"/api/v1/evaluation-runs/{run['id']}/start", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_RUN_TRANSITION"
    assert response.json()["error"]["details"]["current_status"] == "completed"
