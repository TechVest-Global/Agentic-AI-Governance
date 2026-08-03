"""Probes must be attributable to the endpoint they were sent to.

A system registered with several capability endpoints is several independent
audit surfaces. The run recorded one probe total across all of them, so a run
that fired every probe at one endpoint and none at another was indistinguishable
from one that covered both — and nothing in the audit record could tell a reader
which surfaces the report actually spoke for.

The endpoint was known when each probe was planned and then dropped on the way
to storage; its only trace was a "probe_name@endpoint" suffix glued into the
call's task name, present only when a system had more than one endpoint and
existing to keep dict keys unique rather than to attribute anything.
"""

from uuid import UUID, uuid4

import app.db.session as db_session
from app.models.llm_call_log import LLMCallLog
from app.services.action_reporting.endpoint_coverage import build_endpoint_coverage
from fastapi.testclient import TestClient
from sqlmodel import Session

TEXT_ENDPOINT = "http://localhost:8001/api/compliance/probe/text"
IMAGE_ENDPOINT = "http://localhost:8001/api/compliance/probe/image"


def create_system(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
            "owner": "AI Governance",
            "system_type": "content_generation",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def add_capability(client: TestClient, system_id: str, name: str, endpoint: str, modality: str):
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities",
        json={"name": name, "endpoint_ref": endpoint, "modality": modality},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_metrics": []},
    )
    assert response.status_code == 201
    return response.json()


def log_target_call(
    run_id: str,
    *,
    endpoint: str | None,
    status: str = "success",
    attempts: int = 1,
    agent: str = "bias_agent",
    error_type: str | None = None,
    error_detail: str | None = None,
) -> None:
    with Session(db_session.engine) as session:
        session.add(
            LLMCallLog(
                run_id=UUID(run_id),
                agent_name=agent,
                task="ai_generated_disclosure",
                call_type="target",
                model="target-model",
                client_mode="live",
                status=status,
                endpoint_ref=endpoint,
                attempts=attempts,
                error_type=error_type,
                error_detail=error_detail,
            )
        )
        session.commit()


def _two_endpoint_run(client: TestClient, name: str) -> dict:
    system = create_system(client, name)
    add_capability(client, system["id"], "probe_text", TEXT_ENDPOINT, "text")
    add_capability(client, system["id"], "probe_image", IMAGE_ENDPOINT, "image")
    return create_run(client, system["id"])


def test_probes_are_attributed_to_the_endpoint_they_hit(client: TestClient) -> None:
    run = _two_endpoint_run(client, "Split Coverage System")
    for _ in range(3):
        log_target_call(run["id"], endpoint=TEXT_ENDPOINT)
    log_target_call(run["id"], endpoint=IMAGE_ENDPOINT, agent="quality_agent")

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/endpoint-coverage")
    assert response.status_code == 200
    by_ref = {e["endpoint_ref"]: e for e in response.json()["endpoints"]}

    assert by_ref[TEXT_ENDPOINT]["probes_sent"] == 3
    assert by_ref[TEXT_ENDPOINT]["capability_name"] == "probe_text"
    assert by_ref[TEXT_ENDPOINT]["agents"] == ["bias_agent"]
    assert by_ref[IMAGE_ENDPOINT]["probes_sent"] == 1
    assert by_ref[IMAGE_ENDPOINT]["modality"] == "image"


def test_a_registered_endpoint_that_received_nothing_is_reported_not_omitted(
    client: TestClient,
) -> None:
    """The whole point: silence about a surface must not read as coverage."""
    run = _two_endpoint_run(client, "Unprobed Surface System")
    for _ in range(5):
        log_target_call(run["id"], endpoint=TEXT_ENDPOINT)

    coverage = client.get(f"/api/v1/evaluation-runs/{run['id']}/endpoint-coverage").json()
    assert coverage["registered_endpoint_count"] == 2
    assert coverage["unprobed_endpoint_count"] == 1

    by_ref = {e["endpoint_ref"]: e for e in coverage["endpoints"]}
    assert by_ref[IMAGE_ENDPOINT]["probes_sent"] == 0
    assert by_ref[IMAGE_ENDPOINT]["registered"] is True
    # Unprobed surfaces sort first — they are the finding, not a footnote.
    assert coverage["endpoints"][0]["endpoint_ref"] == IMAGE_ENDPOINT


