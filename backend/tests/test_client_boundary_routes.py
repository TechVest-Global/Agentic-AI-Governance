"""LLM client boundary — live status + boundary test endpoints."""

import urllib.error

import pytest
from fastapi.testclient import TestClient

import app.services.boundary as boundary_service


def test_client_boundary_status(client: TestClient):
    body = client.get("/api/v1/client-boundary").json()
    assert set(body) == {"governance", "target"}
    for side in ("governance", "target"):
        assert body[side]["mode"] in {"real", "mock"}
        assert body[side]["provider"]
        assert body[side]["credential_ref"].startswith("env:")
    # Tests neutralize credentials, so both resolve to mock.
    assert body["target"]["mode"] == "mock"
    assert body["governance"]["mode"] == "mock"


def test_boundary_test_probes_target_and_fences(client: TestClient):
    resp = client.post("/api/v1/client-boundary/test", json={"prompt": "Summarize the report."})
    assert resp.status_code == 200, resp.text
    r = resp.json()
    # Real pipeline: raw target output, sanitized output, and a fenced evidence block.
    assert r["prompt"] == "Summarize the report."
    assert "Summarize the report." in r["raw"]
    assert r["fenced"].startswith("UNTRUSTED TARGET MODEL OUTPUT")
    assert "```target-output" in r["fenced"]
    assert r["target_mode"] == "mock"
    assert isinstance(r["warnings"], list)
    assert isinstance(r["redaction_count"], int)


def test_boundary_test_redacts_secrets_in_target_output(client: TestClient):
    # The mock target echoes the prompt, so a secret in the prompt appears in the
    # response and must be redacted by the real sanitizer.
    resp = client.post(
        "/api/v1/client-boundary/test",
        json={"prompt": "The api_key = sk-live-SECRET12345 is here."},
    )
    r = resp.json()
    assert r["redaction_count"] >= 1
    assert "[REDACTED_SECRET]" in r["sanitized"]
    assert r["caught_something"] is True


def test_boundary_test_defaults_empty_prompt(client: TestClient):
    r = client.post("/api/v1/client-boundary/test", json={"prompt": ""}).json()
    assert r["prompt"], "empty prompt should fall back to a default"


def test_boundary_test_returns_clean_error_when_target_unreachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    class _UnreachableClient:
        provider = "fake_unreachable_target"
        credential_ref = None

        def invoke(self, request):
            raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(
        boundary_service, "get_target_model_client", lambda: _UnreachableClient()
    )

    resp = client.post("/api/v1/client-boundary/test", json={"prompt": "hello"})

    # A clean, structured 502 instead of a bare unhandled-exception 500.
    assert resp.status_code == 502, resp.text
    body = resp.json()
    assert body["error"]["code"] == "TARGET_UNREACHABLE"
    assert body["error"]["message"] == "The target model endpoint is unreachable."
    # The real cause is preserved for debugging, not swallowed.
    assert body["error"]["details"]["error_type"] == "URLError"
    assert "connection refused" in body["error"]["details"]["error"]
