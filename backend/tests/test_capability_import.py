from fastapi.testclient import TestClient

from app.services.capability_import import _capability_fields_from_entry


def test_capability_fields_capture_request_body_as_input_schema():
    # A catalog entry with a requestBody must populate input_schema, so probe
    # selection can later synthesize a structured body for this endpoint
    # instead of only ever sending plain text.
    entry = {
        "function": "rankCandidatesForJob",
        "path": "/api/v1/ai/rank-candidates",
        "method": "POST",
        "feature": "ranking",
        "requestBody": {
            "type": "object",
            "properties": {"job": {"type": "object"}},
            "required": ["job"],
        },
    }
    fields = _capability_fields_from_entry(entry, base_origin="http://gw")
    assert fields["endpoint_ref"] == "rank-candidates"
    assert fields["input_schema"] == entry["requestBody"]


def test_capability_fields_default_to_empty_schema_without_request_body():
    entry = {"function": "chat", "path": "/api/chat", "method": "POST"}
    fields = _capability_fields_from_entry(entry, base_origin="http://gw")
    assert fields["input_schema"] == {}


def create_system(client: TestClient, target_endpoint_ref: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Catalog Import System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
            "target_endpoint_ref": target_endpoint_ref,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_import_from_catalog_blocks_cloud_metadata_address(client: TestClient) -> None:
    # 169.254.169.254 is the well-known cloud-metadata SSRF target (AWS/GCP/Azure
    # instance-credential endpoint). The guard must reject it before any network
    # call is attempted, rather than letting urlopen reach out to it.
    system = create_system(client, "http://169.254.169.254")

    response = client.post(
        f"/api/v1/ai-systems/{system['id']}/capabilities/import-from-catalog"
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "TARGET_HOST_BLOCKED"
    assert "169.254.169.254" in str(body["error"]["details"])


def test_import_from_catalog_blocks_other_link_local_addresses(
    client: TestClient,
) -> None:
    system = create_system(client, "http://169.254.1.2:8080")

    response = client.post(
        f"/api/v1/ai-systems/{system['id']}/capabilities/import-from-catalog"
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "TARGET_HOST_BLOCKED"


def test_import_from_catalog_does_not_block_localhost(client: TestClient) -> None:
    # Registered systems legitimately live on localhost (e.g. an HR gateway at
    # http://localhost:5000). The guard must not reject them; the request should
    # instead proceed to the network call and fail there (nothing is listening
    # on this port), proving it wasn't rejected by the SSRF guard itself.
    system = create_system(client, "http://127.0.0.1:59991")

    response = client.post(
        f"/api/v1/ai-systems/{system['id']}/capabilities/import-from-catalog"
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "CATALOG_FETCH_FAILED"
