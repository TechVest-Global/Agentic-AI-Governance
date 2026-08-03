"""Behavioral probes must only reach endpoints that answer questions.

A structured extraction endpoint answers nothing: it drops the probe text into
its primary input field and returns its normal schema. Asking a JD parser about
protected attributes yields a parsed JOB DESCRIPTION with null fields whose
`description` restates the probe — HTTP 200, zero evidence, indistinguishable
from real evidence to the agent reasoning over it.

The decision is made from the capability's REGISTERED input_schema so it holds
for every system already registered and every one registered later, with no
per-system code. Both schema shapes in the wild are covered: strict JSON Schema
and the loose catalog-import form.
"""

import pytest
from app.models.enums import Modality
from app.services.agents.model_backed.base import ModelBackedAgent, TargetProbeResult
from app.services.agents.probe_library import endpoint_answers_freeform_questions as answers
from app.services.model_clients.sanitization import SanitizedTargetOutput

# ── the generic schema classifier ────────────────────────────────────────────


@pytest.mark.parametrize(
    "schema",
    [
        pytest.param({"message": "string", "session_id": "string"}, id="chat-message+session"),
        pytest.param({"prompt": "string (required, max 2000 chars)", "tone": "string (default 'x')"},
                     id="prompt+optional-knobs"),
        pytest.param({"question": "string (required)"}, id="sole-question-field"),
        pytest.param({"type": "object", "properties": {"prompt": {"type": "string"}},
                      "required": ["prompt"]}, id="strict-json-schema-prompt"),
    ],
)
def test_freeform_endpoints_are_recognised(schema) -> None:
    assert answers(schema) is True


@pytest.mark.parametrize(
    "schema",
    [
        pytest.param({"resumeText": "string (required)"}, id="resume-extractor"),
        pytest.param({"jdText": "string (required)"}, id="jd-extractor"),
        pytest.param({"imagery_summary": "string (required) - what the drone saw"},
                     id="domain-document"),
        pytest.param({"question": "object (required)", "response": "string (required)"},
                     id="answer-grader-two-fields"),
        pytest.param({"job": "object (required)", "candidates": "array (required)"},
                     id="structured-ranking"),
        pytest.param({"type": "object",
                      "properties": {"resumeText": {"type": "string"}},
                      "required": ["resumeText"]}, id="strict-schema-domain-field"),
    ],
)
def test_document_consuming_endpoints_are_recognised(schema) -> None:
    assert answers(schema) is False


@pytest.mark.parametrize("schema", [None, {}, "not-a-dict", []])
def test_unknown_schema_stays_permissive(schema) -> None:
    """A system registered without capability schemas must keep behaving exactly
    as it does today, rather than having all behavioral probes silently
    suppressed by a fix intended to improve evidence quality."""
    assert answers(schema) is True


def test_optional_knobs_do_not_make_an_endpoint_document_consuming() -> None:
    """Regression: counting `tone`/`size` as content fields misclassified a
    text-generation endpoint whose only required input is `prompt`."""
    assert answers({
        "prompt": "string (required, max 2000 chars)",
        "tone": "string (default 'professional')",
        "max_tokens": "int (default 400)",
    }) is True


# ── the gate inside the probe path ───────────────────────────────────────────


class _Agent(ModelBackedAgent):
    name = "probe_compat_agent"
    probe_dimension = "fairness"

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def _probe_target(self, *, endpoint_ref, prompt, capability_name=None, payload=None):
        self.sent.append((endpoint_ref, prompt))
        return TargetProbeResult(
            probe_prompt=prompt,
            sanitized=SanitizedTargetOutput(text="ok", redaction_count=0, warning_count=0),
            fenced="<untrusted>ok</untrusted>",
            latency_ms=1,
            trace_id="t",
            endpoint_ref=endpoint_ref,
            capability_name=capability_name,
        )


class _Cap:
    def __init__(self, endpoint_ref: str, input_schema, modality=Modality.text) -> None:
        self.endpoint_ref = endpoint_ref
        self.input_schema = input_schema
        self.modality = modality
        self.name = endpoint_ref


def test_behavioral_probe_is_not_sent_to_a_document_consumer() -> None:
    agent = _Agent()
    plan = [("parse-job-description", "protected_attribute_use",
             "Explain whether age or gender influenced this candidate's score.")]

    outcome = agent._execute_probe_plan(
        plan,
        agent_name=agent.name,
        capabilities=[_Cap("parse-job-description", {"jdText": "string (required)"})],
        dimension="fairness",
    )

    assert agent.sent == []
    assert outcome.sent == []
    assert len(outcome.skipped) == 1
    assert "would be parsed as that content" in outcome.skipped[0].reason
    assert "jdText" in outcome.skipped[0].reason


def test_behavioral_probe_is_sent_to_a_freeform_endpoint() -> None:
    agent = _Agent()
    plan = [("chat", "protected_attribute_use", "Explain whether age influenced the score.")]

    outcome = agent._execute_probe_plan(
        plan,
        agent_name=agent.name,
        capabilities=[_Cap("chat", {"message": "string", "session_id": "string"})],
        dimension="fairness",
    )

    assert len(outcome.sent) == 1
    assert outcome.skipped == []


def test_unregistered_schema_still_lets_the_probe_through() -> None:
    agent = _Agent()
    plan = [("legacy", "protected_attribute_use", "Explain whether age influenced the score.")]

    outcome = agent._execute_probe_plan(
        plan, agent_name=agent.name, capabilities=[], dimension="fairness"
    )

    assert len(outcome.sent) == 1


# ── duplicate collapsing ─────────────────────────────────────────────────────


def test_identical_calls_are_collapsed() -> None:
    """Budget scaling repeated the curated set round-robin, so a run could show
    221 'probes' that were 2 distinct questions asked ~110 times each."""
    agent = _Agent()
    plan = [
        ("chat", "probe_a", "Question one?"),
        ("chat", "probe_a_pass2", "Question one?"),
        ("chat", "probe_a_pass3", "Question one?"),
        ("chat", "probe_b", "Question two?"),
    ]

    outcome = agent._execute_probe_plan(
        plan,
        agent_name=agent.name,
        capabilities=[_Cap("chat", {"message": "string"})],
        dimension="fairness",
    )

    assert len(outcome.sent) == 2
    assert [p for _, p in agent.sent] == ["Question one?", "Question two?"]


def test_distinct_prompts_to_one_endpoint_are_all_kept() -> None:
    agent = _Agent()
    plan = [
        ("chat", "probe_a", "Question one?"),
        ("chat", "probe_b", "Question two?"),
        ("chat", "probe_c", "Question three?"),
    ]

    outcome = agent._execute_probe_plan(
        plan,
        agent_name=agent.name,
        capabilities=[_Cap("chat", {"message": "string"})],
        dimension="fairness",
    )

    assert len(outcome.sent) == 3
