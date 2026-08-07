"""Layer 3 — the specialist agent fan-out, as a LangGraph StateGraph.

Topology (built per invocation, because which agents run varies by request,
by evaluation plan, and by what a resumed run already completed):

                          ┌─ bias_agent ──────┐
                          ├─ drift_agent ─────┤
    START ─→ dispatch ─→  ├─ misuse_agent ────┤ ─→ finalize_fanout ─┐
                          ├─ compliance_… ────┤                     │
                          ├─ explainability_… ┤        ┌────────────┘
                          └─ quality_agent ───┘        │
                                                       ▼  (conditional)
                                     risk_scorer ◄─────┴──→ coverage ──→ END
                                          │                    ▲
                                          └────────────────────┘

Each evaluator is an independent node writing its own slot in the shared
``agent_status`` state; LangGraph runs them in one parallel superstep and folds
their writes with the ``merge_dicts`` reducer.

**This module owns topology only.** Every node body delegates to a callable
supplied on the RuntimeContext, and those callables are the pre-existing
functions in ``agent_execution.py`` — ``_execute_agent``, ``_finalize``,
``_record_orphaned_agent_completion``, ``_finalize_endpoint_coverage``. Nothing
about how an agent evaluates, what it writes, or in what order it commits
changed; only the control flow expressing it did.

Three guarantees the previous ThreadPoolExecutor block made are preserved here
deliberately, because losing any of them is a governance regression:

  * **Bounded phase.** Nodes never block past the phase's wall-clock budget.
    Each derives its own remaining allowance from the shared ``phase_started_at``
    so the aggregate stage is bounded by the SAME budget as the fan-out — the
    bug where risk_scorer blocked for 7.8 hours against a 900s budget.
  * **Abandon, never join.** A straggler is left running with an orphan
    completion callback attached, never waited on. LangGraph has no per-node
    timeout, so the agents run on their own pool and the nodes wait on futures.
  * **Deterministic write order.** Parallel nodes only *compute*; they touch no
    session. All DB writes happen in the sequential ``finalize_fanout`` node, in
    registry order, so the audit record orders identically across runs.
"""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.services.graphs.runtime import context_from
from app.services.graphs.state import SpecialistState

# Sequential nodes. Named with a leading underscore-free prefix so they never
# collide with an agent name (agent names are the other node names in this graph).
DISPATCH_NODE = "dispatch"
FINALIZE_FANOUT_NODE = "finalize_fanout"
COVERAGE_NODE = "coverage"


def _dispatch_node(state: SpecialistState, config: RunnableConfig) -> dict:
    """Submit every fan-out agent to the shared bounded pool.

    Submission happens here, in one node, rather than inside each evaluator node
    so the pool's ``max_workers`` still caps how many agents probe the target at
    once. Six nodes running concurrently must NOT mean six concurrent probe
    fan-outs — that multiplies with each agent's own probe pool and is what
    forced the worker counts down in the first place.
    """
    context_from(config).dispatch()
    return {}


def _make_agent_node(agent_name: str):
    """One parallel evaluator node.

    Waits on its own agent's future against the shared phase deadline. On
    timeout it abandons the straggler (attaching the orphan-completion callback
    that keeps the agent's late probes and LLM calls in the audit trail) and
    reports the timeout outcome, rather than blocking the phase.
    """

    def node(state: SpecialistState, config: RunnableConfig) -> dict:
        ctx = context_from(config)
        outcome = ctx.await_agent(agent_name, state)
        return {"agent_status": {agent_name: ctx.status_of(agent_name, outcome)}}

    node.__name__ = f"{agent_name}_node"
    return node


def _finalize_fanout_node(state: SpecialistState, config: RunnableConfig) -> dict:
    """Barrier. Commits every fan-out agent's row, findings and ledger entry.

    Sequential and single-threaded on purpose: this is the only place the
    fan-out touches the shared session, and it walks the agents in registry
    order so a concurrent phase still yields a byte-identical audit ordering.
    """
    ctx = context_from(config)
    ctx.shutdown_pool()
    summary = ctx.finalize_fanout(state.get("fanout_agents") or [])
    return {
        "finalized": summary["finalized"],
        "findings_created": summary["findings_created"],
        "failed_agents": summary["failed_agents"],
    }


