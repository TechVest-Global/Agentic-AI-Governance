from uuid import uuid4

from fastapi.testclient import TestClient


def _create_system(client: TestClient, name: str = "Endpoint Test System") -> str:
    payload = {
        "name": name,
        "description": "System under test",
        "owner": "AI Governance",
        "system_type": "chatbot",
        "risk_tier": "medium",
        "deployment_environment": "production",
        "selected_frameworks": ["nist_ai_rmf"],
        "model_provider": "azure_foundry",
    }
    response = client.post("/api/v1/ai-systems", json=payload)
    assert response.status_code == 201
    return response.json()["id"]


def _endpoint_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "prod-us",
        "environment": "production",
        "url": "https://api.example.com/chat",
    }
    payload.update(overrides)
    return payload


def test_create_and_list_target_endpoint(client: TestClient) -> None:
    system_id = _create_system(client)

    create = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(),
    )
    assert create.status_code == 201
    body = create.json()
    assert body["name"] == "prod-us"
    assert body["url"] == "https://api.example.com/chat"
    # First endpoint becomes the default automatically.
    assert body["is_default"] is True
    assert body["has_secret"] is False

    listing = client.get(f"/api/v1/ai-systems/{system_id}/target-endpoints")
    assert listing.status_code == 200
    assert [e["id"] for e in listing.json()] == [body["id"]]


def test_secret_is_encrypted_and_never_returned(client: TestClient) -> None:
    system_id = _create_system(client)

    create = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(secret="super-secret-key"),
    )
    assert create.status_code == 201
    body = create.json()
    # The plaintext (or a ciphertext field) is never present in the response.
    assert "secret" not in body
    assert "secret_ciphertext" not in body
    assert body["has_secret"] is True
    assert "super-secret-key" not in create.text


def test_url_must_be_http(client: TestClient) -> None:
    system_id = _create_system(client)
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(url="ftp://nope"),
    )
    assert response.status_code == 422


def test_duplicate_endpoint_name_conflicts(client: TestClient) -> None:
    system_id = _create_system(client)
    first = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints", json=_endpoint_payload()
    )
    assert first.status_code == 201
    dupe = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints", json=_endpoint_payload()
    )
    assert dupe.status_code == 409


def test_setting_a_new_default_unsets_the_previous_one(client: TestClient) -> None:
    system_id = _create_system(client)
    first = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(name="prod"),
    ).json()
    second = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(name="staging", url="https://staging.example.com"),
    ).json()

    assert first["is_default"] is True
    assert second["is_default"] is False

    promote = client.patch(
        f"/api/v1/ai-systems/{system_id}/target-endpoints/{second['id']}",
        json={"is_default": True},
    )
    assert promote.status_code == 200
    assert promote.json()["is_default"] is True

    refreshed = {e["id"]: e for e in client.get(
        f"/api/v1/ai-systems/{system_id}/target-endpoints"
    ).json()}
    assert refreshed[first["id"]]["is_default"] is False
    assert refreshed[second["id"]]["is_default"] is True


def test_deleting_default_promotes_another(client: TestClient) -> None:
    system_id = _create_system(client)
    first = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(name="prod"),
    ).json()
    second = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(name="staging", url="https://staging.example.com"),
    ).json()

    delete = client.delete(
        f"/api/v1/ai-systems/{system_id}/target-endpoints/{first['id']}"
    )
    assert delete.status_code == 204

    remaining = client.get(f"/api/v1/ai-systems/{system_id}/target-endpoints").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == second["id"]
    assert remaining[0]["is_default"] is True


def test_update_clears_secret_with_empty_string(client: TestClient) -> None:
    system_id = _create_system(client)
    created = client.post(
        f"/api/v1/ai-systems/{system_id}/target-endpoints",
        json=_endpoint_payload(secret="a-key"),
    ).json()
    assert created["has_secret"] is True

    # Omitting the secret leaves it unchanged.
    unchanged = client.patch(
        f"/api/v1/ai-systems/{system_id}/target-endpoints/{created['id']}",
        json={"environment": "staging"},
    ).json()
    assert unchanged["has_secret"] is True

    # Empty string clears it.
    cleared = client.patch(
        f"/api/v1/ai-systems/{system_id}/target-endpoints/{created['id']}",
        json={"secret": ""},
    ).json()
    assert cleared["has_secret"] is False


def test_endpoints_scoped_to_system(client: TestClient) -> None:
    system_id = _create_system(client)
    missing = client.get(
        f"/api/v1/ai-systems/{system_id}/target-endpoints/{uuid4()}"
    )
    assert missing.status_code == 404


def test_create_endpoint_for_unknown_system_404(client: TestClient) -> None:
    response = client.post(
        f"/api/v1/ai-systems/{uuid4()}/target-endpoints", json=_endpoint_payload()
    )
    assert response.status_code == 404
