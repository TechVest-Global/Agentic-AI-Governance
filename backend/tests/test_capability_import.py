from fastapi.testclient import TestClient


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
