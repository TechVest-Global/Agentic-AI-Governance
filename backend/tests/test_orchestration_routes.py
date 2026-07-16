from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Orchestrated Governance System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "risk_tier": "medium",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["CM-005", "CM-026"],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_governance_pipeline_orchestrates_metrics_agents_council_and_report(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    # Orchestration is now fire-and-forget: the endpoint returns 202 and the
    # pipeline runs in a BackgroundTask (executed synchronously by TestClient
    # before this call returns).
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_scorer"],
            "requested_by": "backend_test",
            "notes": "Run full governance pipeline.",
        },
    )
    assert response.status_code == 202
    assert response.json()["run_id"] == run["id"]

    # The pipeline finalizes the run to a terminal state (previously it parked at
    # council_running, which hung SSE + completion polling).
    run_after = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert run_after["status"] == "completed"
    assert run_after["current_phase"] == "completed"

    report = client.get(f"/api/v1/evaluation-runs/{run['id']}/report").json()
    assert report["run"]["id"] == run["id"]
    assert report["counts"]["metric_results"] == 2
    assert report["counts"]["agent_executions"] == 1
    # 7 state entries once the run is finalized: context_assembled (Layer 1 now
    # always runs — logs are synthesized per-system when a run supplies none),
    # evaluation_plan_prepared, metric/agent/council/report steps. This GET /report
    # is taken after completion, so it includes the governance_report_generated entry.
    assert report["counts"]["state_entries"] == 7
    assert report["state_chain"]["valid"] is True

    plan = client.get(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan").json()
    assert plan["probe_budget_allocated"] == 100

    agents = client.get(f"/api/v1/evaluation-runs/{run['id']}/agents/executions").json()
    assert agents[0]["agent_name"] == "risk_scorer"
    assert agents[0]["status"] == "completed"

    state_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/state")
    assert state_response.status_code == 200
    state_entries = state_response.json()
    assert [entry["entry_type"] for entry in state_entries] == [
        "context_assembled",
        "evaluation_plan_prepared",
        "metric_execution_completed",
        "agent_execution_completed",
        "council_iteration",
        "council_deliberation_completed",
        "governance_report_generated",
    ]
    assert [entry["sequence_number"] for entry in state_entries] == [1, 2, 3, 4, 5, 6, 7]

    ledger_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger")
    assert ledger_response.status_code == 200
    ledger_entries = ledger_response.json()
    assert [entry["event_type"] for entry in ledger_entries] == [
        "context_assembly.completed",
        "evaluation_plan.prepared",
        "metric_execution.completed",
        "agent_execution.completed",
        "council_deliberation.completed",
        "governance_report.generated",
    ]

    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/state/verify").json() == {
        "valid": True,
        "entry_count": 7,
        "failed_sequence": None,
        "reason": None,
    }
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger/verify").json() == {
        "valid": True,
        "entry_count": 6,
        "failed_entry_id": None,
        "reason": None,
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    # The pipeline now finalizes the run instead of leaving it parked at
    # deliberation_council.
    assert updated_run["current_phase"] == "completed"
    assert updated_run["status"] == "completed"
    # Deterministic mock-council output for this all-pass single-agent scenario.
    # (Was "approved" before commit 958dd58 capped re_probe remediation budget,
    # which changed the mock deliberation's verdict; assertion updated to match.)
    assert updated_run["result_summary"]["council_label"] == "conditional_approval"


def test_full_pipeline_stays_degraded_when_an_agent_fails(
    client: TestClient, monkeypatch
) -> None:
    """Fix regression test: driving the FULL pipeline through /orchestrate must
    preserve a 'degraded' run status when a specialist agent fails, matching what
    the standalone /agents/run endpoint already does (see
    test_agent_routes.py::test_agent_failure_is_stored_as_degraded_execution).

    Previously, _execute_and_report's final step unconditionally overwrote
    run.status to 'completed' after the council/report steps ran, silently
    discarding the degraded signal that agent_execution.run_agents() had set.
    """
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    class FailingAgent:
        name = "failing_agent"

        def evaluate(self, context: object) -> list[object]:
            raise RuntimeError("agent tool unavailable")

    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None: [FailingAgent()],
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"mock_score": 1.0, "requested_by": "backend_test"},
    )
    assert response.status_code == 202

    run_after = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert run_after["status"] == "degraded"
    assert run_after["current_phase"] == "completed"
    assert run_after["error_summary"]["degraded_reason"] == "specialist_agent_failure"
    assert run_after["error_summary"]["failed_agents"] == [
        {
            "agent_name": "failing_agent",
            "error": {
                "error_type": "RuntimeError",
                "message": "agent tool unavailable",
            },
        }
    ]

    # The pipeline still ran council + report to completion on whatever
    # evidence was produced — a degraded run is not a stopped-dead run.
    report = client.get(f"/api/v1/evaluation-runs/{run['id']}/report").json()
    assert report["run"]["id"] == run["id"]
    assert report["counts"]["agent_executions"] == 1


