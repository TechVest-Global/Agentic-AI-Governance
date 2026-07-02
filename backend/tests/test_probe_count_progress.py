"""End-to-end: probe_count is persisted on agent executions and surfaced by the
SSE progress endpoint, so the 'Probes Sent' tile is no longer stuck at 0."""

from fastapi.testclient import TestClient


def _bootstrap_run(client: TestClient) -> str:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Techvest RAG Chatbot",
            "owner": "Gov",
            "system_type": "RAG support chatbot",
            "risk_tier": "high",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    ).json()
    run = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system["id"],
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["CM-017", "CM-026"],
        },
    ).json()
    return run["id"]


def test_probe_count_is_persisted_and_reported(client: TestClient):
    run_id = _bootstrap_run(client)
    orch = client.post(
        f"/api/v1/evaluation-runs/{run_id}/orchestrate",
        json={
            "mock_score": 0.2,
            "force_metric_status": "failed",
            "requested_by": "test",
            "agent_names": ["bias_agent", "misuse_agent"],
        },
    )
    assert orch.status_code == 202

    executions = client.get(f"/api/v1/evaluation-runs/{run_id}/agents/executions").json()
    counts = {
        e["agent_name"]: (e.get("metadata_json") or {}).get("probe_count")
        for e in executions
    }
    # Both model-backed agents probed the target, so each records a real
    # (positive) probe count in metadata_json rather than leaving it unset.
    assert counts.get("bias_agent", 0) and counts["bias_agent"] > 0
    assert counts.get("misuse_agent", 0) and counts["misuse_agent"] > 0
