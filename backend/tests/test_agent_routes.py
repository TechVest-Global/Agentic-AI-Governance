from uuid import UUID, uuid4

from app.services.agents.base import AgentContext
from fastapi.testclient import TestClient


def create_system(
    client: TestClient,
    *,
    name: str,
    risk_tier: str = "medium",
) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
            "owner": "AI Governance",
            "system_type": "chatbot",
            "risk_tier": risk_tier,
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_capability(
    client: TestClient,
    system_id: str,
    *,
    name: str = "answer_question",
    side_effect_level: str = "none",
    requires_human_review: bool = False,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={
            "name": name,
            "capability_type": "action",
            "endpoint_ref": f"/api/{name}",
            "side_effect_level": side_effect_level,
            "requires_human_review": requires_human_review,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str, dimension: str) -> None:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": dimension,
            "primary_agent": "orchestrator",
            "tool_name": "promptfoo",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.8},
            "scoring_config": {"direction": "higher_is_better"},
        },
    )
    assert response.status_code == 201


def create_mapping(client: TestClient, metric_id: str, control_ref: str) -> None:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": "nist_ai_rmf",
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": control_ref,
            "metric_ids": [metric_id],
        },
    )
    assert response.status_code == 201


def create_run(client: TestClient, system_id: str, metric_ids: list[str]) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": metric_ids,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_selected_agents_create_findings_from_metric_results(client: TestClient) -> None:
    system = create_system(client, name="Agent Metric System")
    create_metric(client, "bias_fairness_score", "Bias and Fairness")
    create_mapping(client, "bias_fairness_score", "MAP-BIAS")
    run = create_run(client, system["id"], ["bias_fairness_score"])
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.2},
    )
    assert execution.status_code == 201

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["findings_created"] == 1
    assert len(result["agents_run"]) == 1
    assert result["agents_run"][0]["agent_name"] == "bias_agent"
    assert result["agents_run"][0]["finding_count"] == 1
    assert result["agents_run"][0]["status"] == "completed"
    assert result["agents_run"][0]["id"] is not None
    assert len(result["executions"]) == 1
    assert result["executions"][0]["agent_name"] == "bias_agent"
    assert result["executions"][0]["status"] == "completed"
    assert result["executions"][0]["finding_count"] == 1
    assert result["executions"][0]["started_at"] is not None
    assert result["executions"][0]["completed_at"] is not None
    assert result["findings"][0]["agent_name"] == "bias_agent"
    assert result["findings"][0]["finding_type"] == "bias"

    list_response = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        params={"agent_name": "bias_agent"},
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [
        result["findings"][0]["id"]
    ]

    execution_response = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/agents/executions"
    )
    assert execution_response.status_code == 200
    executions = execution_response.json()
    assert [execution["id"] for execution in executions] == [
        result["executions"][0]["id"]
    ]

    report_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/report")
    assert report_response.status_code == 200
    report = report_response.json()
    assert report["counts"]["agent_executions"] == 1
    assert report["agent_executions"][0]["agent_name"] == "bias_agent"


def test_agent_emits_coverage_gap_when_no_metrics_planned_for_its_dimension(
    client: TestClient,
) -> None:
    """Fix regression test: an agent whose dimension has no planned metrics at
    all used to return [] — identical in the stored findings to "probed and
    clean". It must now emit an explicit coverage_gap finding instead, so a
    governance gap (nothing evaluated) never reads as a clean bill of health.
    """
    system = create_system(client, name="No Bias Metrics System")
    create_metric(client, "unrelated_metric", "Unrelated Dimension")
    create_mapping(client, "unrelated_metric", "MAP-UNRELATED")
    # This run's only metric doesn't match bias_agent's metric IDs or keywords
    # at all — bias_agent owns nothing to review for this run.
    run = create_run(client, system["id"], ["unrelated_metric"])
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.9},
    )
    assert execution.status_code == 201

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["findings_created"] == 1
    assert result["findings"][0]["agent_name"] == "bias_agent"
    assert result["findings"][0]["finding_type"] == "coverage_gap"
    assert result["findings"][0]["dimension"] == "bias"
    assert result["findings"][0]["payload"]["reason"] == "no_metrics_planned"


def test_all_agents_can_create_oversight_and_misuse_findings(client: TestClient) -> None:
    system = create_system(client, name="High Risk Agent System", risk_tier="high")
    create_capability(
        client,
        system["id"],
        name="delete_account",
        side_effect_level="destructive",
        requires_human_review=False,
    )
    run = create_run(client, system["id"], [])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    finding_types = {finding["finding_type"] for finding in result["findings"]}
    assert {"oversight", "misuse"}.issubset(finding_types)
    assert result["findings_created"] >= 2
    assert len(result["executions"]) == 7
    assert {execution["agent_name"] for execution in result["executions"]} >= {
        "risk_scorer",
        "misuse_agent",
    }

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    assert run_response.json()["status"] == "agents_running"
    assert run_response.json()["current_phase"] == "specialist_agents"


