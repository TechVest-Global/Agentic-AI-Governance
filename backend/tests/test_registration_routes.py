"""End-to-end tests for the enhanced AI system registration flow."""

from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient

BASE = "/api/v1/ai-systems"


def full_payload(name: str = "TechVest Support Assistant") -> dict[str, object]:
    return {
        "status": "registered",
        "system": {
            "name": name,
            "version": "v1",
            "description": "Internal RAG assistant for employee support.",
            "business_purpose": "Reduce support handling time.",
            "system_type": "rag_application",
            "business_domain": "customer_support",
            "lifecycle_stage": "production",
            "deployment_environment": "production",
            "modality": "text",
            "production_criticality": "high",
        },
        "usage_context": {
            "primary_use_case": "Answer employee HR/IT questions.",
            "intended_users": "Internal employees",
            "internal_external_use": "internal_employees",
            "output_usage": "informational_only",
            "human_oversight": "human_can_override",
            "input_modalities": ["text"],
            "output_types": ["text"],
            "capabilities": ["question_answering", "summarization"],
        },
        "owners": [
            {
                "role": "system_owner",
                "name": "Alice Owner",
                "email": "alice@example.com",
                "is_primary": True,
            },
            {
                "role": "technical_owner",
                "name": "Bob Tech",
                "email": "bob@example.com",
            },
        ],
        "models": [
            {
                "name": "gpt-4o",
                "provider": "azure_openai",
                "model_type": "llm",
                "purpose": "Generation",
            },
        ],
        "endpoints": [
            {
                "name": "Chat",
                "url": "https://api.example.com/chat",
                "http_method": "post",
                "environment": "production",
                "model_ref": "gpt-4o",
                "gateway_type": "litellm",
                "authentication_type": "api_key",
                "exposure_type": "internal",
                "status": "active",
            },
        ],
        "frameworks": [
            {"framework_id": "nist_ai_rmf", "applicability_type": "mandatory"},
            {"framework_id": "eu_ai_act", "applicability_type": "voluntary"},
        ],
        "risk_screening": {
            "answers": {
                "processes_personal_data": "yes",
                "used_in_safety_critical": "no",
            }
        },
    }


