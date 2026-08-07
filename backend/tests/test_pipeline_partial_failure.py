"""A lost verdict must not discard the evidence that was already collected.

The pipeline tolerates partial failure everywhere except at the end: a failed
metric degrades the run, a failed specialist agent degrades the run and says so
explicitly — but a council exception propagated out of the pipeline, the
background job marked the run `failed`, and NO report was produced, even though
every metric result and agent finding had already been committed.

The council is the most failure-prone phase in the pipeline: it is the only one
that needs a live judge model for every pass, so a judge outage, rate limit, or
cold start took the whole run down with it. These tests pin the corrected
behaviour: degrade, keep the evidence, report the reason.
"""

from app.models.enums import RunStatus
from fastapi.testclient import TestClient

from tests.test_agent_routes import create_run, create_system


def _orchestrate(client: TestClient, run_id: str) -> dict:
    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/orchestrate",
        json={"mock_score": 0.9, "requested_by": "test"},
    )
    assert response.status_code == 202
    return response.json()


def _run_state(client: TestClient, run_id: str) -> dict:
    response = client.get(f"/api/v1/evaluation-runs/{run_id}")
    assert response.status_code == 200
    return response.json()


def test_council_failure_degrades_the_run_and_still_reports(
    client: TestClient, monkeypatch
) -> None:
    """The realistic outage: the judge is unavailable for the council passes."""
    monkeypatch.setattr(
        "app.services.deliberation_council.deliberation.deliberate",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("judge endpoint unavailable")),
    )

    system = create_system(client, name="Council Outage System")
    run = create_run(client, system["id"], [])
    _orchestrate(client, run["id"])

    state = _run_state(client, run["id"])

    # Degraded, not failed — the distinction is the whole fix.
    assert state["status"] == RunStatus.degraded.value
    summary = state["error_summary"] or {}
    assert "council_failure" in summary["degraded_reason"]
    assert summary["council_failure"]["error"]["error_type"] == "RuntimeError"
    # The message must say plainly that there is no governance decision, rather
    # than leaving a reader to infer it from a missing verdict.
    assert "NO governance decision" in summary["council_failure"]["message"]

    # No verdict exists...
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/verdict").status_code == 404
    # ...but the evidence survived and the report still renders it.
    report = client.get(f"/api/v1/evaluation-runs/{run['id']}/report")
    assert report.status_code == 200
    assert report.json()["verdict"] is None


def test_council_partial_writes_are_rolled_back_not_committed(
    client: TestClient, monkeypatch
) -> None:
    """The subtle half of this fix: the session must be rolled back, not just caught.

    deliberate() can raise part-way through, leaving uncommitted writes on the
    shared session. Merely catching the exception would carry those half-written
    rows into the finalize commit below, so a failed deliberation would silently
    contribute phantom findings to the audit record — and, when the failure had
    poisoned the transaction, the report and the final run UPDATE would fail too
    and the run would end up `failed` and reportless despite the try/except.

    Asserted by the absence of the partial write: it can only be missing if the
    rollback actually ran.
    """
    from app.models.finding import Finding

    def explode_mid_transaction(session, **kwargs):
        session.add(Finding(
            run_id=kwargs["run_id"],
            finding_type="quality",
            title="phantom partial write",
            summary="written by the council before it failed",
            dimension="quality",
        ))
        session.flush()
        raise RuntimeError("boom after partial write")

    monkeypatch.setattr(
        "app.services.deliberation_council.deliberation.deliberate",
        explode_mid_transaction,
    )

    system = create_system(client, name="Dirty Session System")
    run = create_run(client, system["id"], [])
    _orchestrate(client, run["id"])

    state = _run_state(client, run["id"])
    # Reached a terminal status at all — one thing the rollback buys.
    assert state["status"] == RunStatus.degraded.value
    assert state["current_phase"] == "completed"
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/report").status_code == 200

    # The decisive assertion: the council's partial write never reached the DB.
    findings = client.get(f"/api/v1/evaluation-runs/{run['id']}/findings").json()
    titles = [f["title"] for f in findings]
    assert "phantom partial write" not in titles, (
        "a failed council's uncommitted findings leaked into the audit record — "
        "the rollback did not run"
    )


def test_clean_run_is_still_completed_not_degraded(client: TestClient) -> None:
    """Guard against the fix making every run look degraded."""
    system = create_system(client, name="Clean Pipeline System")
    run = create_run(client, system["id"], [])
    _orchestrate(client, run["id"])

    state = _run_state(client, run["id"])
    assert state["status"] == RunStatus.completed.value
    assert not (state["error_summary"] or {}).get("degraded_reason")


def test_multiple_partial_failures_are_all_recorded(
    client: TestClient, monkeypatch
) -> None:
    """Losing an agent AND the verdict must report both.

    Reporting only the first failure found would understate how incomplete the
    audit was — which is exactly the kind of quiet under-reporting this codebase
    treats as a governance defect.
    """
    from app.services.agents.base import AgentContext

    class FailingAgent:
        name = "failing_agent"
        execution_mode = "model_backed"
        aggregates_peer_findings = False

        def evaluate(self, context: AgentContext) -> list[object]:
            raise RuntimeError("agent tool unavailable")

    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None, **_kwargs: [FailingAgent()],
    )
    monkeypatch.setattr(
        "app.services.deliberation_council.deliberation.deliberate",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("judge endpoint unavailable")),
    )

    system = create_system(client, name="Double Failure System")
    run = create_run(client, system["id"], [])
    _orchestrate(client, run["id"])

    summary = _run_state(client, run["id"])["error_summary"] or {}
    assert "specialist_agent_failure" in summary["degraded_reason"]
    assert "council_failure" in summary["degraded_reason"]
    assert summary["specialist_agent_failure"]["failed_agents"][0]["agent_name"] == (
        "failing_agent"
    )
