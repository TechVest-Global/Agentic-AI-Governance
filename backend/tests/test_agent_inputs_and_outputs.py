"""Every agent execution must record what it was given and what it returned.

An execution row said only how the agent was SCHEDULED. Its outputs arrived at
the end, and its inputs were never recorded at all — so an agent that failed,
timed out, or exited early left an error string and nothing else. On a live
TechVest run whose target was out of quota, six of seven agents failed that way:
the audit record could not answer "what was bias_agent even looking at?", and
because the report counts findings, six silent failures read as a clean result.

Two guarantees are tested here:
  * inputs are on the row while the agent is still running, and survive failure;
  * a failed agent still contributes a finding, so lost coverage is visible in
    the evidence package rather than only in a column no report renders.
"""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient


def _system(client: TestClient) -> str:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Agent IO Chatbot",
            "owner": "governance",
            "system_type": "chatbot",
            "risk_tier": "medium",
            "selected_frameworks": ["eu_ai_act"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _run(client: TestClient, system_id: str) -> str:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_frameworks": ["eu_ai_act"]},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _executions(client: TestClient, run_id: str) -> list[dict]:
    response = client.get(f"/api/v1/evaluation-runs/{run_id}/agents/executions")
    assert response.status_code == 200, response.text
    return response.json()


def test_an_execution_records_the_inputs_the_agent_was_given(client: TestClient) -> None:
    system_id = _system(client)
    run_id = _run(client, system_id)

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )
    assert response.status_code == 201, response.text

    execution = _executions(client, run_id)[0]
    inputs = execution["metadata_json"]["inputs"]

    assert inputs["dimension"], "an agent must name the dimension it was asked to cover"
    assert "assigned_metric_ids" in inputs
    assert "assigned_metric_states" in inputs
    # Readable names travel WITH the ids. "CM-017" identifies a metric but does
    # not describe one, and taking the label from the run's own metric plan means
    # the UI can never show a name that drifted from the catalog actually used.
    assert "assigned_metrics" in inputs
    for entry in inputs["assigned_metrics"]:
        assert entry["metric_id"]
        assert entry["name"], f"no name carried for {entry['metric_id']}"
    for state in inputs["assigned_metric_states"]:
        assert state["name"], f"no name carried for {state['metric_id']}"
        assert "dimension" in state
    assert "audit_scope_capabilities" in inputs
    # Counts of the evidence set it could see, so "it saw nothing" is provable.
    for key in ("visible_metric_results", "visible_evidence_records", "visible_prior_findings"):
        assert isinstance(inputs[key], int), key


def test_an_execution_records_what_the_agent_returned(client: TestClient) -> None:
    system_id = _system(client)
    run_id = _run(client, system_id)

    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    outputs = _executions(client, run_id)[0]["metadata_json"]["outputs"]
    assert set(outputs) >= {
        "probes_sent",
        "probes_skipped",
        "finding_count",
        "findings_by_severity",
        "finding_titles",
        "error",
    }
    assert isinstance(outputs["finding_titles"], list)


def test_a_failed_agent_still_records_its_inputs(client: TestClient, monkeypatch) -> None:
    """The failure case is the whole point — outputs are empty, inputs are not."""
    from app.services.agents.model_backed import bias_agent as bias_module

    def _explode(self, context):  # noqa: ANN001, ANN202
        raise RuntimeError("target refused the probe")

    monkeypatch.setattr(bias_module.BiasAuditorAgent, "evaluate", _explode)

    system_id = _system(client)
    run_id = _run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    execution = _executions(client, run_id)[0]
    assert execution["status"] == "failed"
    assert execution["metadata_json"]["inputs"]["dimension"]
    assert execution["metadata_json"]["outputs"]["error"]["error_type"] == "RuntimeError"


def test_a_failed_agent_contributes_a_finding_so_the_gap_is_visible(
    client: TestClient, monkeypatch
) -> None:
    """Six silent failures used to leave a report reading as clean."""
    from app.services.agents.model_backed import bias_agent as bias_module

    def _explode(self, context):  # noqa: ANN001, ANN202
        raise RuntimeError("HTTP Error 429: Too Many Requests")

    monkeypatch.setattr(bias_module.BiasAuditorAgent, "evaluate", _explode)

    system_id = _system(client)
    run_id = _run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    findings = client.get(f"/api/v1/evaluation-runs/{run_id}/findings").json()
    failure_findings = [
        f for f in findings if (f.get("payload") or {}).get("generated_by") == "agent_failure"
    ]
    assert failure_findings, "a failed agent left no finding — its lost coverage is invisible"
    finding = failure_findings[0]
    assert finding["severity"] == "high", "an audit failure is not an informational note"
    assert "429" in finding["summary"], "the record must say WHY coverage was lost"
    # And the execution row agrees with the evidence package.
    assert _executions(client, run_id)[0]["finding_count"] == len(failure_findings)


