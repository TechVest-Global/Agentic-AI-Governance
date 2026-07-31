"""Covers reconcile_interrupted_runs' resume behavior (worker-restart recovery).

Previously any run left at a non-terminal status when the process restarted
was unconditionally marked ``failed``, even a run merely parked awaiting
human plan approval (working as designed, not interrupted) and even a run
that could cleanly resume from where it left off. reconcile_interrupted_runs
now: (1) leaves awaiting-approval runs untouched, (2) actually resumes
everything else via resume_governance_pipeline, which skips whatever already
completed (see run_metrics/run_agents idempotent-resume logic), and (3) only
falls back to ``failed`` — with a real, ledger-recorded reason — if that
resume attempt itself raises.
"""

from uuid import UUID

import app.db.session as db_session
from app.models.agent import AgentExecution
from app.models.base import utc_now
from app.models.enums import RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.models.verdict import Verdict
from app.schemas.governance import MetricExecutionCreate
from app.services import orchestration
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents import metric_execution
from fastapi.testclient import TestClient
from sqlmodel import Session, select


def create_system(client: TestClient, name: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
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


def test_reconcile_leaves_awaiting_approval_runs_untouched(client: TestClient) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client, "Reconcile Approval Guard System")
    run = create_run(client, system["id"])

    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"agent_names": ["risk_scorer"], "require_plan_approval": True},
    )
    assert orchestrate.status_code == 202
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["status"] == "planned"

    with Session(db_session.engine) as session:
        reconciled = orchestration.reconcile_interrupted_runs(session)
    # A run legitimately waiting on a human is not "interrupted" — reconcile
    # must not touch it, let alone mark it failed.
    assert reconciled == 0

    still_planned = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert still_planned["status"] == "planned"
    assert still_planned["plan_approved_at"] is None


