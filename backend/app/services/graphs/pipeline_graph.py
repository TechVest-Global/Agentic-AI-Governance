"""The whole five-layer governance pipeline, as a LangGraph StateGraph.

    START ─(conditional: fresh run or resume?)─┐
       │                                       │
       ▼                                       │
    context_assembly ─→ planning ─┐            │
                                  │            │
                        (conditional gate)     │
                                  │            │
                 END ◄── awaiting approval     │
                                  │            │
                                  ▼            ▼
                                  metrics ◄────┘
                                     │
                                     ▼
                                  agents ─→ council ─→ report ─→ finalize ─→ END

Two conditional edges, both of which were previously control flow buried in
``orchestration.py``:

  * **The entry router.** A fresh run starts at context assembly; a run resuming
    after plan approval re-enters at metrics, skipping Layers 1-2 because they
    already ran and committed. This was two separate public functions
    (``run_governance_pipeline`` / ``resume_governance_pipeline``) calling a
    shared tail; it is now one graph with two entry points, which is what it
    always was.

  * **The approval gate.** When plan approval is required and not yet granted,
    the graph ends after planning with the run parked at ``RunStatus.planned``.
    This is a genuine human-in-the-loop interrupt: the run resumes later, in a
    different process, driven by a reviewer's decision.

**Degradation is preserved, not smoothed over.** The council and report nodes
each catch their own failures and record them in ``degraded`` rather than
raising, because every earlier phase has already committed real evidence and a
lost verdict must never discard it. ``finalize`` is what turns an accumulated
``degraded`` map into ``RunStatus.degraded`` — so a failure in the middle of the
graph still reaches a terminal status with its reason attached, exactly as the
straight-line version did.
"""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.services.graphs.runtime import context_from
from app.services.graphs.state import PipelineState

CONTEXT_ASSEMBLY_NODE = "context_assembly"
PLANNING_NODE = "planning"
METRICS_NODE = "metrics"
AGENTS_NODE = "agents"
COUNCIL_NODE = "council"
REPORT_NODE = "report"
FINALIZE_NODE = "finalize"


def _context_assembly_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Layer 1. Always runs on a fresh run, so the state chain records it and
    the run progresses through the phases in the spec-mandated order.
    """
    context_from(config).assemble_context()
    return {"phases_completed": [CONTEXT_ASSEMBLY_NODE]}


def _planning_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Layer 2. Builds and persists the evaluation plan BEFORE any execution, so
    the state chain records the plan and the run passes through `planned`.

    Returns whether the plan needs human sign-off; the gate below routes on it.
    """
    awaiting = context_from(config).prepare_plan()
    return {"phases_completed": [PLANNING_NODE], "awaiting_approval": bool(awaiting)}


def _metrics_node(state: PipelineState, config: RunnableConfig) -> dict:
    context_from(config).run_metrics()
    return {"phases_completed": [METRICS_NODE]}


def _agents_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Layer 3. Internally its own StateGraph — see specialist_graph.py."""
    context_from(config).run_agents()
    return {"phases_completed": [AGENTS_NODE]}


def _council_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Layer 4. Internally a cyclic StateGraph — see council_graph.py.

    The pipeline's most failure-prone step: the only phase depending on a live
    judge model for every pass, so a judge outage used to fail the WHOLE run and
    discard a report whose metric results and findings were already committed.
    Failures degrade here instead, matching how metrics and agents behave.
    """
    degraded = context_from(config).deliberate()
    return {"phases_completed": [COUNCIL_NODE], "degraded": degraded or {}}


def _report_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Layer 5. A missing verdict does not prevent a report — that is the whole
    point of degrading rather than failing: the audit record survives.
    """
    degraded = context_from(config).build_report()
    return {"phases_completed": [REPORT_NODE], "degraded": degraded or {}}


def _finalize_node(state: PipelineState, config: RunnableConfig) -> dict:
    """Drive the run to a terminal status.

    Without this the run would be left parked at council_running /
    deliberation_council and never terminal, which made the SSE progress stream
    never close and the frontend completion poll hang forever.

    Reads the accumulated ``degraded`` map rather than being told by the failing
    node, so a run that lost several things reports all of them.
    """
    status = context_from(config).finalize(state.get("degraded") or {})
    return {"phases_completed": [FINALIZE_NODE], "status": status}


def _entry_router(state: PipelineState) -> str:
    """Fresh run starts at Layer 1; a resumed run re-enters at metrics.

    Layers 1-2 already ran and committed for a resumed run — repeating them
    would append a second context-assembly and a second plan to the state chain
    for a run that only ever had one of each.
    """
    return METRICS_NODE if state.get("resume") else CONTEXT_ASSEMBLY_NODE


def _approval_gate(state: PipelineState) -> str:
    """Human-in-the-loop interrupt: pause when a plan needs approval.

    The run is already parked at RunStatus.planned by the planning node; ending
    here leaves it there for the reviewer rather than executing against a plan
    nobody signed off.
    """
    return END if state.get("awaiting_approval") else METRICS_NODE


def build_pipeline_graph(*, checkpointer=None):
    """Compile the end-to-end pipeline graph."""
    graph = StateGraph(PipelineState)

    graph.add_node(CONTEXT_ASSEMBLY_NODE, _context_assembly_node)
    graph.add_node(PLANNING_NODE, _planning_node)
    graph.add_node(METRICS_NODE, _metrics_node)
    graph.add_node(AGENTS_NODE, _agents_node)
    graph.add_node(COUNCIL_NODE, _council_node)
    graph.add_node(REPORT_NODE, _report_node)
    graph.add_node(FINALIZE_NODE, _finalize_node)

    graph.add_conditional_edges(
        START, _entry_router, [CONTEXT_ASSEMBLY_NODE, METRICS_NODE]
    )
    graph.add_edge(CONTEXT_ASSEMBLY_NODE, PLANNING_NODE)
    graph.add_conditional_edges(PLANNING_NODE, _approval_gate, [METRICS_NODE, END])
    graph.add_edge(METRICS_NODE, AGENTS_NODE)
    graph.add_edge(AGENTS_NODE, COUNCIL_NODE)
    graph.add_edge(COUNCIL_NODE, REPORT_NODE)
    graph.add_edge(REPORT_NODE, FINALIZE_NODE)
    graph.add_edge(FINALIZE_NODE, END)

    return graph.compile(checkpointer=checkpointer)