def test_a_plan_is_never_reported_as_probes_that_were_sent(
    client: TestClient, monkeypatch
) -> None:
    """The number that used to lie.

    Probe planning writes its count before probing happens. That count lived in
    probe_counts, so when the probe run then raised — an unreachable or
    out-of-quota target — the PLAN was reported as though it had been sent. A
    live 42-metric run against a throttled chatbot claimed 79 probes across five
    agents when 3 actually reached it, and the UI's "Probes Sent" tile sums
    exactly this field.
    """
    from app.services.agents.model_backed import bias_agent as bias_module

    def _plan_then_fail(self, context):  # noqa: ANN001, ANN202
        # Exactly the real shape: record a plan, then die before sending.
        context.probe_plan_counts[self.name] = 18
        raise RuntimeError("Target quota exhausted — no further probes were sent")

    monkeypatch.setattr(bias_module.BiasAuditorAgent, "evaluate", _plan_then_fail)

    system_id = _system(client)
    run_id = _run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    execution = _executions(client, run_id)[0]
    metadata = execution["metadata_json"]

    assert metadata["probe_count"] == 0, (
        f"reported {metadata['probe_count']} probes sent when none reached the target"
    )
    # The plan is not lost — it is just no longer mislabelled as evidence.
    assert metadata["probes_planned"] == 18
    assert metadata["outputs"]["probes_sent"] == 0
    assert metadata["outputs"]["probes_not_sent"] == 18


def test_a_successful_agent_gets_no_synthetic_failure_finding(client: TestClient) -> None:
    system_id = _system(client)
    run_id = _run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["bias_agent"]},
    )

    findings = client.get(f"/api/v1/evaluation-runs/{run_id}/findings").json()
    assert not [
        f for f in findings if (f.get("payload") or {}).get("generated_by") == "agent_failure"
    ]


def test_the_aggregate_stage_is_held_to_the_phase_budget(client: TestClient, monkeypatch) -> None:
    """risk_scorer ran 7.8 HOURS against a 900s budget, because the timeout was
    an as_completed() bound on the fan-out pool and the aggregate agent ran
    inline on the request thread with nothing bounding it at all."""
    import time

    from app.services.agents.model_backed import risk_scorer as risk_module

    # Patch the names agent_execution imported, not the source module: it does
    # `from ... import agent_execution_budget_seconds`, so rebinding the setting
    # on concurrency_settings would not be seen here.
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.agent_execution_budget_seconds",
        lambda: 0.0,
    )
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution._AGGREGATE_MIN_BUDGET_SECONDS", 0.5
    )

    def _hang(self, context):  # noqa: ANN001, ANN202
        time.sleep(30)
        return []

    monkeypatch.setattr(risk_module.RiskScorerAgent, "evaluate", _hang)

    system_id = _system(client)
    run_id = _run(client, system_id)

    started = time.monotonic()
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": ["risk_scorer"]},
    )
    elapsed = time.monotonic() - started

    assert response.status_code == 201, response.text
    assert elapsed < 20, f"aggregate stage was not bounded — took {elapsed:.1f}s"
    execution = _executions(client, run_id)[0]
    assert execution["status"] == "failed"
    assert execution["error_summary"]["error_type"] == "TimeoutError"


@pytest.mark.parametrize("agent_name", ["bias_agent", "misuse_agent", "risk_scorer"])
def test_every_agent_type_records_both_halves(client: TestClient, agent_name: str) -> None:
    system_id = _system(client)
    run_id = _run(client, system_id)
    client.post(
        f"/api/v1/evaluation-runs/{run_id}/agents/run",
        json={"agent_names": [agent_name]},
    )

    execution = _executions(client, run_id)[0]
    assert UUID(execution["run_id"]) == UUID(run_id)
    assert "inputs" in execution["metadata_json"], agent_name
    assert "outputs" in execution["metadata_json"], agent_name
