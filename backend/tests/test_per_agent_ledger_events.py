"""The run trace must name each agent, not just the layer.

The orchestrator writes one ``agent_execution.completed`` ledger event covering
the whole specialist layer, and nothing else. On a live TechVest run that left
the Live Run view's Runtime Event Stream showing a single row for nine agent
executions — and only after every one of them had already finished.

Each agent now appends its own hash-chained event carrying its execution
window, so the fan-out is legible in the trace and a reviewer can confirm from
the ledger alone that the agents overlapped.
"""

from uuid import UUID

from fastapi.testclient import TestClient


def _register_system(client: TestClient) -> str:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Ledger Trace Chatbot",
            "owner": "governance",
            "system_type": "chatbot",
            "risk_tier": "medium",
            "selected_frameworks": ["eu_ai_act"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_run(client: TestClient, system_id: str) -> str:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_frameworks": ["eu_ai_act"]},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _ledger(client: TestClient, run_id: str) -> list[dict]:
    response = client.get(f"/api/v1/evaluation-runs/{run_id}/ledger")
    assert response.status_code == 200, response.text
    return response.json()


def test_each_agent_appends_its_own_ledger_event(client: TestClient) -> None:
    system_id = _register_system(client)
    run_id = _create_run(client, system_id)

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent", "quality_agent", "risk_scorer"]},
    )
    assert response.status_code == 201, response.text

    events = _ledger(client, run_id)
    agent_events = {e["actor_id"]: e for e in events if e["actor_type"] == "agent"}

    assert set(agent_events) == {"bias_agent", "quality_agent", "risk_scorer"}, (
        f"expected one ledger event per agent, got {sorted(agent_events)}"
    )


def test_the_event_carries_what_the_agent_actually_did(client: TestClient) -> None:
    system_id = _register_system(client)
    run_id = _create_run(client, system_id)

    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    event = next(e for e in _ledger(client, run_id) if e["actor_type"] == "agent")
    payload = event["payload"]

    # Renders on the Specialist Agents layer of the Runtime Event Stream, which
    # filters ledger events by payload.phase.
    assert payload["phase"] == "specialist_agents"
    assert payload["agent_name"] == "bias_agent"
    assert payload["status"] in {"completed", "failed"}
    assert payload["execution_stage"] in {"parallel", "aggregate"}
    # The execution window is what makes concurrency provable from the ledger.
    assert payload["started_at"] and payload["completed_at"]
    assert isinstance(payload["duration_ms"], int)
    assert isinstance(payload["probe_count"], int)
    assert isinstance(payload["finding_count"], int)


def test_the_agent_events_stay_in_the_verified_hash_chain(client: TestClient) -> None:
    """Appending mid-phase must not break the chain the report verifies."""
    system_id = _register_system(client)
    run_id = _create_run(client, system_id)

    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent", "quality_agent"]},
    )

    verification = client.get(f"/api/v1/evaluation-runs/{run_id}/ledger/verify")
    assert verification.status_code == 200, verification.text
    assert verification.json()["valid"] is True

    sequences = [e["sequence_number"] for e in _ledger(client, run_id)]
    assert sequences == sorted(sequences)
    assert len(set(sequences)) == len(sequences), "duplicate sequence numbers in the chain"


def test_a_failed_agent_is_recorded_as_failed(client: TestClient, monkeypatch) -> None:
    """A crashed agent must leave an event saying so, not silently vanish."""
    from app.services.agents.model_backed import bias_agent as bias_module

    def _explode(self, context):  # noqa: ANN001, ANN202
        raise RuntimeError("probe design blew up")

    monkeypatch.setattr(bias_module.BiasAuditorAgent, "evaluate", _explode)

    system_id = _register_system(client)
    run_id = _create_run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    event = next(e for e in _ledger(client, run_id) if e["actor_type"] == "agent")
    assert event["event_type"] == "agent.failed"
    assert event["payload"]["error"]["error_type"] == "RuntimeError"
    assert UUID(event["run_id"]) == UUID(run_id)
