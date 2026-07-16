from fastapi.testclient import TestClient


def test_sign_in_with_demo_credentials_succeeds(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"email": "auditor@governai.com", "password": "GovernAI2025!"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "auditor@governai.com"
    assert body["token"]


def test_sign_in_with_wrong_password_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"email": "auditor@governai.com", "password": "wrong"},
    )
    assert response.status_code == 401


def test_sign_up_mints_a_working_token(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/sign-up",
        json={
            "name": "Jane Smith",
            "email": "jane@example.com",
            "role": "Auditor",
            "password": "supersecret123",
        },
    )
    assert response.status_code == 200
    assert response.json()["token"]


def test_write_route_without_token_is_rejected(client: TestClient) -> None:
    client.headers.pop("Authorization", None)
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Unauthenticated Attempt",
            "owner": "nobody",
            "system_type": "rag_chatbot",
            "risk_tier": "low",
            "deployment_environment": "production",
        },
    )
    assert response.status_code == 401


def test_write_route_with_bogus_token_is_rejected(client: TestClient) -> None:
    client.headers["Authorization"] = "Bearer not-a-real-token"
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Forged Token Attempt",
            "owner": "nobody",
            "system_type": "rag_chatbot",
            "risk_tier": "low",
            "deployment_environment": "production",
        },
    )
    assert response.status_code == 401


def test_read_routes_stay_open_without_a_token(client: TestClient) -> None:
    client.headers.pop("Authorization", None)
    response = client.get("/api/v1/ai-systems")
    assert response.status_code == 200
