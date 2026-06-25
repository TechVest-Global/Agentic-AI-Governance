from uuid import uuid4

from fastapi.testclient import TestClient


def bootstrap(client: TestClient) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code in (200, 201)


def create_system(
    client: TestClient,
    *,
    risk_tier: str = "high",
    frameworks: list[str] | None = None,
) -> dict[str, object]:
    frameworks = frameworks if frameworks is not None else ["nist_ai_rmf", "iso_42001"]
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Plan System",
            "owner": "AI Governance",
            "system_type": "decision_support",
            "risk_tier": risk_tier,
            "selected_frameworks": frameworks,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(
    client: TestClient,
    system_id: str,
    *,
    frameworks: list[str] | None = None,
    metrics: list[str] | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "ai_system_id": system_id,
        "selected_frameworks": (
            frameworks if frameworks is not None else ["nist_ai_rmf", "iso_42001"]
        ),
    }
    if metrics is not None:
        body["selected_metrics"] = metrics
    response = client.post("/api/v1/evaluation-runs", json=body)
    assert response.status_code == 201
    return response.json()


def assemble_empty_context(client: TestClient, run_id: str) -> dict[str, object]:
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/context-assembly",
        json={"logs": []},
    )
    assert response.status_code == 201
    return response.json()


def test_plan_activates_agents_and_allocates_full_budget(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client, risk_tier="medium")
    run = create_run(client, system["id"], metrics=["CM-005", "CM-017"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan",
        json={"requested_by": "planner"},
    )
    assert response.status_code == 201
    plan = response.json()

    agent_names = {agent["agent_name"] for agent in plan["activated_agents"]}
    assert agent_names == {"explainability_agent", "bias_agent"}

    # Probe budget validates to exactly 100 across activated agents (spec invariant).
    assert plan["probe_budget_total"] == 100
    assert plan["probe_budget_allocated"] == 100
    assert sum(agent["probe_budget"] for agent in plan["activated_agents"]) == 100
    assert all(agent["probe_budget"] >= 1 for agent in plan["activated_agents"])
    assert plan["state_sequence_number"] == 1
    assert plan["risk_tier"] == "medium"

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    updated = run_response.json()
    assert updated["status"] == "planned"
    assert updated["current_phase"] == "adaptive_orchestrator"


def test_plan_consumes_coverage_gaps(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client, risk_tier="high")
    run = create_run(client, system["id"])
    assemble_empty_context(client, run["id"])  # empty logs -> many coverage gaps

    plan = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan",
        json={},
    ).json()

    assert plan["coverage_gap_count"] > 0
    assert plan["priority_targets"]
    # Priority targets are ordered highest-severity first.
    order = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    ranks = [order[target["severity"]] for target in plan["priority_targets"]]
    assert ranks == sorted(ranks, reverse=True)

    agents = {agent["agent_name"]: agent for agent in plan["activated_agents"]}
    bias = agents["bias_agent"]
    assert "nist_ai_rmf:nist-demographic-coverage" in bias["coverage_gap_ids"]
    assert bias["priority"] == "high"
    assert "Prioritize" in bias["instructions"]

    assert sum(agent["probe_budget"] for agent in plan["activated_agents"]) == 100


def test_plan_is_deterministic_and_append_only(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client)
    run = create_run(client, system["id"])
    assemble_empty_context(client, run["id"])

    first = client.post(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan", json={}).json()
    second = client.post(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan", json={}).json()

    assert first["activated_agents"] == second["activated_agents"]
    assert first["priority_targets"] == second["priority_targets"]
    assert second["state_sequence_number"] > first["state_sequence_number"]


def test_get_plan_returns_latest(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client)
    run = create_run(client, system["id"], metrics=["CM-026"])
    client.post(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan", json={})

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan")
    assert response.status_code == 200
    plan = response.json()
    assert plan["run_id"] == run["id"]
    assert {agent["agent_name"] for agent in plan["activated_agents"]} == {"misuse_agent"}
    assert plan["activated_agents"][0]["probe_budget"] == 100


def test_get_plan_404_when_not_prepared(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan")
    assert response.status_code == 404
    assert response.json()["error"]["details"]["resource"] == "Evaluation plan"


def test_plan_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/evaluation-plan",
        json={},
    )
    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def test_orchestrate_runs_activated_agents_when_unspecified(client: TestClient) -> None:
    bootstrap(client)
    system = create_system(client, risk_tier="medium")
    run = create_run(client, system["id"], metrics=["CM-005", "CM-017"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"mock_score": 1.0},
    )
    assert response.status_code == 200
    body = response.json()

    assert body["evaluation_plan"] is not None
    planned_agents = {a["agent_name"] for a in body["evaluation_plan"]["activated_agents"]}
    ran_agents = {a["agent_name"] for a in body["agent_run"]["agents_run"]}
    # With no explicit agent_names, the plan's activated agents are exactly the ones run.
    assert ran_agents == planned_agents == {"explainability_agent", "bias_agent"}