def test_governance_pipeline_pauses_for_plan_approval_then_resumes(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    # Gate the run: the pipeline should pause after building the metric plan.
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_scorer"],
            "requested_by": "backend_test",
            "require_plan_approval": True,
        },
    )
    assert response.status_code == 202

    # Paused: parked at 'planned', plan built, but not yet executed or approved.
    paused = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert paused["status"] == "planned"
    assert paused["current_phase"] == "adaptive_orchestrator"
    assert paused["plan_approved_at"] is None

    plan = client.get(f"/api/v1/evaluation-runs/{run['id']}/evaluation-plan")
    assert plan.status_code == 200

    ledger_events = [
        e["event_type"]
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert "plan.awaiting_approval" in ledger_events
    # The gate stops execution: no metric run happened while awaiting approval.
    assert "metric_execution.completed" not in ledger_events

    # Approve — the run resumes and (TestClient runs the background task inline)
    # completes end-to-end.
    approve = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/approve-plan",
        json={"approved_by": "R. Sharma", "notes": "Plan looks right."},
    )
    assert approve.status_code == 200
    assert approve.json()["plan_approved_by"] == "R. Sharma"

    completed = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert completed["status"] == "completed"
    assert completed["current_phase"] == "completed"
    assert completed["plan_approved_at"] is not None

    final_events = [
        e["event_type"]
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert "plan.approved" in final_events
    assert "metric_execution.completed" in final_events
    assert "governance_report.generated" in final_events
    # Ledger chain stays valid across the pause/approve/resume boundary.
    assert client.get(
        f"/api/v1/evaluation-runs/{run['id']}/ledger/verify"
    ).json()["valid"] is True

    # Approving a run that is no longer awaiting approval is a conflict.
    second = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/approve-plan",
        json={"approved_by": "R. Sharma"},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "PLAN_NOT_AWAITING_APPROVAL"


def test_approve_plan_with_manual_metric_selection_runs_only_chosen_metrics(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])  # plans CM-005 + CM-026

    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={
            "mock_score": 1.0,
            "agent_names": ["risk_scorer"],
            "require_plan_approval": True,
        },
    )
    assert orchestrate.status_code == 202
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["status"] == "planned"

    # Reviewer hand-picks a single metric instead of the full plan.
    approve = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/approve-plan",
        json={"approved_by": "R. Sharma", "selected_metrics": ["CM-005"]},
    )
    assert approve.status_code == 200

    completed = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert completed["status"] == "completed"
    assert completed["selected_metrics"] == ["CM-005"]

    # Only the chosen metric was executed.
    report = client.get(f"/api/v1/evaluation-runs/{run['id']}/report").json()
    assert report["counts"]["metric_results"] == 1

    # The manual override is recorded in the tamper-evident ledger.
    approved_events = [
        e
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
        if e["event_type"] == "plan.approved"
    ]
    assert approved_events and approved_events[0]["payload"]["manual_selection"] is True
    assert approved_events[0]["payload"]["selected_metrics"] == ["CM-005"]


def test_approve_plan_rejects_empty_manual_selection(client: TestClient) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])
    assert client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"agent_names": ["risk_scorer"], "require_plan_approval": True},
    ).status_code == 202

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/approve-plan",
        json={"approved_by": "R. Sharma", "selected_metrics": []},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EMPTY_METRIC_SELECTION"
    # Still awaiting approval — the rejected call must not have advanced the run.
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["status"] == "planned"


def test_approve_plan_rejects_run_with_no_pending_plan(client: TestClient) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client)
    run = create_run(client, system["id"])

    # Freshly created run (status 'created') has no plan awaiting approval.
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/approve-plan",
        json={"approved_by": "R. Sharma"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PLAN_NOT_AWAITING_APPROVAL"


def test_governance_pipeline_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(f"/api/v1/evaluation-runs/{run_id}/orchestrate", json={})

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
