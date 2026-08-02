"""A verdict must be traceable to whoever or whatever produced it.

The Verdict table holds no provenance column, and ``POST /verdict`` accepted a
verdict for a run in any state. Because a run can hold exactly one verdict, a row
written before the run reached the council did not merely sit there unnoticed: it
made ``deliberate()`` raise ResourceConflictError, and the pipeline's handler for
that treated the conflict as "the council already decided" and adopted the
existing row. A planted verdict became the run's official council outcome,
quoted in the report and exported, with nothing in the hash chain to show where
it came from.

Three layers now stand in the way, and each is pinned here: the phase gate, the
mandatory attribution plus ledger entry, and the pipeline's provenance check.
"""

from uuid import UUID

import app.db.session as db_session
from app.models.enums import RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.verdict import Verdict
from app.services import verdicts as verdict_service
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import advance_run_to_council


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


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_metrics": ["M01"]},
    )
    assert response.status_code == 201
    return response.json()


def test_verdict_cannot_be_recorded_before_the_run_reaches_the_council(
    client: TestClient,
) -> None:
    system = create_system(client, "Premature Verdict System")
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={"label": "approved", "confidence_score": 1.0},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RUN_NOT_READY_FOR_VERDICT"
    assert response.json()["error"]["details"]["current_phase"] == "created"


def test_manually_recorded_verdict_is_attributed_in_the_ledger(client: TestClient) -> None:
    system = create_system(client, "Manual Verdict System")
    run = create_run(client, system["id"])
    advance_run_to_council(run["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={"label": "approved", "confidence_score": 0.8},
    )
    assert response.status_code == 201

    entries = [
        e
        for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
        if e["event_type"] == "verdict.recorded_manually"
    ]
    assert len(entries) == 1
    # Attribution comes from the authenticated token (conftest signs the suite in
    # as the demo dev user), never from the request body.
    assert entries[0]["actor_id"] == "dev@governai.com"
    assert entries[0]["actor_type"] == "user"
    assert entries[0]["payload"]["label"] == "approved"

    # The chain still verifies with the new entry folded in.
    assert client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger/verify").json()["valid"]


def test_verdict_recorded_without_an_identity_is_refused(client: TestClient) -> None:
    system = create_system(client, "Anonymous Verdict System")
    run = create_run(client, system["id"])
    advance_run_to_council(run["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={"label": "approved"},
        headers={"Authorization": ""},
    )

    assert response.status_code == 401


def test_council_produced_verdict_is_distinguishable_from_a_manual_one(
    client: TestClient,
) -> None:
    """The ledger is the provenance record the Verdict table lacks."""
    system = create_system(client, "Provenance System")
    run = create_run(client, system["id"])
    advance_run_to_council(run["id"])

    assert client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={"label": "approved"},
    ).status_code == 201

    with Session(db_session.engine) as session:
        assert not verdict_service.council_produced_verdict(session, run_id=UUID(run["id"]))


def test_pipeline_refuses_to_adopt_a_verdict_the_council_did_not_produce(
    client: TestClient,
) -> None:
    """The exploit itself: a verdict planted mid-run must not become the outcome.

    Written directly to the database rather than through the route, because the
    route's own phase gate now blocks the pre-council case — this reproduces an
    attacker who reached the row by any means, and asserts the pipeline still
    refuses it rather than relying on a single layer holding.
    """
    system = create_system(client, "Planted Verdict System")
    run = create_run(client, system["id"])

    with Session(db_session.engine) as session:
        session.add(
            Verdict(
                run_id=UUID(run["id"]),
                label="approved",
                confidence_score=1.0,
                reasoning="planted, never deliberated",
            )
        )
        stored_run = session.get(EvaluationRun, UUID(run["id"]))
        stored_run.status = RunStatus.agents_running
        stored_run.current_phase = RunPhase.specialist_agents
        session.add(stored_run)
        session.commit()

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"requested_by": "pipeline"},
    )
    # deliberate() still reports the one-verdict-per-run conflict...
    assert response.status_code == 409

    # ...and the pipeline no longer launders the planted row into a completed
    # run. It fails, loudly, with the reason recorded.
    orchestrate = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/orchestrate", json={}
    )
    assert orchestrate.status_code in (200, 202)

    final = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()
    assert final["status"] == "failed", (
        f"a planted verdict was accepted; run ended as {final['status']}"
    )
    assert final["error_summary"]["error_code"] == "VERDICT_NOT_COUNCIL_PRODUCED"
