"""An agent abandoned at the phase budget must still leave an audit record.

``pool.shutdown(wait=False)`` deliberately does not block on stragglers, so a
single hung agent can never park a run. But the abandoned thread keeps running:
it keeps probing the live target system, keeps committing execution artifacts on
its own session, and keeps appending to the run's LLM-call capture buffer — all
against a run whose execution row already says it failed with a timeout.

None of that was recorded. The audit trail asserted the agent produced nothing
while its side effects were quietly landing in the database, and any LLM call it
made after the main thread drained the buffer vanished entirely.
"""

import threading
import time

from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.model_clients.gateway import _append_log
from fastapi.testclient import TestClient

from tests.test_agent_routes import create_run, create_system

_BUDGET_SECONDS = 0.3
_STRAGGLER_EXTRA_SECONDS = 1.2


class _PromptAgent:
    """Finishes well inside the phase budget."""

    execution_mode = "model_backed"
    aggregates_peer_findings = False
    name = "prompt_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        return [
            FindingCreate(
                finding_type="quality",
                title="prompt finding",
                summary="produced before the budget expired",
                dimension="quality",
                agent_name=self.name,
            )
        ]


class _StragglerAgent:
    """Overruns the budget, then keeps working — exactly the abandoned case.

    Emits an LLM-call log entry AFTER the main thread has finished draining the
    buffer, which is the call that used to be silently dropped.
    """

    execution_mode = "model_backed"
    aggregates_peer_findings = False
    name = "straggler_agent"

    def __init__(self) -> None:
        self.finished = threading.Event()

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        time.sleep(_STRAGGLER_EXTRA_SECONDS)
        _append_log(
            {
                "task": "late_probe",
                "call_type": "target",
                "model": "straggler-model",
                "deployment_name": None,
                "client_mode": "live",
                "routed_via": None,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "estimated_cost_usd": None,
                "latency_ms": 1,
                "status": "success",
                "request_chars": 1,
                "response_chars": 1,
                "trace_id": None,
                "policy_flags": [],
            }
        )
        self.finished.set()
        return [
            FindingCreate(
                finding_type="quality",
                title="too late",
                summary="produced after the phase was closed",
                dimension="quality",
                agent_name=self.name,
            )
        ]


def test_agent_abandoned_at_the_budget_is_recorded_in_the_ledger(
    client: TestClient, monkeypatch
) -> None:
    straggler = _StragglerAgent()
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None, **_kwargs: [_PromptAgent(), straggler],
    )
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.agent_execution_budget_seconds",
        lambda: _BUDGET_SECONDS,
    )

    system = create_system(client, name="Straggler Agent System")
    run = create_run(client, system["id"], [])

    response = client.post(f"/api/v1/evaluation-runs/{run['id']}/agents/run", json={})
    assert response.status_code == 201

    executions = {e["agent_name"]: e for e in response.json()["executions"]}
    assert executions["straggler_agent"]["status"] == "failed"
    assert executions["straggler_agent"]["error_summary"]["error_type"] == "TimeoutError"

    # The straggler runs on past the response. Wait for it, then for its
    # done-callback, which fires on the same thread immediately afterward.
    assert straggler.finished.wait(timeout=10)

    entries = _await_orphan_entry(client, run["id"])
    assert len(entries) == 1, f"expected one orphan record, got {entries}"
    payload = entries[0]["payload"]
    assert payload["agent_name"] == "straggler_agent"
    assert payload["outcome"] == "completed"
    # Its findings are deliberately discarded — the phase is closed and its
    # content digest already checkpointed — but the loss is recorded, not
    # implied by an absence.
    assert payload["findings_discarded"] == 1
    # The LLM call it made after the main thread drained the buffer is recovered
    # rather than dropped.
    assert payload["late_llm_calls_recovered"] == 1

    calls = client.get(f"/api/v1/evaluation-runs/{run['id']}/llm-calls").json()
    assert any(c["task"] == "late_probe" for c in calls["calls"]), (
        "the straggler's post-drain LLM call was not persisted"
    )


def _await_orphan_entry(client: TestClient, run_id: str) -> list[dict]:
    """Poll the ledger briefly; the callback runs on the straggler's own thread."""
    deadline = time.monotonic() + 10
    entries: list[dict] = []
    while time.monotonic() < deadline:
        entries = [
            e
            for e in client.get(f"/api/v1/evaluation-runs/{run_id}/ledger").json()
            if e["event_type"] == "agent.orphaned_after_timeout"
        ]
        if entries:
            return entries
        time.sleep(0.05)
    return entries