def test_reconcile_resumes_a_run_interrupted_mid_metrics_without_duplicating_work(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client, "Reconcile Resume System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])

    # Get a real, persisted evaluation plan without letting the pipeline run
    # any further (gate on approval, then approve directly on the DB row
    # instead of via POST /approve-plan — that endpoint kicks off the full
    # resume job immediately, which would race past the state we want to
    # inspect/manipulate below).
    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"agent_names": ["risk_scorer"], "require_plan_approval": True},
    )
    assert orchestrate.status_code == 202
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["status"] == "planned"

    with Session(db_session.engine) as session:
        db_run = get_run_or_raise(session, run_id)
        db_run.plan_approved_at = utc_now()
        db_run.plan_approved_by = "R. Sharma"
        session.add(db_run)
        session.commit()

        # Run metrics for real (both CM-005 and CM-026 complete normally),
        # but stop here — no agents/council/report yet, so no Verdict exists.
        # This is what a genuine crash-after-metrics-before-agents leaves
        # behind: a real evaluation plan, real metric results, nothing else.
        metric_execution.run_metrics(
            session,
            run_id=run_id,
            payload=MetricExecutionCreate(mock_score=1.0, evaluator_name="mock"),
        )

    with Session(db_session.engine) as session:
        results = session.exec(
            select(MetricResult).where(MetricResult.run_id == run_id)
        ).all()
        assert {r.metric_id for r in results} == {"CM-005", "CM-026"}

        # Simulate the worker restart happening right after this point: delete
        # CM-026's result/evidence (as if that one hadn't committed yet) and
        # park the run back at metrics_running/metric_execution.
        cm026 = next(r for r in results if r.metric_id == "CM-026")
        for evidence_id in cm026.evidence_ids:
            evidence = session.get(EvidenceRecord, UUID(evidence_id))
            if evidence is not None:
                session.delete(evidence)
        session.delete(cm026)
        db_run = get_run_or_raise(session, run_id)
        db_run.status = RunStatus.metrics_running
        db_run.current_phase = RunPhase.metric_execution
        db_run.updated_at = utc_now()
        session.add(db_run)
        session.commit()

    with Session(db_session.engine) as session:
        reconciled = orchestration.reconcile_interrupted_runs(session)
    assert reconciled == 1

    resumed = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert resumed["status"] == "completed"
    assert resumed["current_phase"] == "completed"

    report_after = client.get(f"/api/v1/evaluation-runs/{run['id']}/report").json()
    # Exactly 2 — CM-005 was reused as-is (not re-evaluated/duplicated) and
    # only CM-026 was actually re-run.
    assert report_after["counts"]["metric_results"] == 2
    result_by_metric = {m["metric_id"]: m for m in report_after["metric_results"]}
    assert set(result_by_metric) == {"CM-005", "CM-026"}

    ledger_events = [
        e["event_type"]
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert ledger_events.count("metric_execution.completed") == 1


def test_reconcile_resume_replays_the_original_explicit_agent_selection(
    client: TestClient,
) -> None:
    """Fix regression test (found via manual smoke test, not the automated
    suite): run.pipeline_payload used to only be captured when a run was
    gated on plan approval. A straight-through run interrupted mid-execution
    had no captured payload, so resume_governance_pipeline fell back to
    GovernancePipelineRunCreate() defaults — losing an explicit agent_names
    selection and silently running every plan-activated agent instead of
    only the one originally requested.
    """
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client, "Reconcile Explicit Agents System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])

    # No require_plan_approval — straight-through, with an explicit
    # single-agent selection.
    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"agent_names": ["risk_scorer"], "requested_by": "backend_test"},
    )
    assert orchestrate.status_code == 202
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["status"] == "completed"

    with Session(db_session.engine) as session:
        db_run = get_run_or_raise(session, run_id)
        assert db_run.pipeline_payload is not None
        assert db_run.pipeline_payload["agent_names"] == ["risk_scorer"]

        # Simulate a crash right after metrics finished but before any agent
        # executed: delete the Verdict/Finding/AgentExecution rows the
        # straight-through run already produced, park the run back at
        # agents_running. Deleting the Verdict is essential — reconcile's
        # "already reached council" shortcut checks for one, and leaving it
        # in place would short-circuit past the resume path entirely.
        verdict = session.exec(select(Verdict).where(Verdict.run_id == run_id)).first()
        if verdict is not None:
            session.delete(verdict)
        for finding in session.exec(select(Finding).where(Finding.run_id == run_id)).all():
            session.delete(finding)
        for execution in session.exec(
            select(AgentExecution).where(AgentExecution.run_id == run_id)
        ).all():
            session.delete(execution)
        db_run.status = RunStatus.agents_running
        db_run.current_phase = RunPhase.specialist_agents
        db_run.result_summary = None
        db_run.completed_at = None
        db_run.updated_at = utc_now()
        session.add(db_run)
        session.commit()

    with Session(db_session.engine) as session:
        reconciled = orchestration.reconcile_interrupted_runs(session)
    assert reconciled == 1

    executions = client.get(f"/api/v1/evaluation-runs/{run['id']}/agents/executions").json()
    # Only the originally-requested agent ran — not every agent the
    # evaluation plan happened to activate.
    assert [e["agent_name"] for e in executions] == ["risk_scorer"]


def test_reconcile_marks_run_failed_with_ledger_entry_when_resume_itself_fails(
    client: TestClient, monkeypatch,
) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code == 200
    system = create_system(client, "Reconcile Failure System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])

    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate",
        json={"agent_names": ["risk_scorer"], "require_plan_approval": True},
    )
    assert orchestrate.status_code == 202

    with Session(db_session.engine) as session:
        db_run = get_run_or_raise(session, run_id)
        # Approve, then park it back at a non-terminal status as if a worker
        # restart interrupted it mid-execution.
        db_run.plan_approved_at = utc_now()
        db_run.plan_approved_by = "R. Sharma"
        db_run.status = RunStatus.metrics_running
        db_run.current_phase = RunPhase.metric_execution
        session.add(db_run)
        session.commit()

    def boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated resume failure")

    monkeypatch.setattr(orchestration, "resume_governance_pipeline", boom)

    with Session(db_session.engine) as session:
        reconciled = orchestration.reconcile_interrupted_runs(session)
    assert reconciled == 1
    monkeypatch.undo()

    failed = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert failed["status"] == "failed"
    assert failed["error_summary"]["message"] == "simulated resume failure"

    ledger_events = [
        e for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    reconcile_failures = [e for e in ledger_events if e["event_type"] == "run.reconcile_failed"]
    assert len(reconcile_failures) == 1
    assert reconcile_failures[0]["payload"]["message"] == "simulated resume failure"
