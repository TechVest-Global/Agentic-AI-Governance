"""Covers real re_plan cross-agent routing.

Previously remediation_type == "re_plan" was explicitly inert — treated as
re_deliberate with no new evidence, even though the whole point of an upheld
"scope_gap" objection is that a dimension was never probed. re_plan now
activates a dormant specialist (one with no completed execution yet this
run) matched from the upheld objection's own text, distinct from re_probe
(which re-samples a dimension an agent already covered).
"""

from uuid import UUID

import app.db.session as db_session
from app.models.agent import AgentExecution
from app.models.enums import AgentExecutionStatus
from app.services.deliberation_council import deliberation
from app.services.deliberation_council.devils_advocate_agent import Objection
from fastapi.testclient import TestClient
from sqlmodel import Session, select


def create_system(client: TestClient, *, name: str) -> dict[str, object]:
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
        json={"ai_system_id": system_id, "selected_frameworks": ["nist_ai_rmf"]},
    )
    assert response.status_code == 201
    return response.json()


def _objection(objection_id: str, argument: str) -> Objection:
    return Objection(
        objection_id=objection_id,
        target_agent=None,
        category="scope_gap",
        argument=argument,
        suggested_fix="Activate the missing specialist.",
        remediation_hint="re_plan",
    )


def test_re_plan_activates_a_dormant_specialist_named_by_an_upheld_objection(
    client: TestClient,
) -> None:
    system = create_system(client, name="Re-plan Activation System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])
    objection = _objection(
        "da-001", "The compliance dimension was never assessed for this system."
    )

    with Session(db_session.engine) as session:
        deliberation._apply_remediation(
            session,
            run_id=run_id,
            remediation_type="re_plan",
            target_agent=None,
            objections=[objection],
            objections_upheld=["da-001"],
        )

    with Session(db_session.engine) as session:
        executions = session.exec(
            select(AgentExecution).where(AgentExecution.run_id == run_id)
        ).all()
    assert any(
        e.agent_name == "compliance_mapper" and e.status == AgentExecutionStatus.completed
        for e in executions
    )

    ledger_events = [
        e["event_type"] for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert "remediation.re_plan_activated" in ledger_events


def test_re_plan_is_a_no_op_when_no_upheld_objection_names_a_real_dimension(
    client: TestClient,
) -> None:
    system = create_system(client, name="Re-plan No-op System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])
    objection = _objection("da-001", "This is a generic methodology concern, nothing specific.")

    with Session(db_session.engine) as session:
        deliberation._apply_remediation(
            session,
            run_id=run_id,
            remediation_type="re_plan",
            target_agent=None,
            objections=[objection],
            objections_upheld=["da-001"],
        )

    with Session(db_session.engine) as session:
        executions = session.exec(
            select(AgentExecution).where(AgentExecution.run_id == run_id)
        ).all()
    assert executions == []

    ledger_events = [
        e["event_type"] for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
    ]
    assert "remediation.re_plan_activated" not in ledger_events


def test_re_plan_does_not_reactivate_a_dimension_already_covered_this_run(
    client: TestClient,
) -> None:
    system = create_system(client, name="Re-plan Already Covered System")
    run = create_run(client, system["id"])
    run_id = UUID(run["id"])

    with Session(db_session.engine) as session:
        session.add(
            AgentExecution(
                run_id=run_id,
                agent_name="compliance_mapper",
                status=AgentExecutionStatus.completed,
            )
        )
        session.commit()

    objection = _objection(
        "da-001", "The compliance dimension was never assessed for this system."
    )
    with Session(db_session.engine) as session:
        target_agent, matched_dimension = deliberation._resolve_re_plan_target(
            session, run_id=run_id, upheld_objections=[objection]
        )

    # compliance_mapper already ran this run — re_plan must not pick it again,
    # that's what re_probe is for.
    assert target_agent is None
    assert matched_dimension is None
