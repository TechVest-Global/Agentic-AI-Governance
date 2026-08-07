"""The graph structure itself is a governance claim, so it gets tested.

Layers 3 and 4 are expressed as LangGraph StateGraphs. Several of the pipeline's
guarantees are now *structural* — they hold because of how the graph is wired,
not because a function remembers to do something. A wiring change that quietly
drops one of them would still pass every behavioural test that runs against the
mock governance client, because the mock always answers "sufficient" on the
first pass and never exercises the cycle.

These tests assert on the compiled topology directly, so the guarantee is
checked rather than assumed.
"""

from __future__ import annotations

from app.services.graphs import (
    build_checkpointer,
    build_council_graph,
    build_specialist_graph,
    run_graph,
)
from app.services.graphs.council_graph import (
    CRITIQUE_NODE,
    JUDGE_NODE,
    PERSIST_NODE,
    REMEDIATE_NODE,
    SYNTHESIS_NODE,
)
from app.services.graphs.pipeline_graph import (
    AGENTS_NODE,
    CONTEXT_ASSEMBLY_NODE,
    COUNCIL_NODE,
    FINALIZE_NODE,
    METRICS_NODE,
    PLANNING_NODE,
    REPORT_NODE,
    build_pipeline_graph,
)
from app.services.graphs.runtime import RuntimeContext, invoke_config
from app.services.graphs.specialist_graph import (
    DISPATCH_NODE,
    FINALIZE_FANOUT_NODE,
)
from langgraph.graph import END

EVALUATORS = [
    "bias_agent",
    "drift_agent",
    "misuse_agent",
    "compliance_mapper",
    "explainability_agent",
    "quality_agent",
]


def _edges(graph) -> set[tuple[str, str]]:
    return {(e.source, e.target) for e in graph.get_graph().edges}


# ---------------------------------------------------------------------------
# Layer 3 — specialist fan-out
# ---------------------------------------------------------------------------


def test_every_evaluator_is_its_own_node_fanned_out_in_one_superstep():
    """Six evaluators, six nodes, all hanging off the same predecessor.

    Sharing one predecessor is what puts them in a single LangGraph superstep
    and therefore what makes them run concurrently. If a future change chained
    them (dispatch -> bias -> drift -> ...) every test would still pass while
    the phase silently went back to costing sum(agent durations) instead of
    max(agent duration) — the 133s-vs-55s regression that motivated Layer 3
    running in parallel at all.
    """
    graph = build_specialist_graph(
        fanout_agents=EVALUATORS, aggregate_agents=["risk_scorer"]
    )
    edges = _edges(graph)
    nodes = set(graph.get_graph().nodes)

    for evaluator in EVALUATORS:
        assert evaluator in nodes, f"{evaluator} is not its own node"
        assert (DISPATCH_NODE, evaluator) in edges
        assert (evaluator, FINALIZE_FANOUT_NODE) in edges

    # No evaluator may depend on another, or they serialise.
    for evaluator in EVALUATORS:
        upstream = {source for source, target in edges if target == evaluator}
        assert upstream == {DISPATCH_NODE}, (
            f"{evaluator} has a dependency other than dispatch ({upstream}); "
            "it can no longer run in parallel with its peers"
        )


def test_the_aggregating_agent_runs_after_the_barrier_not_in_the_fan_out():
    """RiskScorer reads its peers' findings, so it must never join the fan-out.

    Enforced structurally: its only inbound edge is from the barrier node, so
    it cannot be scheduled in the same superstep as the evaluators whose
    findings it aggregates.
    """
    graph = build_specialist_graph(
        fanout_agents=EVALUATORS, aggregate_agents=["risk_scorer"]
    )
    edges = _edges(graph)

    assert (DISPATCH_NODE, "risk_scorer") not in edges
    upstream = {source for source, target in edges if target == "risk_scorer"}
    assert upstream == {FINALIZE_FANOUT_NODE}