def _make_aggregate_node(agent_name: str):
    """A finding-aggregating agent (RiskScorer), after the barrier.

    Separate from the fan-out because its findings are computed FROM its peers'
    findings, so it must see a COMPLETE specialist finding set — the reason
    ``GovernanceAgent.aggregates_peer_findings`` exists. Runs on its own
    single-slot pool bounded by whatever remains of the phase budget.
    """

    def node(state: SpecialistState, config: RunnableConfig) -> dict:
        ctx = context_from(config)
        outcome = ctx.run_aggregate(agent_name, state)
        summary = ctx.finalize_one(agent_name, outcome)
        return {
            "agent_status": {agent_name: ctx.status_of(agent_name, outcome)},
            "finalized": [agent_name],
            "findings_created": summary["findings_created"],
            "failed_agents": summary["failed_agents"],
        }

    node.__name__ = f"{agent_name}_aggregate_node"
    return node


def _coverage_node(state: SpecialistState, config: RunnableConfig) -> dict:
    """Record any registered endpoint this run's probes never reached."""
    context_from(config).record_coverage()
    return {"coverage_recorded": True}


def _route_after_fanout(state: SpecialistState) -> str:
    """Aggregate stage if this run has one, else straight to the coverage check."""
    aggregate = state.get("aggregate_agents") or []
    if aggregate:
        return aggregate[0]
    return _route_to_coverage(state)


def _route_to_coverage(state: SpecialistState) -> str:
    """Skip the coverage claim for a council re_probe remediation.

    A remediation call deliberately targets ONE agent, so "endpoints it didn't
    reach" is that call's scope, not a coverage gap — recording it would put a
    false finding in the evidence package.
    """
    if state.get("is_remediation_call"):
        return END
    return COVERAGE_NODE


def build_specialist_graph(
    *,
    fanout_agents: list[str],
    aggregate_agents: list[str],
    checkpointer=None,
):
    """Compile the Layer 3 graph for one specific set of agents.

    Built per invocation rather than once at import: the agent set is decided by
    the request payload, the evaluation plan, and (on a resumed run) which
    agents already hold durable ``completed`` execution rows. Compilation is
    cheap; a stale topology that re-runs an agent against a live target is not.
    """
    graph = StateGraph(SpecialistState)

    graph.add_node(DISPATCH_NODE, _dispatch_node)
    graph.add_edge(START, DISPATCH_NODE)

    if fanout_agents:
        for name in fanout_agents:
            graph.add_node(name, _make_agent_node(name))
            # Every evaluator hangs off dispatch, so they all land in one
            # superstep and LangGraph runs them concurrently.
            graph.add_edge(DISPATCH_NODE, name)
        graph.add_node(FINALIZE_FANOUT_NODE, _finalize_fanout_node)
        for name in fanout_agents:
            graph.add_edge(name, FINALIZE_FANOUT_NODE)
        fanout_exit = FINALIZE_FANOUT_NODE
    else:
        # No fan-out (e.g. a run whose only remaining agent is the aggregate).
        fanout_exit = DISPATCH_NODE

    for name in aggregate_agents:
        graph.add_node(name, _make_aggregate_node(name))

    graph.add_node(COVERAGE_NODE, _coverage_node)

    # Conditional: aggregate stage, coverage, or straight to END.
    graph.add_conditional_edges(
        fanout_exit,
        _route_after_fanout,
        [*aggregate_agents, COVERAGE_NODE, END],
    )
    # Aggregate agents run in sequence; the last one falls through to the
    # coverage check on the same condition the fan-out used.
    for index, name in enumerate(aggregate_agents):
        if index + 1 < len(aggregate_agents):
            graph.add_edge(name, aggregate_agents[index + 1])
        else:
            graph.add_conditional_edges(name, _route_to_coverage, [COVERAGE_NODE, END])

    graph.add_edge(COVERAGE_NODE, END)
    return graph.compile(checkpointer=checkpointer)
