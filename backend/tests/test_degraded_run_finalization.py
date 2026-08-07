"""A crash after a run degrades must still be reported as a crash.

``run_metrics`` and ``run_agents`` set ``degraded`` the moment something fails,
while the council and report phases are still ahead. ``_finalize_run`` treated
``degraded`` as fully terminal and no-opped, which was right for the success
finalize (a degraded run must not be quietly upgraded to ``completed``) but wrong
for the failure finalize: a run that degraded in the agent phase and then
genuinely crashed in the council was left at ``degraded`` with no error_summary
and no completed_at. The crash existed only in the logs, and since ``degraded``
is absent from _INTERRUPTED_STATUSES, startup reconciliation never revisited it.
"""

from uuid import UUID

import app.db.session as db_session
from app.models.enums import RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.services import orchestration
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.test_verdict_provenance import create_run, create_system


def _set_state(run_id: str, *, status: RunStatus, phase: RunPhase, error=None) -> None:
    with Session(db_session.engine) as session:
        run = session.get(EvaluationRun, UUID(run_id))
        run.status = status
        run.current_phase = phase
        if error is not None:
            run.error_summary = error
        session.add(run)
        session.commit()


def _read(run_id: str) -> EvaluationRun:
    with Session(db_session.engine) as session:
        return session.get(EvaluationRun, UUID(run_id))


def test_failure_finalize_overrides_a_mid_pipeline_degraded_status(
    client: TestClient,
) -> None:
    system = create_system(client, "Degraded Then Crashed System")
    run = create_run(client, system["id"])
    _set_state(
        run["id"],
        status=RunStatus.degraded,
        phase=RunPhase.specialist_agents,
        error={"degraded_reason": "specialist_agent_failure", "failed_agents": ["bias_agent"]},
    )

    orchestration._finalize_run(
        UUID(run["id"]), status=RunStatus.failed, error=RuntimeError("council exploded")
    )

    final = _read(run["id"])
    assert final.status == RunStatus.failed
    assert final.completed_at is not None
    assert final.error_summary["message"] == "council exploded"
    # The degradation context is merged in, not discarded — it is what makes the
    # later crash diagnosable.
    assert final.error_summary["degraded_reason"] == "specialist_agent_failure"


def test_success_finalize_still_cannot_upgrade_a_degraded_run(client: TestClient) -> None:
    """The behaviour the old terminal set existed to protect. It must survive."""
    system = create_system(client, "Degraded Stays Degraded System")
    run = create_run(client, system["id"])
    _set_state(run["id"], status=RunStatus.degraded, phase=RunPhase.specialist_agents)

    orchestration._finalize_run(UUID(run["id"]), status=RunStatus.completed)

    assert _read(run["id"]).status == RunStatus.degraded


def test_reconciliation_picks_up_a_run_abandoned_while_degraded(client: TestClient) -> None:
    system = create_system(client, "Degraded Interrupted System")
    run = create_run(client, system["id"])
    # Mid-pipeline degraded: the agent phase failed, the council never ran, and
    # the worker died. Nothing else will ever move this run.
    _set_state(run["id"], status=RunStatus.degraded, phase=RunPhase.specialist_agents)

    with Session(db_session.engine) as session:
        assert orchestration.reconcile_interrupted_runs(session) >= 1

    final = _read(run["id"])
    # Before the fix this run was invisible to reconciliation and stayed exactly
    # as it was. Whatever the resume attempt concluded, it must have concluded
    # something: the run is now terminal and no longer parked mid-phase.
    assert final.status in (RunStatus.completed, RunStatus.degraded, RunStatus.failed)
    assert final.completed_at is not None
    if final.status == RunStatus.degraded:
        assert final.current_phase == RunPhase.completed


def test_reconciliation_leaves_a_genuinely_finished_degraded_run_alone(
    client: TestClient,
) -> None:
    """``_finalize_run_status`` sets degraded WITH phase=completed. That is done."""
    system = create_system(client, "Degraded Complete System")
    run = create_run(client, system["id"])
    _set_state(run["id"], status=RunStatus.degraded, phase=RunPhase.completed)

    with Session(db_session.engine) as session:
        orchestration.reconcile_interrupted_runs(session)

    final = _read(run["id"])
    assert final.status == RunStatus.degraded
    assert final.current_phase == RunPhase.completed
    assert final.error_summary is None, "a finished degraded run was re-run and failed"
