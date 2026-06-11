from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_version_endpoint() -> None:
    response = client.get("/api/v1/version")

    assert response.status_code == 200
    assert "version" in response.json()


def test_not_found_uses_standard_error_shape() -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "HTTP_404"
