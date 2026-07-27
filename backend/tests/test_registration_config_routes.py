"""Tests for the backend-sourced registration options + frameworks endpoints."""

from fastapi.testclient import TestClient

BASE = "/api/v1/governance-config"


def test_frameworks_endpoint_returns_the_six_implemented(client: TestClient) -> None:
    response = client.get(BASE + "/frameworks")
    assert response.status_code == 200
    ids = {fw["framework_id"] for fw in response.json()}
    assert ids == {
        "nist_ai_rmf",
        "iso_42001",
        "eu_ai_act",
        "owasp_llm_top_10",
        "owasp_agentic_ai",
        "mitre_atlas",
    }


def test_options_include_new_catalogs_and_keep_existing(client: TestClient) -> None:
    response = client.get(BASE + "/options")
    assert response.status_code == 200
    options = response.json()

    # Existing keys still present (backward compatibility).
    for key in ("risk_tiers", "modalities", "application_types", "domains", "http_methods"):
        assert key in options and options[key], f"missing existing option list: {key}"

    # New Phase-1 catalogs present and non-empty.
    for key in (
        "system_types",
        "business_domains",
        "lifecycle_stages",
        "production_criticalities",
        "internal_external_use",
        "output_usage",
        "human_oversight",
        "owner_roles",
        "model_types",
        "input_modalities",
        "output_types",
        "capability_tags",
        "gateway_types",
        "authentication_types",
        "exposure_types",
        "endpoint_statuses",
        "applicability_types",
        # Phase 2
        "data_source_types",
        "data_classifications",
        "data_usage_purposes",
        "security_controls",
        "security_statuses",
        "dependency_types",
        "document_types",
        "confidentiality_levels",
    ):
        assert key in options and options[key], f"missing new option list: {key}"

    # Every option is a {value,label} pair.
    sample = options["system_types"][0]
    assert set(sample) == {"value", "label"}

    applicability = {o["value"] for o in options["applicability_types"]}
    assert applicability == {"mandatory", "voluntary", "unsure"}
    endpoint_statuses = {o["value"] for o in options["endpoint_statuses"]}
    assert endpoint_statuses == {"draft", "active", "disabled", "deprecated"}