def test_a_remediation_call_routes_past_the_coverage_claim():
    """A council re_probe targets ONE agent, so 'endpoints it didn't reach' is
    that call's scope, not a coverage gap. Recording one would put a false
    finding in the evidence package.
    """
    graph = build_specialist_graph(fanout_agents=["bias_agent"], aggregate_agents=[])
    recorded: list[str] = []
    ctx = _stub_specialist_context(recorded)

    for is_remediation, expected in [(True, False), (False, True)]:
        recorded.clear()
        graph.invoke(
            _specialist_state(["bias_agent"], is_remediation_call=is_remediation),
            _specialist_config(ctx),
        )
        assert ("coverage" in recorded) is expected


# ---------------------------------------------------------------------------
# Layer 4 — council remediation loop
# ---------------------------------------------------------------------------


def test_the_council_loops_back_to_synthesis_never_straight_to_judge():
    """Re-entry must flow the COMPLETE Synthesis -> Critique -> Judge chain.

    A remediate edge pointing at judge would re-adjudicate stale objections
    against a memo built from evidence that the remediation just changed.
    """
    edges = _edges(build_council_graph())

    assert (REMEDIATE_NODE, SYNTHESIS_NODE) in edges
    assert (REMEDIATE_NODE, JUDGE_NODE) not in edges
    assert (REMEDIATE_NODE, CRITIQUE_NODE) not in edges


def test_forced_dissent_is_structural_not_conventional():
    """The Devil's Advocate fires on EVERY pass, including later iterations.

    Guaranteed by the wiring: critique is the only path from synthesis to
    judge, so no iteration can route around it.
    """
    edges = _edges(build_council_graph())

    assert (SYNTHESIS_NODE, CRITIQUE_NODE) in edges
    assert (CRITIQUE_NODE, JUDGE_NODE) in edges
    assert (SYNTHESIS_NODE, JUDGE_NODE) not in edges, (
        "synthesis reaches judge without passing the Devil's Advocate — "
        "forced dissent can be skipped"
    )


def test_the_router_is_the_only_thing_that_can_end_the_council():
    """Both terminal exits and the loop-back all leave from the router node."""
    edges = _edges(build_council_graph())

    assert (PERSIST_NODE, END) in edges
    assert (PERSIST_NODE, REMEDIATE_NODE) in edges
    terminal_sources = {source for source, target in edges if target == END}
    assert terminal_sources == {PERSIST_NODE}


def test_the_cycle_runs_until_the_router_says_stop():
    """Drive the real graph through two remediations and out.

    Exercises the cycle end-to-end, which the mock governance client never does
    (it answers 'sufficient' on the first pass).
    """
    graph = build_council_graph(checkpointer=build_checkpointer())
    calls: list[str] = []
    # insufficient, insufficient, then sufficient
    exits = iter(["remediate", "remediate", "action"])

    ctx = RuntimeContext(
        synthesize=lambda i: calls.append(f"synthesis:{i}") or {"risk_summary": "s"},
        critique=lambda i: calls.append(f"critique:{i}") or [],
        judge=lambda i: calls.append(f"judge:{i}") or {"label": "review"},
        persist_iteration=lambda i: calls.append(f"persist:{i}"),
        route=lambda i: {
            "iteration": i,
            "exit": next(exits),
            "remediation_type": "re_deliberate",
            "target_agent": None,
            "reason": "test",
        },
        remediate=lambda d: calls.append("remediate") or {"iteration": d["iteration"]},
    )
    final = graph.invoke(
        {"run_id": "r", "iteration": 0, "max_iterations": 3, "remediations": []},
        invoke_config(
            run_id="00000000-0000-0000-0000-000000000000",
            context=ctx,
            thread_suffix="council",
            recursion_limit=40,
        ),
    )

    assert final["iteration"] == 3
    assert final["exit"] == "action"
    # Every pass ran the full three-agent chain — forced dissent on each.
    assert [c for c in calls if c.startswith("critique")] == [
        "critique:1",
        "critique:2",
        "critique:3",
    ]
    # Two remediations, not three: the last pass exited instead of looping.
    assert calls.count("remediate") == 2


