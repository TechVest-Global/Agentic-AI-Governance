"""Every target/governance LLM call is attributed to the agent that made it, so
the UI can show each specialist agent only its own probe transcript."""

from fastapi.testclient import TestClient


def _bootstrap(client: TestClient) -> str:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "HR Screener",
            "owner": "Gov",
            "system_type": "hr_recruitment_screening",
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


def test_llm_calls_are_attributed_per_agent(client: TestClient):
    run_id = _bootstrap(client)
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

    calls = client.get(f"/api/v1/evaluation-runs/{run_id}/llm-calls").json()["calls"]
    target = [c for c in calls if c["call_type"] == "target"]
    assert target, "expected target probes to be logged"

    # Every target probe is attributed to a specialist agent (not left unlabeled).
    assert all(c.get("agent_name") for c in target), "target probes missing agent_name"

    # Probes are partitioned per agent — bias_agent's probes are distinct rows
    # from misuse_agent's, so the per-agent UI shows only that agent's transcript.
    by_agent: dict[str, list] = {}
    for c in target:
        by_agent.setdefault(c["agent_name"], []).append(c)
    assert "bias_agent" in by_agent and "misuse_agent" in by_agent

    # Each captured probe carries the transcript (prompt sent + response received).
    for c in target:
        assert c.get("prompt_text"), "probe missing prompt_text"
        assert c.get("response_text") is not None, "probe missing response_text"
