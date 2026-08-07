from uuid import uuid4

from app.models.enums import ActionTier
from app.services.deliberation_council.verdict_agent import VerdictOutput
from fastapi.testclient import TestClient


def create_system(client: TestClient, name: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str) -> None:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": "Task Fulfilment",
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


def create_run(client: TestClient, system_id: str, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": [metric_id],
        },
    )
    assert response.status_code == 201
    return response.json()


def prepare_run_with_metric(
    client: TestClient,
    *,
    name: str,
    metric_id: str,
    control_ref: str,
    mock_score: float,
) -> tuple[dict[str, object], dict[str, object]]:
    system = create_system(client, name)
    create_metric(client, metric_id)
    create_mapping(client, metric_id, control_ref)
    run = create_run(client, system["id"], metric_id)
    execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": mock_score},
    )
    assert execution.status_code == 201
    return run, execution.json()


def test_council_deliberation_approves_clean_run(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Approved System",
        metric_id="COUNCIL-PASS",
        control_ref="MAP-APPROVE",
        mock_score=0.95,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"requested_by": "prakriti"},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["metric_result_count"] == 1
    assert result["failed_metric_count"] == 0
    assert result["open_finding_count"] == 0
    assert result["verdict"]["label"] == "approved"
    assert result["verdict"]["action_tier"] == "autonomous"
    assert result["verdict"]["required_actions"] == []

    verdict_response = client.get(f"/api/v1/evaluation-runs/{run['id']}/verdict")
    assert verdict_response.status_code == 200
    assert verdict_response.json()["id"] == result["verdict"]["id"]


def test_council_deliberation_conditionally_approves_open_medium_finding(
    client: TestClient,
) -> None:
    run, execution = prepare_run_with_metric(
        client,
        name="Council Conditional System",
        metric_id="COUNCIL-REVIEW",
        control_ref="MAP-REVIEW",
        mock_score=0.9,
    )
    evidence_id = execution["evidence"][0]["id"]
    finding = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        json={
            "finding_type": "compliance",
            "title": "Needs review",
            "summary": "A medium issue remains.",
            "severity": "medium",
            "confidence": 0.8,
            "dimension": "Task Fulfilment",
            "framework_refs": ["nist_ai_rmf:MAP-REVIEW"],
            "evidence_ids": [evidence_id],
            "recommended_action": "Review mitigation evidence.",
        },
    )
    assert finding.status_code == 201

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"notes": "Deliberate after metric execution."},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["verdict"]["label"] == "conditional_approval"
    assert result["verdict"]["action_tier"] == "supervised"
    assert result["open_finding_count"] == 1
    assert result["highest_severity"] == "medium"
    assert result["verdict"]["required_actions"][0]["action"] == (
        "Review mitigation evidence."
    )


def test_council_deliberation_blocks_failed_metric(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Blocked System",
        metric_id="COUNCIL-FAIL",
        control_ref="MAP-BLOCK",
        mock_score=0.2,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["failed_metric_count"] == 1
    assert result["verdict"]["label"] == "blocked"
    assert result["verdict"]["action_tier"] == "human_review"


def test_llm_calls_after_re_probe_remediation_are_still_logged(
    client: TestClient, monkeypatch
) -> None:
    """Fix regression test: deliberate() calls start_log_capture() once at the
    top and drain_log_capture() once at the very end. When the router picks a
    re_probe remediation mid-loop, deliberate() calls agent_execution.run_agents()
    directly (same thread, same contextvar scope) — and run_agents() ALSO does
    its own start/drain capture cycle, which used to leave the buffer at None
    once it returned. Every governance call deliberate() made AFTER that point
    (the next iteration's synthesis/devil's-advocate/verdict passes) was then
    silently dropped by GatewayGovernanceModelClient._append_log() instead of
    landing in LLMCallLog.

    This forces exactly that path: iteration 1's verdict is insufficient with
    remediation_type=re_probe, iteration 2's verdict is sufficient. Asserts the
    iteration-2 synthesis/verdict LLM calls made AFTER the re_probe still show
    up via GET /llm-calls.
    """
    run, _execution = prepare_run_with_metric(
        client,
        name="Council ReProbe System",
        metric_id="COUNCIL-REPROBE",
        control_ref="MAP-REPROBE",
        # Must PASS. This test needs the re_probe remediation path to actually be
        # taken, and the router now short-circuits an insufficient verdict when a
        # metric has conclusively failed — no remediation path re-runs metric
        # execution, so iterating on a failed metric can never change the outcome
        # (see test_council_conclusive_exit.py). A passing metric keeps the
        # shortfall genuinely remediable, which is the case remediation exists for.
        mock_score=0.95,
    )

    # Patch _parse_verdict (not adjudicate() itself) so the real governance
    # client call still happens and is still logged normally through the
    # Gateway wrapper — only the *parsed decision* is forced, based on the
    # iteration number _parse_verdict already receives as an argument.
    def fake_parse_verdict(content, iteration):
        if iteration == 1:
            return VerdictOutput(
                confidence_score=0.5,
                sufficient=False,
                label="conditional_approval",
                action_tier=ActionTier.supervised,
                reasoning="Iteration 1: sample size is too small to be confident.",
                remediation_type="re_probe",
                target_agent="bias_agent",
            )
        return VerdictOutput(
            confidence_score=0.9,
            sufficient=True,
            label="approved",
            action_tier=ActionTier.autonomous,
            reasoning="Iteration 2: additional sampling resolved the concern.",
            remediation_type=None,
            target_agent=None,
        )

    monkeypatch.setattr(
        "app.services.deliberation_council.verdict_agent._parse_verdict",
        fake_parse_verdict,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"requested_by": "test"},
    )
    assert response.status_code == 201
    result = response.json()
    assert result["verdict"]["label"] == "approved"
    # Two Council passes ran: iteration 1 (re_probe) then iteration 2 (sufficient).
    assert "[Council iterations: 2" in result["verdict"]["reasoning"]

    calls = client.get(f"/api/v1/evaluation-runs/{run['id']}/llm-calls").json()["calls"]
    governance_tasks = [c["task"] for c in calls if c["call_type"] == "governance"]

    # Both iterations' synthesis and verdict calls must be present — before the
    # fix, only iteration 1's calls made it in; iteration 2's were silently
    # dropped because run_agents()'s own drain_log_capture() left the shared
    # buffer at None once the re_probe finished.
    assert governance_tasks.count("council_synthesis") == 2
    assert governance_tasks.count("council_verdict") == 2

    # The re_probe itself actually ran the named specialist agent again (its own
    # LLM calls, if any, are written directly to LLMCallLog by run_agents()'s own
    # drain — independent of the parent buffer fix being tested above).
    executions = client.get(
        f"/api/v1/evaluation-runs/{run['id']}/agents/executions"
    ).json()
    assert any(e["agent_name"] == "bias_agent" for e in executions), (
        "expected the re_probe to have re-run bias_agent"
    )


def test_council_deliberation_rejects_existing_verdict(client: TestClient) -> None:
    run, _execution = prepare_run_with_metric(
        client,
        name="Council Duplicate Verdict System",
        metric_id="COUNCIL-DUP",
        control_ref="MAP-DUP",
        mock_score=0.9,
    )
    url = f"/api/v1/evaluation-runs/{run['id']}/council/deliberate"
    assert client.post(url, json={}).status_code == 201

    response = client.post(url, json={})

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {
        "resource": "Verdict",
        "field": "run_id",
        "value": run["id"],
    }


def test_council_deliberation_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/council/deliberate",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