def test_requests_and_probes_are_counted_separately(client: TestClient) -> None:
    """Retries must not inflate the probe count, nor vanish from the load count.

    One throttled probe is three HTTP requests into the audited system. Counting
    log rows as requests understates real load; counting requests as probes
    triples the probe count. Both numbers are reported.
    """
    run = _two_endpoint_run(client, "Retry Counting System")
    log_target_call(run["id"], endpoint=TEXT_ENDPOINT, attempts=3)
    log_target_call(run["id"], endpoint=TEXT_ENDPOINT, attempts=1)

    by_ref = {
        e["endpoint_ref"]: e
        for e in client.get(
            f"/api/v1/evaluation-runs/{run['id']}/endpoint-coverage"
        ).json()["endpoints"]
    }
    assert by_ref[TEXT_ENDPOINT]["probes_sent"] == 2
    assert by_ref[TEXT_ENDPOINT]["requests_made"] == 4


def test_failed_probes_carry_the_targets_own_explanation(client: TestClient) -> None:
    run = _two_endpoint_run(client, "Failing Endpoint System")
    log_target_call(
        run["id"],
        endpoint=TEXT_ENDPOINT,
        status="error",
        error_type="TargetHTTPError",
        error_detail="HTTP Error 502: Bad Gateway — GPT-4o call failed: quota exceeded",
    )

    by_ref = {
        e["endpoint_ref"]: e
        for e in client.get(
            f"/api/v1/evaluation-runs/{run['id']}/endpoint-coverage"
        ).json()["endpoints"]
    }
    entry = by_ref[TEXT_ENDPOINT]
    assert entry["probes_sent"] == 0
    assert entry["probes_failed"] == 1
    assert entry["error_types"] == {"TargetHTTPError": 1}
    assert "quota exceeded" in entry["sample_error"]


def test_calls_predating_the_endpoint_column_are_unattributed_not_miscredited(
    client: TestClient,
) -> None:
    """Rows written before endpoint_ref existed must not be credited to a surface."""
    run = _two_endpoint_run(client, "Legacy Rows System")
    log_target_call(run["id"], endpoint=None)

    coverage = client.get(f"/api/v1/evaluation-runs/{run['id']}/endpoint-coverage").json()
    unattributed = [e for e in coverage["endpoints"] if e["endpoint_ref"] is None]
    assert len(unattributed) == 1
    assert unattributed[0]["registered"] is False
    assert unattributed[0]["probes_sent"] == 1
    # ...and both real endpoints still read as unprobed, because they were.
    assert coverage["unprobed_endpoint_count"] == 2


def test_coverage_for_a_missing_run_is_a_404(client: TestClient) -> None:
    response = client.get(f"/api/v1/evaluation-runs/{uuid4()}/endpoint-coverage")
    assert response.status_code == 404


def test_build_endpoint_coverage_tolerates_an_unknown_run(client: TestClient) -> None:
    """The service is called from report building; it must not explode there."""
    with Session(db_session.engine) as session:
        result = build_endpoint_coverage(session, run_id=uuid4())
    assert result.endpoints == []


def test_a_run_that_misses_a_registered_endpoint_records_a_coverage_gap_finding(
    client: TestClient, monkeypatch
) -> None:
    """The claim has to survive into the findings, not just a side panel.

    Emitted inside the agent phase so it is covered by the content digest the
    orchestrator checkpoints — a coverage claim bolted on afterwards would sit
    outside the integrity record it belongs to.
    """
    from app.schemas.governance import FindingCreate
    from app.services.agents.base import AgentContext
    from app.services.model_clients.gateway import _append_log

    class _OneEndpointAgent:
        """Probes only the text endpoint, leaving the image endpoint untouched."""

        execution_mode = "model_backed"
        aggregates_peer_findings = False
        name = "bias_agent"

        def evaluate(self, context: AgentContext) -> list[FindingCreate]:
            _append_log({
                "task": "ai_generated_disclosure",
                "call_type": "target",
                "endpoint_ref": TEXT_ENDPOINT,
                "model": "target-model",
                "deployment_name": None,
                "client_mode": "live",
                "routed_via": None,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "estimated_cost_usd": None,
                "latency_ms": 5,
                "status": "success",
                "request_chars": 10,
                "response_chars": 10,
                "trace_id": None,
                "policy_flags": [],
            })
            return []

    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None, **_kwargs: [_OneEndpointAgent()],
    )

    run = _two_endpoint_run(client, "Coverage Gap Finding System")
    response = client.post(f"/api/v1/evaluation-runs/{run['id']}/agents/run", json={})
    assert response.status_code == 201

    findings = client.get(f"/api/v1/evaluation-runs/{run['id']}/findings").json()
    gaps = [
        f for f in findings
        if (f.get("payload") or {}).get("generated_by") == "unprobed_endpoint_gate"
    ]
    assert len(gaps) == 1, f"expected one endpoint coverage gap, got {findings}"
    assert gaps[0]["severity"] == "info"
    assert "probe_image" in gaps[0]["summary"]
    assert gaps[0]["payload"]["endpoints"] == [
        {"endpoint_ref": IMAGE_ENDPOINT, "capability_name": "probe_image"}
    ]
