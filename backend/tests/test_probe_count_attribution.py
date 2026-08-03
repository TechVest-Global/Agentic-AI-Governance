"""Evidence-tool probes must count toward an agent's sample size.

garak/deepeval/presidio/ragas send real requests to the audited system through
the same Gateway as an agent's own probes, but they were not counted. An agent
whose evidence came entirely from a tool therefore recorded probe_count=0 —
misuse_agent made 6 live garak calls and reported 0.

That number is what the Council reads as `sample_sizes`, so the Devil's Advocate
objected that a high-severity finding rested on no probes at all, and the
verdict's confidence was docked for an evidence deficit that did not exist.
"""

from app.models.ai_system import AISystem
from app.services.agents.base import AgentContext
from app.services.agents.model_backed.base import ModelBackedAgent


def _context(**kw) -> AgentContext:
    return AgentContext(
        ai_system=AISystem(name="s", owner="o", system_type="llm_app"),
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[],
        existing_findings=[],
        **kw,
    )


class _Agent(ModelBackedAgent):
    name = "bias_agent"

    def __init__(self) -> None:  # no clients needed to count buffer entries
        pass


def test_target_calls_are_counted_and_governance_calls_are_not() -> None:
    buffer = [
        {"call_type": "target", "agent_name": "bias_agent"},
        {"call_type": "governance", "agent_name": "bias_agent"},
        {"call_type": "target", "agent_name": "bias_agent"},
        {"call_type": "governance", "agent_name": "bias_agent"},
    ]
    assert _Agent()._count_target_calls(buffer) == 2


def test_other_agents_probes_are_not_counted() -> None:
    """Specialist agents run CONCURRENTLY and share one per-run capture buffer,
    so an unfiltered before/after delta swept up whatever the other agents sent
    meanwhile — it inflated misuse_agent to 53 calls when it had made 27."""
    buffer = [
        {"call_type": "target", "agent_name": "bias_agent"},
        {"call_type": "target", "agent_name": "misuse_agent"},
        {"call_type": "target", "agent_name": "quality_agent"},
        {"call_type": "target", "agent_name": "bias_agent"},
        {"call_type": "target", "agent_name": None},
    ]
    assert _Agent()._count_target_calls(buffer) == 2


def test_empty_or_missing_buffer_counts_zero() -> None:
    assert _Agent()._count_target_calls(None) == 0
    assert _Agent()._count_target_calls([]) == 0


def test_tool_probes_are_kept_separate_from_own_probes() -> None:
    """probe_counts is ASSIGNED by _run_probes (it deliberately overwrites the
    planned figure with the actually-sent one), so tool probes accumulated into
    the same key would be silently erased depending on ordering."""
    context = _context()
    context.probe_counts["bias_agent"] = 9
    context.tool_probe_counts["bias_agent"] = 10

    # Simulating _run_probes overwriting its own count must not touch the tool tally.
    context.probe_counts["bias_agent"] = 9

    assert context.tool_probe_counts["bias_agent"] == 10
    total = context.probe_counts["bias_agent"] + context.tool_probe_counts["bias_agent"]
    assert total == 19


def test_agent_with_only_tool_evidence_no_longer_reports_zero() -> None:
    """The misuse_agent case: all behavioral probes skipped by the endpoint
    gate, evidence gathered entirely by garak."""
    context = _context()
    context.tool_probe_counts["misuse_agent"] = 6

    total = (
        context.probe_counts.get("misuse_agent", 0)
        + context.tool_probe_counts.get("misuse_agent", 0)
    )

    assert total == 6


def test_tool_probe_counts_defaults_to_empty_dict() -> None:
    """Agents constructed without the field must not blow up on .get()."""
    assert _context().tool_probe_counts == {}
