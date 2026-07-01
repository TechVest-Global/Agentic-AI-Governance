from uuid import uuid4

from fastapi.testclient import TestClient


def system_payload(name: str = "TechVest Support Chatbot") -> dict[str, object]:
    return {
        "name": name,
        "description": "Internal employee support assistant",
        "owner": "AI Governance",
        "system_type": "chatbot",
        "risk_tier": "medium",
        "deployment_environment": "production",
        "selected_frameworks": ["nist_ai_rmf", "owasp_llm_top_10"],
        "model_provider": "azure_foundry",
        "model_name": "support-assistant",
        "model_version": "v1",
        "target_endpoint_ref": "config://targets/support-chatbot",
    }


def test_create_list_and_get_ai_system(client: TestClient) -> None:
    create_response = client.post("/api/v1/ai-systems", json=system_payload())

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "TechVest Support Chatbot"
    assert created["status"] == "registered"
    assert created["risk_tier"] == "medium"

    list_response = client.get("/api/v1/ai-systems")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [created["id"]]

    get_response = client.get(f"/api/v1/ai-systems/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == created


def test_ai_system_input_is_trimmed_and_validated(client: TestClient) -> None:
    payload = system_payload()
    payload["name"] = "  Trimmed Name  "
    payload["owner"] = "   "

    response = client.post("/api/v1/ai-systems", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_update_ai_system_changes_registry_fields(client: TestClient) -> None:
    created = client.post("/api/v1/ai-systems", json=system_payload()).json()

    response = client.patch(
        f"/api/v1/ai-systems/{created['id']}",
        json={
            "name": "Updated Assistant",
            "owner": "Audit Office",
            "risk_tier": "high",
            "selected_frameworks": ["eu_ai_act", "nist_ai_rmf"],
            "metadata_json": {"domain": "Legal", "daily_active_users": "250"},
        },
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["name"] == "Updated Assistant"
    assert updated["owner"] == "Audit Office"
    assert updated["risk_tier"] == "high"
    assert updated["selected_frameworks"] == ["eu_ai_act", "nist_ai_rmf"]
    assert updated["metadata_json"]["domain"] == "Legal"
    assert updated["updated_at"] is not None


def test_delete_ai_system_archives_and_hides_from_registry(client: TestClient) -> None:
    created = client.post("/api/v1/ai-systems", json=system_payload()).json()

    delete_response = client.delete(f"/api/v1/ai-systems/{created['id']}")

    assert delete_response.status_code == 204
    list_response = client.get("/api/v1/ai-systems")
    assert list_response.status_code == 200
    assert list_response.json() == []

    get_response = client.get(f"/api/v1/ai-systems/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["status"] == "archived"


def test_missing_ai_system_uses_domain_error_shape(client: TestClient) -> None:
    system_id = uuid4()

    response = client.get(f"/api/v1/ai-systems/{system_id}")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "RESOURCE_NOT_FOUND",
            "message": "AI system was not found.",
            "details": {"resource": "AI system", "id": str(system_id)},
        }
    }


def test_context_profile_is_created_then_replaced(client: TestClient) -> None:
    system = client.post("/api/v1/ai-systems", json=system_payload()).json()
    profile_url = f"/api/v1/ai-systems/{system['id']}/context-profile"
    initial_payload = {
        "identity_purpose": {"business_domain": "internal_operations"},
        "pre_model_controls": {"pii_handling": "redact"},
        "model_configuration": {"provider": "azure_foundry"},
        "post_model_controls": {"human_review": True},
        "integration_context": {"rollback": "manual"},
    }

    create_response = client.put(profile_url, json=initial_payload)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["identity_purpose"] == initial_payload["identity_purpose"]

    replacement_payload = {
        **initial_payload,
        "identity_purpose": {"business_domain": "customer_support"},
    }
    update_response = client.put(profile_url, json=replacement_payload)
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["id"] == created["id"]
    assert updated["identity_purpose"] == replacement_payload["identity_purpose"]
    assert updated["updated_at"] is not None

    get_response = client.get(profile_url)
    assert get_response.status_code == 200
    assert get_response.json() == updated


def test_context_profile_requires_an_existing_system(client: TestClient) -> None:
    response = client.put(
        f"/api/v1/ai-systems/{uuid4()}/context-profile",
        json={
            "identity_purpose": {},
            "pre_model_controls": {},
            "model_configuration": {},
            "post_model_controls": {},
            "integration_context": {},
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_context_profile_requires_all_five_sections(client: TestClient) -> None:
    system = client.post("/api/v1/ai-systems", json=system_payload()).json()

    response = client.put(
        f"/api/v1/ai-systems/{system['id']}/context-profile",
        json={"identity_purpose": {}},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def capability_payload(name: str, *, enabled: bool = True) -> dict[str, object]:
    return {
        "name": name,
        "description": f"Capability for {name}",
        "capability_type": "action",
        "endpoint_ref": f"/api/{name}",
        "http_method": "post",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        },
        "output_schema": {"type": "object"},
        "permissions": ["support:write"],
        "side_effect_level": "write",
        "requires_human_review": True,
        "enabled": enabled,
    }


def test_system_supports_multiple_capabilities(client: TestClient) -> None:
    system = client.post("/api/v1/ai-systems", json=system_payload()).json()
    url = f"/api/v1/ai-systems/{system['id']}/capabilities"

    answer_response = client.post(url, json=capability_payload("answer_question"))
    ticket_response = client.post(url, json=capability_payload("create_ticket"))

    assert answer_response.status_code == 201
    assert ticket_response.status_code == 201
    answer = answer_response.json()
    ticket = ticket_response.json()
    assert answer["http_method"] == "POST"
    assert answer["ai_system_id"] == system["id"]
    assert ticket["id"] != answer["id"]

    list_response = client.get(url)
    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == [
        "answer_question",
        "create_ticket",
    ]

    get_response = client.get(f"{url}/{ticket['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == ticket


def test_capability_list_can_filter_enabled_state(client: TestClient) -> None:
    system = client.post("/api/v1/ai-systems", json=system_payload()).json()
    url = f"/api/v1/ai-systems/{system['id']}/capabilities"
    client.post(url, json=capability_payload("enabled_capability"))
    client.post(url, json=capability_payload("disabled_capability", enabled=False))

    response = client.get(url, params={"enabled": False})

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["disabled_capability"]


def test_duplicate_capability_name_returns_conflict(client: TestClient) -> None:
    system = client.post("/api/v1/ai-systems", json=system_payload()).json()
    url = f"/api/v1/ai-systems/{system['id']}/capabilities"
    payload = capability_payload("create_ticket")
    assert client.post(url, json=payload).status_code == 201

    response = client.post(url, json=payload)

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "RESOURCE_CONFLICT",
        "message": "AI system capability already exists.",
        "details": {
            "resource": "AI system capability",
            "field": "name",
            "value": "create_ticket",
        },
    }


def test_capability_is_scoped_to_its_parent_system(client: TestClient) -> None:
    first_system = client.post("/api/v1/ai-systems", json=system_payload("First")).json()
    second_system = client.post("/api/v1/ai-systems", json=system_payload("Second")).json()
    capability = client.post(
        f"/api/v1/ai-systems/{first_system['id']}/capabilities",
        json=capability_payload("search_documents"),
    ).json()

    response = client.get(
        f"/api/v1/ai-systems/{second_system['id']}/capabilities/{capability['id']}"
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_capability_requires_existing_system(client: TestClient) -> None:
    response = client.post(
        f"/api/v1/ai-systems/{uuid4()}/capabilities",
        json=capability_payload("answer_question"),
    )

    assert response.status_code == 404