def test_the_iteration_counter_is_seeded_from_the_persisted_value():
    """A crash-resume must not hand the council a fresh set of iterations.

    Seeded at 2, the first pass is iteration 3 — the cap — not iteration 1.
    """
    graph = build_council_graph()
    seen: list[int] = []
    ctx = RuntimeContext(
        synthesize=lambda i: seen.append(i) or {},
        critique=lambda i: [],
        judge=lambda i: {},
        persist_iteration=lambda i: None,
        route=lambda i: {"iteration": i, "exit": "exhausted", "remediation_type": None},
        remediate=lambda d: None,
    )
    final = graph.invoke(
        {"run_id": "r", "iteration": 2, "max_iterations": 3},
        invoke_config(
            run_id="00000000-0000-0000-0000-000000000000",
            context=ctx,
            thread_suffix="council",
            recursion_limit=40,
        ),
    )

    assert seen == [3]
    assert final["iteration"] == 3


# ---------------------------------------------------------------------------
# End-to-end pipeline
# ---------------------------------------------------------------------------


def test_the_five_layers_run_in_the_spec_mandated_order():
    """Layer order is not a style choice — the state chain and the phase
    transitions the frontend renders both depend on it.
    """
    edges = _edges(build_pipeline_graph())

    assert (CONTEXT_ASSEMBLY_NODE, PLANNING_NODE) in edges
    assert (PLANNING_NODE, METRICS_NODE) in edges
    assert (METRICS_NODE, AGENTS_NODE) in edges
    assert (AGENTS_NODE, COUNCIL_NODE) in edges
    assert (COUNCIL_NODE, REPORT_NODE) in edges
    assert (REPORT_NODE, FINALIZE_NODE) in edges


def test_a_run_awaiting_plan_approval_stops_before_any_execution():
    """The gate exists so nothing is evaluated against a plan nobody signed off.

    A gate placed after metrics would have already spent real calls against the
    audited system by the time a reviewer saw the plan.
    """
    graph = build_pipeline_graph()
    ran: list[str] = []
    ctx = _stub_pipeline_context(ran, awaiting_approval=True)

    final = graph.invoke(_pipeline_state(resume=False), _pipeline_config(ctx))

    assert final["awaiting_approval"] is True
    assert ran == ["assemble_context", "prepare_plan"]
    assert "run_metrics" not in ran
    assert "finalize" not in ran


def test_an_approved_run_flows_straight_through_to_finalize():
    graph = build_pipeline_graph()
    ran: list[str] = []
    ctx = _stub_pipeline_context(ran, awaiting_approval=False)

    final = graph.invoke(_pipeline_state(resume=False), _pipeline_config(ctx))

    assert ran == [
        "assemble_context",
        "prepare_plan",
        "run_metrics",
        "run_agents",
        "deliberate",
        "build_report",
        "finalize",
    ]
    assert final["status"] == "completed"


def test_a_resumed_run_re_enters_at_metrics_and_never_replans():
    """Layers 1-2 already ran and committed on the original attempt.

    Repeating them would append a second context assembly and a second plan to
    the state chain for a run that only ever had one of each.
    """
    graph = build_pipeline_graph()
    ran: list[str] = []
    ctx = _stub_pipeline_context(ran, awaiting_approval=False)

    graph.invoke(_pipeline_state(resume=True), _pipeline_config(ctx))

    assert "assemble_context" not in ran
    assert "prepare_plan" not in ran
    assert ran[0] == "run_metrics"


