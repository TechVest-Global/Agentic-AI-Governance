"""Graph state for the LangGraph-expressed pipeline layers.

Two rules govern what may live in these TypedDicts, and both exist because the
state is handed to a checkpointer:

  1. **Serializable only.** No SQLModel instances, no ``Session``, no
     ``Future``, no live agent objects. A ``Finding`` row is bound to the
     session that loaded it; checkpointing one would either pickle a dead
     connection or raise. Everything heavy travels on the runtime context
     instead (see ``runtime.py``), which LangGraph passes through
     ``config["configurable"]`` and never tries to persist.

  2. **Meaningful to a reader.** The checkpoint of a governance run is itself
     an observability artifact — the same per-agent status/probe/finding counts
     the SSE progress stream reports. Keeping the state to that shape means a
     checkpoint answers "where did this run get to" without a DB round-trip.

The reducers below are plain dict/list merges. LangGraph applies them when two
parallel nodes write the same key in one superstep, which is exactly what the
specialist fan-out does: six evaluator nodes each writing their own entry into
``agent_status``.
"""

from __future__ import annotations

from typing import Annotated, TypedDict


def merge_dicts(left: dict | None, right: dict | None) -> dict:
    """Shallow-merge two nodes' contributions to the same mapping key.

    Used as the reducer for the parallel fan-out: each evaluator node returns
    ``{"agent_status": {"<its own name>": {...}}}`` and LangGraph folds them
    together. Because every node writes under a distinct agent name, this never
    actually has to resolve a conflict — but a reducer is still required, or
    LangGraph rejects the concurrent writes with InvalidUpdateError.
    """
    return {**(left or {}), **(right or {})}


def append_unique(left: list | None, right: list | None) -> list:
    """Append right onto left, dropping values already present.

    De-duplicating matters on the council's cycle: a node re-entered on a later
    iteration would otherwise re-append the same marker every pass.
    """
    merged = list(left or [])
    for item in right or []:
        if item not in merged:
            merged.append(item)
    return merged


class SpecialistState(TypedDict, total=False):
    """Layer 3 — specialist agent fan-out.

    Mirrors what ``run_agents`` used to hold in local variables across its
    ThreadPoolExecutor block. The parallel evaluator nodes contribute to
    ``agent_status`` concurrently; everything else is written by the sequential
    nodes (finalize / aggregate / coverage).
    """

    run_id: str
    # ISO-8601. Start of the phase's shared wall-clock budget — every node
    # derives its own remaining allowance from this, which is what keeps the
    # aggregate stage bounded by the SAME budget as the fan-out.
    phase_started_at: str
    phase_budget_seconds: float
    # Agent names, in registry order. Split exactly as the legacy code split
    # them: peer-independent agents fan out, finding-aggregating agents (just
    # RiskScorer) run after the barrier.
    fanout_agents: list[str]
    aggregate_agents: list[str]
    # agent_name -> {status, findings, probes_sent, probes_planned, error, ...}
    agent_status: Annotated[dict[str, dict], merge_dicts]
    # Agents whose execution row + findings + ledger entry have been committed.
    # Written by the sequential finalize nodes only, in registry order.
    finalized: Annotated[list[str], append_unique]
    findings_created: int
    failed_agents: int
    coverage_recorded: bool
    is_remediation_call: bool


class PipelineState(TypedDict, total=False):
    """The end-to-end run: context assembly -> plan -> metrics -> agents ->
    council -> report -> finalize.

    Carries no phase RESULTS. ``AgentRunRead.executions`` and
    ``MetricExecutionRead.metric_results`` are lists of session-bound SQLModel
    rows, and ``GovernancePipelineRunRead`` is assembled from all of them at the
    end — so the results live on the runtime context and this state records only
    what the graph itself needs to route on, plus what a reader wants from a
    checkpoint.
    """

    run_id: str
    # True when re-entering after plan approval: Layers 1-2 already ran and
    # committed, so the entry router skips straight to metrics.
    resume: bool
    # Set by the planning node when a plan needs sign-off. The graph then ends
    # with the run parked at RunStatus.planned for a reviewer.
    awaiting_approval: bool
    phases_completed: Annotated[list[str], append_unique]
    # reason_key -> {message, ...}. Every partial failure lands here instead of
    # raising, so a run that lost (say) an agent AND the verdict reports both
    # rather than only whichever was checked first. `finalize` turns a non-empty
    # map into RunStatus.degraded.
    degraded: Annotated[dict[str, dict], merge_dicts]
    status: str | None


class CouncilState(TypedDict, total=False):
    """Layer 4 — deliberation council remediation loop.

    The cycle is Synthesis -> Critique -> Judge -> persist -> route, with
    ``route`` either ending the graph or passing through ``remediate`` and back
    to Synthesis. ``iteration`` is seeded from the DB-persisted counter so a
    crash-resume re-enters the graph at the right count rather than at zero.
    """

    run_id: str
    iteration: int
    max_iterations: int
    # Serializable summary of the current pass's artifacts. The full
    # SynthesisMemo / Objection / VerdictOutput objects live on the runtime
    # context; these are the parts worth checkpointing and streaming.
    memo_summary: dict | None
    objections: list[dict]
    verdict_summary: dict | None
    decision: dict | None
    # Router exit that ended the loop: "action" | "exhausted". None while looping.
    exit: str | None
    # One entry per remediation actually applied, so a checkpoint explains why
    # an iteration was spent.
    remediations: Annotated[list[dict], append_unique]
    governance_is_mock: bool
