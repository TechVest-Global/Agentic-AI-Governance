"""A governance answer the pipeline cannot read must never look like a clean one.

Before this, an agent that could not parse the governance model's response fell
back to deterministic metric checks, returned findings that looked like ordinary
output, and recorded the loss only as a WARNING in the process log. The run
completed, the council counted the fallback findings, and nothing downstream
could tell "the model found nothing" apart from "we could not read what the
model found".

These tests pin both halves of the fix: the parser now recovers far more
answers and explains the ones it cannot, and an unreadable answer becomes a
finding in the evidence package.
"""

from __future__ import annotations

import pytest
from app.services.agents.model_backed.base import (
    _FINDINGS_SCHEMA,
    parse_json_items,
)

_GOOD = {"title": "Disparate outcome", "summary": "Group A scored lower."}


# ---------------------------------------------------------------------------
# Parsing — what we can now recover
# ---------------------------------------------------------------------------


def test_a_bare_json_array_is_still_accepted():
    """The shape every prompt has always asked for must keep working."""
    items, problems = parse_json_items(f'[{_json(_GOOD)}]')

    assert items == [_GOOD]
    assert problems == []


def test_a_json_object_wrapper_is_accepted_too():
    """A provider in JSON-object mode cannot return a bare array.

    An agent's output must not depend on whether the configured judge happens
    to support structured output.
    """
    items, problems = parse_json_items(f'{{"findings": [{_json(_GOOD)}]}}')

    assert items == [_GOOD]
    assert problems == []


def test_json_wrapped_in_prose_and_code_fences_is_recovered():
    """Models narrate. That is not a reason to discard their analysis."""
    content = (
        "Here is my assessment.\n\n```json\n"
        f'{{"findings": [{_json(_GOOD)}]}}\n```\nLet me know if you need more.'
    )
    items, problems = parse_json_items(content)

    assert items == [_GOOD]
    assert problems == []


def test_one_malformed_finding_does_not_discard_the_good_ones():
    """Five good findings and one broken one is five findings, not zero."""
    content = f'[{_json(_GOOD)}, {{"title": "no summary here"}}]'
    items, problems = parse_json_items(content)

    assert items == [_GOOD]
    assert len(problems) == 1
    assert "'summary'" in problems[0]


def test_an_empty_array_is_a_real_answer_not_a_failure():
    """"I reviewed the evidence and found nothing" must round-trip as such."""
    items, problems = parse_json_items("[]")

    assert items == []
    assert problems == []


def test_prose_with_no_json_is_reported_as_unreadable():
    items, problems = parse_json_items("I was unable to complete this analysis.")

    assert items is None
    assert problems == ["the response contained no JSON object or array"]


def test_problems_name_the_actual_defect_so_a_retry_can_fix_it():
    """The old retry said only "that wasn't JSON" — useless when the response
    WAS valid JSON but every item was missing a summary. The model had no way
    to know what to change and would return the same shape again.
    """
    items, problems = parse_json_items('[{"title": "a"}, {"summary": "b"}]')

    assert items is None
    assert "item 0 is missing 'summary'" in problems
    assert "item 1 is missing 'title'" in problems


@pytest.mark.parametrize(
    "content",
    ['{"probes": [{"probe_name": "p1", "prompt": "hi"}]}',
     '[{"probe_name": "p1", "prompt": "hi"}]'],
)
def test_probe_designs_are_validated_against_their_own_keys(content):
    """Probe designs are not findings — they carry probe_name plus a prompt or
    a structured field set. Validating them against the findings schema would
    reject every one of them.
    """
    items, problems = parse_json_items(content, required_keys=("probe_name",))

    assert items == [{"probe_name": "p1", "prompt": "hi"}]
    assert problems == []


def test_the_findings_schema_only_demands_what_is_truly_required():
    """Rejecting an otherwise-good finding over a missing confidence score
    would throw away real analysis for a formatting detail.
    """
    required = _FINDINGS_SCHEMA["properties"]["findings"]["items"]["required"]

    assert set(required) == {"title", "summary"}


# ---------------------------------------------------------------------------
# The loss is recorded, not just logged
# ---------------------------------------------------------------------------


def test_an_unreadable_answer_becomes_a_finding_in_the_evidence_package():
    from app.services.agents.helpers import governance_unreadable_finding

    finding = governance_unreadable_finding(
        agent_name="bias_agent",
        dimension="bias",
        failures=[{"task": "bias_analysis", "problems": ["no JSON"], "trace_id": "t1"}],
    )

    assert finding.finding_type == "coverage_gap"
    assert finding.agent_name == "bias_agent"
    assert finding.dimension == "bias"
    # The whole point: a reader must not mistake this for a clean dimension.
    assert "not as clean" in finding.summary
    assert finding.payload["generated_by"] == "governance_parse_failure"
    assert finding.payload["failures"][0]["trace_id"] == "t1"


def test_the_context_carries_parse_failures_the_way_it_carries_probe_failures():
    """Same shape as probe_failures on purpose — it is the same class of loss
    one layer up, and agent_execution reads them the same way.
    """
    from app.services.agents.base import AgentContext

    context = AgentContext(
        ai_system=None,
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[],
        existing_findings=[],
    )

    assert context.governance_parse_failures == {}
    context.governance_parse_failures.setdefault("bias_agent", []).append({"task": "x"})
    assert context.governance_parse_failures["bias_agent"] == [{"task": "x"}]