def test_register_draft_with_only_name(client: TestClient) -> None:
    response = client.post(
        BASE + "/register", json={"status": "draft", "system": {"name": "Draft Sys"}}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["registration_status"] == "draft"
    assert body["system"]["name"] == "Draft Sys"
    assert body["capabilities"] == []
    assert body["preliminary_risk_tier"] == "unassessed"
    # Appears in the registry list.
    listed = client.get(BASE).json()
    assert body["system"]["id"] in [item["id"] for item in listed]


def test_register_valid_full_payload(client: TestClient) -> None:
    response = client.post(BASE + "/register", json=full_payload())
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["registration_status"] == "registered"
    assert len(body["owners"]) == 2
    assert len(body["models"]) == 1
    assert len(body["endpoints"]) == 1
    assert len(body["frameworks"]) == 2
    # One engine-facing capability auto-created per endpoint.
    assert len(body["capabilities"]) == 1
    assert body["capabilities"][0]["endpoint_ref"] == "https://api.example.com/chat"
    # Endpoint wired to the referenced model.
    assert body["endpoints"][0]["model_id"] == body["models"][0]["id"]
    # Frameworks kept in sync on the engine-facing system record.
    assert set(body["system"]["selected_frameworks"]) == {"nist_ai_rmf", "eu_ai_act"}
    # Preliminary risk present + engine risk_tier valid (3-value enum).
    assert body["preliminary_risk_tier"] in {"low", "medium", "high", "critical"}
    assert body["system"]["risk_tier"] in {"low", "medium", "high"}
    assert 0 < body["profile_completeness"] <= 100


def test_register_rejects_missing_required(client: TestClient) -> None:
    response = client.post(
        BASE + "/register", json={"status": "registered", "system": {"name": "Incomplete"}}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_dev_registration_without_endpoint_ok(client: TestClient) -> None:
    payload = deepcopy(full_payload("Dev Sandbox Assistant"))
    payload["system"]["lifecycle_stage"] = "development"
    payload["system"]["deployment_environment"] = "development"
    payload["endpoints"] = []
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["endpoints"] == []


def test_production_registration_without_endpoint_fails(client: TestClient) -> None:
    payload = deepcopy(full_payload("Prod No Endpoint"))
    payload["endpoints"] = []
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_multiple_models_and_endpoints_persist(client: TestClient) -> None:
    payload = deepcopy(full_payload("Multi Model System"))
    payload["models"] = [
        {"name": "gpt-4o", "provider": "azure_openai", "model_type": "llm"},
        {"name": "embedder", "provider": "openai", "model_type": "embedding"},
    ]
    payload["endpoints"] = [
        {
            "name": "Chat",
            "url": "https://api.example.com/chat",
            "http_method": "POST",
            "model_ref": "gpt-4o",
            "status": "active",
        },
        {
            "name": "Embed",
            "url": "https://api.example.com/embed",
            "http_method": "POST",
            "status": "active",
        },
    ]
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["models"]) == 2
    assert len(body["endpoints"]) == 2
    assert len(body["capabilities"]) == 2
    model_by_name = {m["name"]: m["id"] for m in body["models"]}
    endpoint_by_name = {e["name"]: e for e in body["endpoints"]}
    assert endpoint_by_name["Chat"]["model_id"] == model_by_name["gpt-4o"]
    assert endpoint_by_name["Embed"]["model_id"] is None


def test_unknown_framework_rejected(client: TestClient) -> None:
    before = len(client.get(BASE).json())
    payload = deepcopy(full_payload("Bad Framework System"))
    payload["frameworks"] = [{"framework_id": "totally_made_up", "applicability_type": "unsure"}]
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    # Fail-fast: no partial system created.
    assert len(client.get(BASE).json()) == before


def test_preliminary_tier_computed_and_clamped(client: TestClient) -> None:
    payload = deepcopy(full_payload("Safety Critical System"))
    payload["risk_screening"] = {"answers": {"used_in_safety_critical": "yes"}}
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["preliminary_risk_tier"] == "critical"
    # critical folds down to high on the 3-value engine tier.
    assert body["system"]["risk_tier"] == "high"


def test_transaction_rolls_back_on_child_failure(client: TestClient) -> None:
    before = len(client.get(BASE).json())
    payload = deepcopy(full_payload("Duplicate Model System"))
    # Two models with the same name violate UniqueConstraint(ai_system_id, name)
    # at commit -> the whole transaction (including the parent system) rolls back.
    payload["models"] = [
        {"name": "dup", "provider": "openai"},
        {"name": "dup", "provider": "openai"},
    ]
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 409
    assert len(client.get(BASE).json()) == before


def test_registration_detail_get(client: TestClient) -> None:
    created = client.post(BASE + "/register", json=full_payload("Detail System")).json()
    system_id = created["system"]["id"]
    response = client.get(f"{BASE}/{system_id}/registration")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["system"]["id"] == system_id
    assert len(body["owners"]) == 2
    assert body["risk_screening"] is not None


def test_registration_detail_not_found(client: TestClient) -> None:
    response = client.get(f"{BASE}/{uuid4()}/registration")
    assert response.status_code == 404


def test_phase2_sections_persist(client: TestClient) -> None:
    payload = deepcopy(full_payload("Phase2 System"))
    payload["data_sources"] = [
        {
            "name": "Knowledge Base",
            "source_type": "vector_database",
            "classification": "confidential",
            "usage_purpose": "retrieval",
            "used_for_rag": True,
            "contains_personal_data": True,
        }
    ]
    payload["rag_configuration"] = {
        "knowledge_base_name": "KB",
        "vector_database": "qdrant",
        "embedding_model": "text-embedding-3-large",
        "top_k": 5,
        "citations_enabled": True,
    }
    payload["agent_configuration"] = {
        "agent_purpose": "Resolve tickets",
        "num_agents": 2,
        "tools_used": ["search", "email"],
        "can_execute_code": True,
        "human_approval_required": True,
        "max_steps": 10,
    }
    payload["security_posture"] = [
        {"control_key": "authentication", "implementation_status": "implemented"},
        {"control_key": "pii_redaction", "implementation_status": "planned", "notes": "Q3"},
    ]
    payload["dependencies"] = [
        {"name": "Azure OpenAI", "dependency_type": "model_provider", "is_critical": True}
    ]
    payload["documents"] = [
        {"name": "Model Card", "document_type": "model_card", "confidentiality_level": "internal"}
    ]
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["data_sources"]) == 1
    assert body["data_sources"][0]["contains_personal_data"] is True
    assert body["rag_configuration"]["top_k"] == 5
    assert body["agent_configuration"]["tools_used"] == ["search", "email"]
    assert len(body["security_posture"]) == 2
    assert len(body["dependencies"]) == 1
    assert len(body["documents"]) == 1

    # Round-trips through the detail GET.
    detail = client.get(f"{BASE}/{body['system']['id']}/registration").json()
    assert detail["rag_configuration"]["vector_database"] == "qdrant"
    assert detail["agent_configuration"]["num_agents"] == 2


def test_phase2_invalid_catalog_rejected(client: TestClient) -> None:
    payload = deepcopy(full_payload("Bad Security System"))
    payload["security_posture"] = [
        {"control_key": "authentication", "implementation_status": "totally_bogus"}
    ]
    response = client.post(BASE + "/register", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
