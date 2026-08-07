"""Layer 3 execution model: specialist agents fan out in PARALLEL, and a
finding-aggregating agent runs after the barrier.

README.md specifies "Layer 3: Specialist Agents / Parallel agents for bias,
drift, misuse, compliance, explainability, and risk", and SPEC.md FR-024 forbids
agent-to-agent messaging precisely so that fan-out is sound. The implementation
had drifted to a sequential for-loop: AgentContext is frozen and was built once
before the loop, so RiskScorer — which per risk_contract.py aggregates "all
findings accumulated so far in the run" — saw a stale, empty finding set. The
fix for THAT bug (re-querying findings inside the loop) required sequential
ordering and silently cost the whole layer its concurrency.

These tests pin the corrected model so it cannot drift back:
  * peer-independent agents genuinely overlap in time
  * the aggregating agent observes a COMPLETE set of peer findings
  * the scheduling decision is recorded as evidence on each execution row
"""

import threading
import time
from datetime import datetime

from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from fastapi.testclient import TestClient

from tests.test_agent_routes import create_run, create_system

# Long enough that a sequential run is unmistakably slower than a parallel one,
# short enough to keep the suite fast. Three agents sequentially = 1.2s; in
# parallel = ~0.4s.
_AGENT_WORK_SECONDS = 0.4


class _SleepingAgent:
    """Peer-independent agent: sleeps (standing in for network I/O), then reports."""

    execution_mode = "model_backed"
    aggregates_peer_findings = False

    def __init__(self, name: str) -> None:
        self.name = name
        self.thread_name: str | None = None

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        self.thread_name = threading.current_thread().name
        time.sleep(_AGENT_WORK_SECONDS)
        return [
            FindingCreate(
                finding_type="quality",
                title=f"{self.name} finding",
                summary=f"produced by {self.name}",
                dimension="quality",
                agent_name=self.name,
            )
        ]


class _AggregatingAgent:
    """Stands in for RiskScorer: its output is a function of its peers' findings."""

    name = "risk_scorer"
    execution_mode = "model_backed"
    aggregates_peer_findings = True

    def __init__(self) -> None:
        self.peer_findings_seen: int = 0

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        self.peer_findings_seen = len(context.existing_findings)
        return [
            FindingCreate(
                finding_type="risk_summary",
                title="composite risk",
                summary=f"aggregated {self.peer_findings_seen} findings",
                dimension="risk",
                agent_name=self.name,
            )
        ]


def _install_agents(monkeypatch, agents: list[object]) -> None:
    monkeypatch.setattr(
        "app.services.specialist_agents.agent_execution.select_agents",
        lambda agent_names=None, **_kwargs: list(agents),
    )


def test_peer_independent_agents_run_concurrently(client: TestClient, monkeypatch) -> None:
    """Concurrency is asserted from the agents' own measured execution windows.

    Deliberately NOT asserted from the request's total wall-clock: that includes
    fixed per-request overhead (snapshot load, metric plan, client resolution),
    which on a loaded machine can exceed the sequential floor on its own and make
    a genuinely parallel run look sequential. Comparing the phase SPAN against
    the SUM of agent durations isolates the property actually under test.
    """
    peers = [_SleepingAgent(f"agent_{i}") for i in range(3)]
    _install_agents(monkeypatch, peers)

    system = create_system(client, name="Parallel Fanout System")
    run = create_run(client, system["id"], [])

    response = client.post(f"/api/v1/evaluation-runs/{run['id']}/agents/run", json={})

    assert response.status_code == 201
    result = response.json()
    assert result["findings_created"] == 3

    windows = [
        (
            datetime.fromisoformat(e["started_at"]),
            datetime.fromisoformat(e["completed_at"]),
        )
        for e in result["executions"]
    ]
    span = (max(end for _, end in windows) - min(start for start, _ in windows)).total_seconds()
    total = sum((end - start).total_seconds() for start, end in windows)

    # Sequential execution puts span == total. Real overlap makes span strictly
    # smaller; with 3 equal agents on >=2 workers it cannot exceed ~2/3 of total.
    assert span < total * 0.8, (
        f"agent windows span {span:.2f}s but their durations sum to {total:.2f}s — "
        f"a ratio of {span / total:.2f} means the agents ran one after another, "
        f"not concurrently"
    )

    # Each agent ran on its own worker thread, and at least two windows overlap.
    assert len({a.thread_name for a in peers}) == len(peers)
    ordered = sorted(windows)
    assert any(
        later_start < earlier_end
        for (_, earlier_end), (later_start, _) in zip(ordered, ordered[1:], strict=False)
    ), f"no two agent execution windows overlap: {ordered}"


def test_aggregating_agent_runs_after_barrier_and_sees_every_peer_finding(
    client: TestClient, monkeypatch
) -> None:
    """The regression the sequential loop could never fully fix.

    In the old registry order RiskScorer ran 6th and ExplainabilityAgent 7th, so
    the composite risk score silently excluded explainability's findings. Running
    the aggregator after a barrier means "all findings accumulated so far in the
    run" is now literally true, for every peer.
    """
    peers = [_SleepingAgent(f"agent_{i}") for i in range(3)]
    aggregator = _AggregatingAgent()
    # Deliberately register the aggregator FIRST: correctness must come from the
    # two-stage schedule, not from where the agent happens to sit in the list.
    _install_agents(monkeypatch, [aggregator, *peers])

    system = create_system(client, name="Barrier Ordering System")
    run = create_run(client, system["id"], [])

    response = client.post(f"/api/v1/evaluation-runs/{run['id']}/agents/run", json={})
    assert response.status_code == 201

    assert aggregator.peer_findings_seen == len(peers)

    executions = {e["agent_name"]: e for e in response.json()["executions"]}
    assert executions["risk_scorer"]["metadata_json"]["execution_stage"] == "aggregate"
    for peer in peers:
        assert executions[peer.name]["metadata_json"]["execution_stage"] == "parallel"

    # The aggregator's window starts only once every peer has finished.
    assert executions["risk_scorer"]["started_at"] >= max(
        executions[peer.name]["completed_at"] for peer in peers
    )


def test_run_records_the_execution_model_it_used(client: TestClient, monkeypatch) -> None:
    """The schedule is auditable evidence, not a claim in a README."""
    peers = [_SleepingAgent(f"agent_{i}") for i in range(2)]
    _install_agents(monkeypatch, [*peers, _AggregatingAgent()])

    system = create_system(client, name="Execution Model Evidence System")
    run = create_run(client, system["id"], [])

    assert client.post(
        f"/api/v1/evaluation-runs/{run['id']}/agents/run", json={}
    ).status_code == 201

    model = client.get(f"/api/v1/evaluation-runs/{run['id']}").json()["result_summary"][
        "agent_execution_model"
    ]
    assert model["parallel_stage"] == ["agent_0", "agent_1"]
    assert model["aggregate_stage"] == ["risk_scorer"]
    assert model["max_parallel_workers"] >= 1