def test_a_lost_verdict_still_reaches_finalize_with_its_reason_attached():
    """The council is the pipeline's most failure-prone step, and every earlier
    phase has already committed real evidence. A judge outage must degrade the
    run, not discard the report.
    """
    graph = build_pipeline_graph()
    ran: list[str] = []
    ctx = _stub_pipeline_context(
        ran,
        awaiting_approval=False,
        council_degraded={"council_failure": {"message": "judge unreachable"}},
    )

    final = graph.invoke(_pipeline_state(resume=False), _pipeline_config(ctx))

    assert "build_report" in ran
    assert final["status"] == "degraded"
    assert "council_failure" in final["degraded"]


def test_several_failures_are_all_reported_not_just_the_first():
    """Silently dropping one would understate how incomplete the audit is."""
    graph = build_pipeline_graph()
    ran: list[str] = []
    ctx = _stub_pipeline_context(
        ran,
        awaiting_approval=False,
        council_degraded={"council_failure": {"message": "judge unreachable"}},
        report_degraded={"report_failure": {"message": "renderer blew up"}},
    )

    final = graph.invoke(_pipeline_state(resume=False), _pipeline_config(ctx))

    assert set(final["degraded"]) == {"council_failure", "report_failure"}


# ---------------------------------------------------------------------------
# Checkpointing + streaming
# ---------------------------------------------------------------------------


def test_streaming_reports_each_node_as_it_completes_and_returns_the_final_state():
    """run_graph must be equivalent to invoke(), only observable as it goes."""
    graph = build_council_graph(checkpointer=build_checkpointer())
    ctx = RuntimeContext(
        synthesize=lambda i: {"risk_summary": "s"},
        critique=lambda i: [{"objection_id": "o1", "argument": "a"}],
        judge=lambda i: {"label": "approved"},
        persist_iteration=lambda i: None,
        route=lambda i: {"iteration": i, "exit": "action", "remediation_type": None},
        remediate=lambda d: None,
    )
    seen: list[str] = []
    final = run_graph(
        graph,
        {"run_id": "r", "iteration": 0, "max_iterations": 3},
        invoke_config(
            run_id="00000000-0000-0000-0000-000000000000",
            context=ctx,
            thread_suffix="council",
            recursion_limit=40,
        ),
        on_update=lambda node, update: seen.append(node),
    )

    assert seen == [SYNTHESIS_NODE, CRITIQUE_NODE, JUDGE_NODE, PERSIST_NODE]
    assert final["exit"] == "action"
    assert final["verdict_summary"] == {"label": "approved"}


def test_a_failing_progress_listener_never_sinks_the_phase():
    """Observability is not worth abandoning a phase that already made real
    calls against an audited system.
    """
    graph = build_council_graph(checkpointer=build_checkpointer())
    ctx = RuntimeContext(
        synthesize=lambda i: {},
        critique=lambda i: [],
        judge=lambda i: {},
        persist_iteration=lambda i: None,
        route=lambda i: {"iteration": i, "exit": "action", "remediation_type": None},
        remediate=lambda d: None,
    )

    def _explode(node: str, update: dict) -> None:
        raise RuntimeError("listener is broken")

    final = run_graph(
        graph,
        {"run_id": "r", "iteration": 0, "max_iterations": 3},
        invoke_config(
            run_id="00000000-0000-0000-0000-000000000000",
            context=ctx,
            thread_suffix="council",
            recursion_limit=40,
        ),
        on_update=_explode,
    )

    assert final["exit"] == "action"


def test_the_checkpointer_records_every_superstep():
    """Checkpoints are the in-run observability record; assert they exist."""
    checkpointer = build_checkpointer()
    graph = build_council_graph(checkpointer=checkpointer)
    ctx = RuntimeContext(
        synthesize=lambda i: {"risk_summary": "s"},
        critique=lambda i: [],
        judge=lambda i: {"label": "approved"},
        persist_iteration=lambda i: None,
        route=lambda i: {"iteration": i, "exit": "action", "remediation_type": None},
        remediate=lambda d: None,
    )
    config = invoke_config(
        run_id="00000000-0000-0000-0000-000000000000",
        context=ctx,
        thread_suffix="council",
        recursion_limit=40,
    )
    graph.invoke({"run_id": "r", "iteration": 0, "max_iterations": 3}, config)

    history = list(graph.get_state_history(config))
    assert len(history) > 1
    assert history[0].values["exit"] == "action"


