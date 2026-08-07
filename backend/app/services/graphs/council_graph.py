"""Layer 4 — the Deliberation Council remediation loop, as a LangGraph StateGraph.

Topology — a genuine cycle, which is what this layer always was:

    START ─→ synthesis ─→ critique ─→ judge ─→ persist ─┐
                ▲                                       │
                │                                 (conditional)
                │                                       │
                └──── remediate ◄── "remediate" ────────┤
                                                        ├── "action"    ─→ END
                                                        └── "exhausted" ─→ END

``synthesis`` / ``critique`` / ``judge`` are the SynthesisAgent, DevilsAdvocate
and VerdictAgent respectively — one node each, unchanged, wrapped rather than
rewritten. The conditional edge is the existing deterministic three-exit router
(``remediation_router.route``); expressing it as ``add_conditional_edges``
changes nothing about which exit it picks, it just stops the routing being
buried in a ``while True`` with two ``break``s.

Invariants the previous loop guaranteed, preserved here:

  * **Forced dissent every pass.** ``critique`` sits on the only path from
    ``synthesis`` to ``judge``, so the Devil's Advocate cannot be skipped on a
    later iteration — the graph makes this structural rather than a convention.
  * **Full council re-run.** ``remediate`` returns to ``synthesis``, never
    directly to ``judge``, so re-entry always flows the complete chain.
  * **Counter persistence.** ``persist`` writes the iteration counter to the DB
    before the router runs, so a crash between passes cannot reset the cap. The
    graph is seeded from that stored counter, not from zero.
  * **Append-only.** ``persist`` also writes this iteration's GovernanceState
    entry and commits, so per-iteration progress is observable mid-loop.
"""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.services.graphs.runtime import context_from
from app.services.graphs.state import CouncilState

SYNTHESIS_NODE = "synthesis"
CRITIQUE_NODE = "critique"
JUDGE_NODE = "judge"
PERSIST_NODE = "persist"
REMEDIATE_NODE = "remediate"

# Router exits that end the graph. Kept as a set rather than inlined so the
# conditional's path map and this check cannot drift apart.
_TERMINAL_EXITS = frozenset({"action", "exhausted"})


def _synthesis_node(state: CouncilState, config: RunnableConfig) -> dict:
    """SynthesisAgent — narrative + claims over the current finding set.

    Increments the iteration here, at the top of the cycle, exactly where the
    previous ``while True`` did.
    """
    ctx = context_from(config)
    iteration = int(state.get("iteration") or 0) + 1
    memo_summary = ctx.synthesize(iteration)
    return {"iteration": iteration, "memo_summary": memo_summary}


def _critique_node(state: CouncilState, config: RunnableConfig) -> dict:
    """Devil's Advocate — forced dissent, on EVERY pass.

    Sees the same raw findings Synthesis was built from, not just the memo, so
    it can catch an omission rather than only critiquing prose.
    """
    ctx = context_from(config)
    return {"objections": ctx.critique(int(state["iteration"]))}


def _judge_node(state: CouncilState, config: RunnableConfig) -> dict:
    """VerdictAgent — adjudicates the memo against the objections."""
    ctx = context_from(config)
    return {"verdict_summary": ctx.judge(int(state["iteration"]))}


def _persist_node(state: CouncilState, config: RunnableConfig) -> dict:
    """Persist the counter and this iteration's append-only artifacts, then commit.

    Ordered before the router deliberately: a crash here must not reset the
    iteration count on resume. Committing (not just flushing) is what lets a
    concurrent request polling the run observe real per-iteration progress
    instead of the whole 1-3 iteration loop being invisible until it completes.
    """
    ctx = context_from(config)
    iteration = int(state["iteration"])
    ctx.persist_iteration(iteration)
    decision = ctx.route(iteration)
    return {"decision": decision, "exit": decision["exit"]}


def _remediate_node(state: CouncilState, config: RunnableConfig) -> dict:
    """Re-enter the pipeline at the cheapest fix point, then loop to synthesis.

    re_deliberate: no new evidence — same findings, fresh narrative next pass.
    re_probe:      re-run the named specialist for more samples.
    re_plan:       activate a previously-dormant specialist for a dimension an
                   upheld objection names but nothing has probed yet this run.
    """
    ctx = context_from(config)
    applied = ctx.remediate(state.get("decision") or {})
    return {"remediations": [applied]} if applied else {}


def _route_from_persist(state: CouncilState) -> str:
    """The deterministic three-exit router, as a conditional edge.

    Exit priority is decided by ``remediation_router.route`` and merely read
    here — this function must not add policy of its own.
    """
    exit_name = state.get("exit")
    if exit_name in _TERMINAL_EXITS:
        return END
    return REMEDIATE_NODE


def build_council_graph(*, checkpointer=None):
    """Compile the Layer 4 graph.

    Unlike the specialist graph, the topology is fixed — the council always runs
    the same three agents in the same order — so this could be compiled once.
    It is built per invocation anyway so each run gets its own checkpointer and
    two concurrent runs cannot share checkpoint state.
    """
    graph = StateGraph(CouncilState)

    graph.add_node(SYNTHESIS_NODE, _synthesis_node)
    graph.add_node(CRITIQUE_NODE, _critique_node)
    graph.add_node(JUDGE_NODE, _judge_node)
    graph.add_node(PERSIST_NODE, _persist_node)
    graph.add_node(REMEDIATE_NODE, _remediate_node)

    graph.add_edge(START, SYNTHESIS_NODE)
    graph.add_edge(SYNTHESIS_NODE, CRITIQUE_NODE)
    graph.add_edge(CRITIQUE_NODE, JUDGE_NODE)
    graph.add_edge(JUDGE_NODE, PERSIST_NODE)
    graph.add_conditional_edges(
        PERSIST_NODE, _route_from_persist, [REMEDIATE_NODE, END]
    )
    # The cycle. Back to synthesis, never straight to judge — re-entry always
    # flows the complete Synthesis -> Critique -> Judge chain.
    graph.add_edge(REMEDIATE_NODE, SYNTHESIS_NODE)

    return graph.compile(checkpointer=checkpointer)