def test_agent_failure_is_stored_as_degraded_execution(
    client: TestClient,
    monkeypatch,
) -> None:
    class FailingAgent:
        name = "failing_agent"

        def evaluate(self, context: AgentContext) -> list[object]:
            raise RuntimeError("agent tool unavailable")

    system = create_system(client, name="Failing Agent System")
    run = create_run(client, system["id"], [])
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None, **_kwargs: [FailingAgent()],
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    # A failed agent now contributes ONE finding: the record that its dimension
    # went unverified. It used to contribute none, which made a failure
    # indistinguishable from a clean result in the evidence package — and the
    # council counts findings, so silence read as "nothing wrong". See
    # helpers.agent_failed_finding and test_agent_inputs_and_outputs.py.
    assert result["findings_created"] == 1
    assert result["agents_run"] == [
        {
            "id": result["executions"][0]["id"],
            "agent_name": "failing_agent",
            "finding_count": 1,
            "status": "failed",
        }
    ]
    assert result["executions"][0]["error_summary"] == {
        "error_type": "RuntimeError",
        "message": "agent tool unavailable",
    }
    # The failure is still recorded AS a failure, not laundered into a normal finding.
    finding = result["findings"][0]
    assert finding["payload"]["generated_by"] == "agent_failure"
    assert finding["severity"] == "high"

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    run_body = run_response.json()
    assert run_body["status"] == "degraded"
    assert run_body["result_summary"]["agent_executions_failed"] == 1


def test_risk_scorer_sees_findings_from_earlier_agents_in_same_run(
    client: TestClient,
) -> None:
    """Fix regression test: RiskScorerAgent runs 6th in the fixed pipeline order
    (Quality, Bias, Misuse, Drift, ComplianceMapper, RiskScorer, Explainability —
    see registry.py's _build_agents()). Its composite risk_summary finding is
    built from context.existing_findings, which per risk_contract.py's docstring
    should include "all findings accumulated so far in the run" — i.e. findings
    created earlier in THIS SAME run_agents() loop by Quality/Bias, not just
    whatever existed before the loop started (which is always 0 for a fresh
    run, since no agent had produced anything yet).
    """
    system = create_system(client, name="Risk Scorer Staleness System")
    create_metric(client, "quality_task_fulfilment", "Task Fulfilment")
    create_mapping(client, "quality_task_fulfilment", "MAP-QUALITY")
    create_metric(client, "bias_fairness_score", "Bias and Fairness")
    create_mapping(client, "bias_fairness_score", "MAP-BIAS")
    run = create_run(
        client, system["id"], ["quality_task_fulfilment", "bias_fairness_score"]
    )
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.2},
    )
    assert execution.status_code == 201

    # Run the full agent set in the fixed pipeline order — same order the full
    # /orchestrate pipeline uses (agent_names omitted => all 7, registry order).
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={},
    )
    assert response.status_code == 201
    result = response.json()

    quality_and_bias_findings = [
        f
        for f in result["findings"]
        if f["agent_name"] in {"quality_agent", "bias_agent"}
    ]
    assert len(quality_and_bias_findings) == 2

    risk_summary = next(
        f
        for f in result["findings"]
        if f["agent_name"] == "risk_scorer" and f["finding_type"] == "risk_summary"
    )
    # Before the fix, risk_scorer always saw finding_count == 0 here (the
    # pre-loop snapshot), regardless of what Quality/Bias produced earlier in
    # this same run. After the fix it sees both same-run findings.
    assert risk_summary["payload"]["finding_count"] >= 2
    assert risk_summary["payload"]["composite_score"] > 0.0


def test_run_agents_skips_phase_mutation_for_remediation_call(client: TestClient) -> None:
    """Fix regression test: run_agents() unconditionally flipped run.status /
    run.current_phase to agents_running / specialist_agents on both entry and
    exit. When deliberation_council's re_probe remediation calls run_agents()
    directly, mid-loop, that made a live observer see the run's phase jump
    backward to "Specialist Agents" then forward again once deliberation
    resumed. is_remediation_call=True must leave whatever status/phase the
    caller (the council) had set completely untouched.
    """
    from app.db import session as db_session
    from app.models.enums import RunPhase, RunStatus
    from app.schemas.governance import AgentRunCreate
    from app.services.run_validation import get_run_or_raise
    from app.services.specialist_agents.agent_execution import run_agents
    from sqlmodel import Session

    system = create_system(client, name="ReProbe Phase Guard System")
    run = create_run(client, system["id"], [])
    run_id = UUID(run["id"])

    with Session(db_session.engine) as session:
        db_run = get_run_or_raise(session, run_id)
        # Simulate the state deliberation_council leaves the run in mid-loop.
        db_run.status = RunStatus.council_running
        db_run.current_phase = RunPhase.deliberation_council
        session.add(db_run)
        session.commit()

        run_agents(
            session,
            run_id=run_id,
            payload=AgentRunCreate(agent_names=["bias_agent"]),
            is_remediation_call=True,
        )

        session.refresh(db_run)
        assert db_run.status == RunStatus.council_running
        assert db_run.current_phase == RunPhase.deliberation_council


def test_agent_run_rejects_unknown_agent(client: TestClient) -> None:
    system = create_system(client, name="Unknown Agent System")
    run = create_run(client, system["id"], [])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run",
        json={"agent_names": ["not_a_real_agent"]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"] == {
        "unknown_agents": ["not_a_real_agent"]
    }


def test_agent_run_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
