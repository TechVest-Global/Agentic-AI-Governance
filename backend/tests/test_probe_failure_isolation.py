"""One failing probe must not discard its successful siblings.

``_execute_probe_plan`` fans probes out with ``pool.map``, which re-raises the
first exception when its results are iterated. A single timed-out probe
therefore used to unwind the whole plan: every sibling probe that had already
come back was thrown away and the agent was recorded as failed with zero
findings, even though real evidence had been collected.

The fix is per-probe tolerance, with one deliberate exception — zero successful
probes still fails the agent, because an unreachable target must never be
presentable as a clean evaluation.
"""

import pytest
from app.models.ai_system import AISystem
from app.models.enums import Modality
from app.services.agents.base import AgentContext
from app.services.agents.model_backed.base import (
    AllProbesFailedError,
    FailedProbe,
    ModelBackedAgent,
    TargetProbeResult,
)
from app.services.model_clients.sanitization import SanitizedTargetOutput


class _Agent(ModelBackedAgent):
    """Probes every prompt handed to it; each call either works or raises."""

    name = "flaky_probe_agent"
    probe_dimension = "robustness"

    def __init__(self, failing_prompts: set[str]) -> None:
        self._failing = failing_prompts
        self.calls: list[str] = []

    def _probe_target(self, *, endpoint_ref, prompt, capability_name=None, payload=None):
        self.calls.append(prompt)
        if prompt in self._failing:
            raise TimeoutError(f"target did not respond to {prompt!r}")
        return TargetProbeResult(
            probe_prompt=prompt,
            sanitized=SanitizedTargetOutput(text="ok", redaction_count=0, warning_count=0),
            fenced="<untrusted>ok</untrusted>",
            latency_ms=5,
            trace_id="trace",
            endpoint_ref=endpoint_ref,
            capability_name=capability_name,
        )


def _plan(*prompts: str) -> list[tuple[str, str, str]]:
    return [("ep", f"probe-{i}", p) for i, p in enumerate(prompts)]


def test_surviving_probes_are_kept_when_one_fails() -> None:
    agent = _Agent(failing_prompts={"p2"})

    outcome = agent._execute_probe_plan(
        _plan("p1", "p2", "p3"),
        agent_name=agent.name,
        dimension="robustness",
    )

    assert [r.probe_prompt for r in outcome.sent] == ["p1", "p3"]
    assert len(outcome.failed) == 1
    assert outcome.failed[0].error_type == "TimeoutError"
    assert outcome.skipped == []


def test_failure_records_are_distinct_from_skips() -> None:
    """A skip means never sent; a failure means sent and got nothing back.
    Folding them together would let a dead endpoint read as a modality gap."""
    agent = _Agent(failing_prompts={"p1"})

    outcome = agent._execute_probe_plan(
        _plan("p1", "p2"), agent_name=agent.name, dimension="robustness"
    )

    assert all(isinstance(f, FailedProbe) for f in outcome.failed)
    assert outcome.skipped == []


def test_all_probes_failing_still_fails_the_agent() -> None:
    """The safety property that must NOT regress: zero successful probes cannot
    be presented as a clean evaluation."""
    agent = _Agent(failing_prompts={"p1", "p2"})

    with pytest.raises(AllProbesFailedError) as excinfo:
        agent._execute_probe_plan(
            _plan("p1", "p2"), agent_name=agent.name, dimension="robustness"
        )

    assert "all 2 probe(s) failed" in str(excinfo.value)
    assert agent.name in str(excinfo.value)


def test_single_probe_plan_failure_also_raises() -> None:
    """A one-probe plan skips the pool entirely and runs inline — that path must
    reach the same guard rather than returning an empty, healthy-looking outcome."""
    agent = _Agent(failing_prompts={"only"})

    with pytest.raises(AllProbesFailedError):
        agent._execute_probe_plan(
            _plan("only"), agent_name=agent.name, dimension="robustness"
        )


def test_fully_successful_plan_reports_no_failures() -> None:
    agent = _Agent(failing_prompts=set())

    outcome = agent._execute_probe_plan(
        _plan("p1", "p2"), agent_name=agent.name, dimension="robustness"
    )

    assert len(outcome.sent) == 2
    assert outcome.failed == []


def test_probe_failures_are_recorded_on_the_context() -> None:
    """Partial degradation has to be visible in the audit record, not only the
    logs — a reviewer must see the agent reasoned over fewer probes than planned."""
    agent = _Agent(failing_prompts={"p2"})
    context = AgentContext(
        ai_system=AISystem(name="sys", owner="o", system_type="llm_app"),
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[],
        existing_findings=[],
    )

    outcome = agent._execute_probe_plan(
        _plan("p1", "p2"), agent_name=agent.name, dimension="robustness"
    )
    # mirrors what _probe_all_endpoints writes through
    if outcome.failed:
        context.probe_failures[agent.name] = [
            {
                "endpoint_ref": f.endpoint_ref,
                "probe_name": f.probe_name,
                "dimension": f.dimension,
                "error_type": f.error_type,
                "message": f.message,
            }
            for f in outcome.failed
        ]

    recorded = context.probe_failures[agent.name]
    assert len(recorded) == 1
    assert recorded[0]["error_type"] == "TimeoutError"
    assert recorded[0]["dimension"] == "robustness"
    # and the skip channel stays clean
    assert context.probe_skips == {}


def test_modality_skip_still_works_alongside_failures() -> None:
    """The pre-existing fail-closed modality gate must be unaffected."""
    agent = _Agent(failing_prompts=set())

    class _Cap:
        endpoint_ref = "ep"
        modality = Modality.image
        input_schema = None

    outcome = agent._execute_probe_plan(
        _plan("p1"),
        agent_name=agent.name,
        capabilities=[_Cap()],
        dimension="robustness",
    )

    assert outcome.sent == []
    assert len(outcome.skipped) == 1
    assert "text-only" in outcome.skipped[0].reason
    assert outcome.failed == []