def test_the_two_layers_checkpoint_into_separate_threads():
    """One run has both a Layer 3 and a Layer 4 graph; their checkpoint threads
    must not collide, or one layer's state overwrites the other's.
    """
    ctx = RuntimeContext()
    run_id = "11111111-1111-1111-1111-111111111111"
    specialist = invoke_config(
        run_id=run_id, context=ctx, thread_suffix="specialist", recursion_limit=10
    )
    council = invoke_config(
        run_id=run_id, context=ctx, thread_suffix="council", recursion_limit=10
    )

    assert (
        specialist["configurable"]["thread_id"]
        != council["configurable"]["thread_id"]
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _specialist_state(agents: list[str], *, is_remediation_call: bool) -> dict:
    return {
        "run_id": "r",
        "phase_started_at": "2026-01-01T00:00:00+00:00",
        "phase_budget_seconds": 900.0,
        "fanout_agents": agents,
        "aggregate_agents": [],
        "agent_status": {},
        "finalized": [],
        "findings_created": 0,
        "failed_agents": 0,
        "coverage_recorded": False,
        "is_remediation_call": is_remediation_call,
    }


def _specialist_config(ctx: RuntimeContext) -> dict:
    return invoke_config(
        run_id="00000000-0000-0000-0000-000000000000",
        context=ctx,
        thread_suffix="specialist",
        recursion_limit=20,
        max_concurrency=6,
    )


def _pipeline_state(*, resume: bool) -> dict:
    return {
        "run_id": "r",
        "resume": resume,
        "awaiting_approval": False,
        "phases_completed": [],
        "degraded": {},
        "status": None,
    }


def _pipeline_config(ctx: RuntimeContext) -> dict:
    return invoke_config(
        run_id="00000000-0000-0000-0000-000000000000",
        context=ctx,
        thread_suffix="pipeline",
        recursion_limit=20,
    )


def _stub_pipeline_context(
    ran: list[str],
    *,
    awaiting_approval: bool,
    council_degraded: dict | None = None,
    report_degraded: dict | None = None,
) -> RuntimeContext:
    def _record(name: str, result=None):
        def _call(*args, **kwargs):
            ran.append(name)
            return result
        return _call

    return RuntimeContext(
        assemble_context=_record("assemble_context"),
        prepare_plan=_record("prepare_plan", awaiting_approval),
        run_metrics=_record("run_metrics"),
        run_agents=_record("run_agents"),
        deliberate=_record("deliberate", council_degraded or {}),
        build_report=_record("build_report", report_degraded or {}),
        finalize=lambda degraded: (
            ran.append("finalize") or ("degraded" if degraded else "completed")
        ),
    )


def _stub_specialist_context(recorded: list[str]) -> RuntimeContext:
    class _Outcome:
        error = None
        findings: list = []
        probe_count = 0
        probes_planned = 0
        probes_skipped: list = []
        probes_failed: list = []

    return RuntimeContext(
        dispatch=lambda: recorded.append("dispatch"),
        await_agent=lambda name, state: _Outcome(),
        shutdown_pool=lambda: None,
        finalize_fanout=lambda names: {
            "finalized": list(names),
            "findings_created": 0,
            "failed_agents": 0,
        },
        run_aggregate=lambda name, state: _Outcome(),
        finalize_one=lambda name, outcome: {
            "findings_created": 0,
            "failed_agents": 0,
        },
        record_coverage=lambda: recorded.append("coverage"),
        status_of=lambda name, outcome: {"agent_name": name, "status": "completed"},
    )
