from fastapi.testclient import TestClient


def _create_system(client: TestClient) -> str:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Techvest RAG Chatbot",
            "owner": "AI Governance",
            "system_type": "RAG support chatbot",
            "risk_tier": "medium",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_security_tools_status_lists_real_adapters(client: TestClient):
    response = client.get("/api/v1/security-tools")
    assert response.status_code == 200
    body = response.json()
    assert "adapters" in body and body["summary"]["total"] >= 1
    keys = {a["key"] for a in body["adapters"]}
    assert {"garak", "presidio", "deepeval", "ragas"} <= keys
    # Every adapter reports concrete availability booleans, not placeholders.
    for adapter in body["adapters"]:
        assert isinstance(adapter["available"], bool)
        assert isinstance(adapter["dependency_installed"], bool)
    # Tests neutralize credentials, so the target client resolves to mock.
    assert body["target_client"]["mode"] == "mock"


def test_upload_context_document_from_text(client: TestClient):
    system_id = _create_system(client)
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/retrieval-context/upload",
        data={"text": "Return policy: items may be returned within 30 days.", "title": "Return Policy"},
    )
    assert response.status_code == 201
    doc = response.json()
    assert doc["title"] == "Return Policy"
    assert "30 days" in doc["content"]
    # It should be retrievable as a context document for the system.
    listing = client.get(f"/api/v1/ai-systems/{system_id}/retrieval-context")
    assert listing.status_code == 200
    assert any(d["title"] == "Return Policy" for d in listing.json())


def test_upload_context_document_from_file(client: TestClient):
    system_id = _create_system(client)
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/retrieval-context/upload",
        files={"file": ("faq.txt", b"How do I reset my password? Click Settings.", "text/plain")},
    )
    assert response.status_code == 201
    doc = response.json()
    assert doc["title"] == "faq.txt"
    assert "reset my password" in doc["content"]


def test_upload_empty_context_is_rejected(client: TestClient):
    system_id = _create_system(client)
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/retrieval-context/upload",
        data={"text": "   "},
    )
    assert response.status_code == 422