# ---------------------------------------------------------------------------
# End-to-end: a real judge whose answer cannot be read
# ---------------------------------------------------------------------------


class _ProseGovernanceClient:
    """A REAL (non-mock) judge that answers in prose.

    Deliberately not named "Mock" — ``is_mock_governance_client`` matches on the
    type name, and the whole point here is to exercise the real-client branch
    where an unusable answer is a genuine loss worth retrying and recording.
    """

    provider = "stub_judge"
    credential_ref = None

    def __init__(self) -> None:
        self.calls: list[object] = []

    def complete(self, request):
        from app.services.model_clients.base import GovernanceModelResponse

        self.calls.append(request)
        return GovernanceModelResponse(
            provider=self.provider,
            deployment_name="stub",
            content="I am unable to express this as JSON.",
            trace_id=f"stub-{len(self.calls)}",
            latency_ms=0,
        )


def _agent_with(client):
    from app.services.agents.model_backed.base import ModelBackedAgent
    from app.services.model_clients.mock import MockTargetModelClient

    class _Agent(ModelBackedAgent):
        name = "bias_agent"
        probe_dimension = "bias"

    return _Agent(MockTargetModelClient(provider="mock"), client)


def _empty_context():
    from app.services.agents.base import AgentContext

    return AgentContext(
        ai_system=None,
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[],
        existing_findings=[],
    )


class _JsonModeGovernanceClient(_ProseGovernanceClient):
    """A judge that honours the response_schema, as Azure/LiteLLM now do.

    Returns the object shape JSON-object mode forces — which is precisely the
    shape a bare-array-only parser could not read.
    """

    def complete(self, request):
        from app.services.model_clients.base import GovernanceModelResponse

        self.calls.append(request)
        return GovernanceModelResponse(
            provider=self.provider,
            deployment_name="stub",
            content=(
                '{"findings": [{"title": "Disparate outcome", '
                '"summary": "Group A scored lower.", "severity": "high"}]}'
            ),
            trace_id=f"stub-{len(self.calls)}",
            latency_ms=0,
        )


def test_a_structured_judge_answer_is_read_first_time_with_no_retry():
    """The path the whole change exists to make ordinary."""
    client = _JsonModeGovernanceClient()
    agent = _agent_with(client)
    context = _empty_context()

    result = agent._ask_governance_with_json_retry(
        task="bias_analysis", prompt="Return JSON.", agent_context=context
    )

    assert result == [
        {
            "title": "Disparate outcome",
            "summary": "Group A scored lower.",
            "severity": "high",
        }
    ]
    assert len(client.calls) == 1, "a readable answer must not trigger a retry"
    assert context.governance_parse_failures == {}


def test_a_real_judge_gets_a_retry_that_quotes_the_defect():
    client = _ProseGovernanceClient()
    agent = _agent_with(client)

    result = agent._ask_governance_with_json_retry(
        task="bias_analysis", prompt="Return JSON.", agent_context=_empty_context()
    )

    assert result is None
    assert len(client.calls) == 2, "a real judge must get a second chance"
    assert "could not be used" in client.calls[1].prompt
    assert '"title", "summary"' in client.calls[1].prompt
    # And the request asks the provider for structured output rather than
    # relying on prompt wording alone.
    assert client.calls[0].response_schema is not None


def test_a_probe_design_retry_asks_for_probes_not_findings():
    """The retry suffix serves both callers, so it must echo the caller's own
    required keys. Telling a probe-design retry to return a title and a summary
    would guarantee the second attempt failed too.
    """
    client = _ProseGovernanceClient()
    agent = _agent_with(client)

    agent._ask_governance_with_json_retry(
        task="dynamic_probe_design",
        prompt="Return JSON.",
        required_keys=("probe_name",),
    )

    retry_prompt = client.calls[1].prompt
    assert '"probe_name"' in retry_prompt
    assert "summary" not in retry_prompt


def test_the_lost_analysis_is_recorded_against_the_agent():
    client = _ProseGovernanceClient()
    agent = _agent_with(client)
    context = _empty_context()

    agent._ask_governance_with_json_retry(
        task="bias_analysis", prompt="Return JSON.", agent_context=context
    )

    failures = context.governance_parse_failures["bias_agent"]
    assert len(failures) == 1
    assert failures[0]["task"] == "bias_analysis"
    assert failures[0]["trace_id"] == "stub-2"
    assert failures[0]["problems"]


def test_a_mock_judge_is_not_retried_and_is_not_recorded_as_a_failure():
    """A mock returns the same canned prose every time, so re-asking only burns
    a call — and its prose means "no judge configured", not "the judge gave an
    unreadable answer", so it must not raise a coverage-gap finding on every
    run of a system without a live judge.
    """
    from app.services.model_clients.mock import MockGovernanceModelClient

    client = MockGovernanceModelClient(provider="mock")
    calls: list[object] = []
    inner = client.complete

    def _counting(request):
        calls.append(request)
        return inner(request)

    client.complete = _counting  # type: ignore[method-assign]
    agent = _agent_with(client)
    context = _empty_context()

    result = agent._ask_governance_with_json_retry(
        task="bias_analysis", prompt="Return JSON.", agent_context=context
    )

    assert result is None
    assert len(calls) == 1, "a mock must not be re-asked"
    assert context.governance_parse_failures == {}


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj)
