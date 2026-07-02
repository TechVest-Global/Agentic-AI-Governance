from uuid import uuid4

from fastapi.testclient import TestClient


def bootstrap_config(client: TestClient) -> None:
    response = client.post("/api/v1/governance-config/bootstrap")
    assert response.status_code in (200, 201)


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Context Assembly System",
            "owner": "AI Governance",
            "system_type": "decision_support",
            "risk_tier": "high",
            "selected_frameworks": ["nist_ai_rmf", "iso_42001"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf", "iso_42001"],
        },
    )
    assert response.status_code == 201
    return response.json()


def _well_covered_logs() -> list[dict[str, object]]:
    return [
        {
            "request_category": "loan_decision",
            "demographic_group": "age_over_60",
            "jurisdiction": "US",
            "outcome": "approved",
            "contains_pii": True,
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "female",
            "jurisdiction": "EU",
            "outcome": "denied",
            "flagged": True,
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "ethnicity_minority",
            "jurisdiction": "US",
            "outcome": "denied",
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "disability",
            "jurisdiction": "EU",
            "outcome": "approved",
        },
    ]


def test_context_assembly_analyzes_logs_and_persists_state(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": _well_covered_logs(), "requested_by": "tester"},
    )
    assert response.status_code == 201
    body = response.json()

    log_analysis = body["log_analysis"]
    assert log_analysis["total_requests"] == 4
    assert log_analysis["empty"] is False
    assert log_analysis["request_category_counts"] == {"loan_decision": 4}
    assert log_analysis["distinct_demographic_groups"] == 4
    assert log_analysis["pii_request_count"] == 1
    assert log_analysis["flagged_request_count"] == 1

    regulatory = body["regulatory_context"]
    assert set(regulatory["resolved_frameworks"]) == {"nist_ai_rmf", "iso_42001"}
    assert regulatory["missing_frameworks"] == []
    assert regulatory["control_count"] >= 5

    # Fully-covered logs leave no coverage gaps.
    assert body["gap_count"] == 0
    assert body["coverage_gaps"] == []
    assert body["highest_gap_severity"] is None
    assert body["state_sequence_number"] == 1
    assert body["state_entry_hash"]

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    updated = run_response.json()
    assert updated["status"] == "context_assembly"
    assert updated["current_phase"] == "context_assembly"
    assert updated["result_summary"]["context_assembly"]["log_requests"] == 4


def test_context_assembly_detects_prioritized_gaps_for_empty_logs(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": []},
    )
    assert response.status_code == 201
    body = response.json()

    assert body["log_analysis"]["empty"] is True
    assert body["gap_count"] > 0
    # Every configured coverage requirement should surface a gap with no evidence.
    gap_ids = {gap["gap_id"] for gap in body["coverage_gaps"]}
    assert "nist_ai_rmf:nist-demographic-coverage" in gap_ids
    assert "iso_42001:iso-pii-handling" in gap_ids

    # Gaps are prioritized highest-severity first.
    severities = [gap["severity"] for gap in body["coverage_gaps"]]
    order = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    ranks = [order[value] for value in severities]
    assert ranks == sorted(ranks, reverse=True)
    assert body["highest_gap_severity"] == "high"

    # Each gap carries an actionable recommendation and control references.
    for gap in body["coverage_gaps"]:
        assert gap["recommended_action"]
        assert gap["control_refs"]


def test_context_assembly_is_deterministic(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])
    logs = _well_covered_logs()[:2]

    first = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": logs},
    ).json()
    second = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": logs},
    ).json()

    assert first["log_analysis"] == second["log_analysis"]
    assert first["coverage_gaps"] == second["coverage_gaps"]
    # Append-only: a second assembly creates a later state entry.
    assert second["state_sequence_number"] > first["state_sequence_number"]


def test_get_context_returns_latest_assembly(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": _well_covered_logs()},
    )

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/context-assembly")
    assert response.status_code == 200
    body = response.json()
    assert body["run_id"] == run["id"]
    assert body["log_analysis"]["total_requests"] == 4
    assert body["gap_count"] == 0


def test_get_context_404_when_not_assembled(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/context-assembly")
    assert response.status_code == 404
    assert response.json()["error"]["details"]["resource"] == "Context assembly"


def test_context_assembly_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/context-assembly",
        json={"logs": []},
    )
    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def test_context_assembly_reports_missing_framework(client: TestClient) -> None:
    bootstrap_config(client)
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Unknown Framework System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["made_up_framework"],
        },
    )
    system = response.json()
    run = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system["id"],
            "selected_frameworks": ["made_up_framework"],
        },
    ).json()

    body = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": []},
    ).json()
    assert body["regulatory_context"]["missing_frameworks"] == ["made_up_framework"]
    assert body["regulatory_context"]["resolved_frameworks"] == []


def test_context_assembly_blocked_for_terminal_run(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    cancel = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/cancel",
        json={"reason": "done"},
    )
    assert cancel.status_code == 200

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": []},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_RUN_TRANSITION"


def test_orchestrate_runs_context_assembly_first_when_logs_supplied(client: TestClient) -> None:
    bootstrap_config(client)
    system = create_system(client)
    run = create_run(client, system["id"])

    # Orchestration is fire-and-forget (202); the pipeline runs as a background
    # task (executed synchronously by TestClient) and persists its results.
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"mock_score": 0.95, "logs": _well_covered_logs(), "requested_by": "tester"},
    )
    assert response.status_code == 202

    context = client.get(f"/api/v1/evaluation-runs/{run['id']}/context-assembly").json()
    assert context is not None
    assert context["log_analysis"]["total_requests"] == 4

    # Context assembly is the first link in the hash-chained state sequence.
    state = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/state",
        params={"phase": "context_assembly"},
    ).json()
    assert len(state) == 1
    assert state[0]["sequence_number"] == 1
    assert state[0]["entry_type"] == "context_assembled"

    verify = client.get(f"/api/v1/evaluation-runs/{run['id']}/state/verify").json()
    assert verify["valid"] is True
