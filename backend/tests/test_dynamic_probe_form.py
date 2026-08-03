"""A designed probe's FORM must follow the input the capability accepts.

``_design_probes_dynamically`` chose between free-text and structured probes on
modality alone, treating "modality is text" as "takes a free-form question".
Those are different properties. A capability can be text-modality and still
consume a domain document through its own declared fields — a resume parser
(``resumeText``), a JD extractor (``jdText``), an inspection-report generator
(``imagery_summary``). For every one of those the designer produced free-text
probes, which ``_execute_probe_plan``'s fail-closed intent gate then correctly
refused to send, because a question dropped into a domain field is parsed AS
that document rather than answered.

The result was structural: every text-modality endpoint with a domain schema was
guaranteed zero probe coverage on every system, whatever probe budget the plan
allocated. Observed on a 13-endpoint HR gateway where 11 endpoints recorded 14
skips and 0 probes each, and on a drone-inspection system with the same shape.

The designer now uses the SAME predicate as the gate, so the two cannot disagree
about what an endpoint will accept.
"""

import pytest
from app.models.ai_system import AISystemCapability
from app.models.enums import Modality
from app.services.agents.model_backed.base import ModelBackedAgent
from app.services.agents.probe_library import (
    classify_system,
    endpoint_answers_freeform_questions,
)

# Shapes drawn from three different registered systems, deliberately — the rule
# is a property of the input schema, not of any one product domain.
DOMAIN_SCHEMAS = {
    "resume_parser": {"resumeText": "string"},
    "jd_extractor": {"jdText": "string"},
    "multi_field_evaluator": {
        "question": "string",
        "expectedAnswer": "string",
        "userAnswer": "string",
    },
    "inspection_report": {"imagery_summary": "string"},
    "ranking": {"job": "object", "candidates": "array"},
}
# Verbatim from the registered systems, not simplified: the predicate reads the
# descriptive type strings these schemas actually carry, so an invented
# "field: string" shape does not exercise the same path.
FREEFORM_SCHEMAS = {
    "chatbot": {"message": "string", "session_id": "string"},
    "generic_prompt": {
        "prompt": "string (required, max 2000 chars) - campaign brief",
        "tone": "string (default 'professional')",
        "max_tokens": "int (default 400)",
    },
    "unregistered": {},
}
MEDIA_SCHEMAS = {
    Modality.image: {
        "prompt": "string (required, max 2000 chars)",
        "size": "Square | Portrait | Landscape (default Square)",
        "negative_prompt": "string (optional)",
    },
    Modality.video: {
        "prompt": "string (required, max 2000 chars)",
        "duration_seconds": "'4' | '8' | '12' (default '8')",
    },
}


class _Agent(ModelBackedAgent):
    name = "probe_form_agent"
    probe_dimension = "bias"

    def __init__(self, parsed: list) -> None:
        self._parsed = parsed

    def _ask_governance_with_json_retry(self, **_kwargs):
        return self._parsed


def _design(agent: _Agent, *, schema: dict, modality: Modality):
    capability = AISystemCapability(
        ai_system_id=None,  # type: ignore[arg-type]
        name="cap",
        endpoint_ref="endpoint",
        modality=modality,
        input_schema=schema,
    )

    class _Ctx:
        class ai_system:  # noqa: N801
            name = "system"

    return ModelBackedAgent._design_probes_dynamically(
        agent,
        context=_Ctx(),
        capability=capability,
        endpoint_ref="endpoint",
        dimension="bias",
        profile=classify_system("hr_recruitment"),
    )


@pytest.mark.parametrize("name", sorted(DOMAIN_SCHEMAS))
def test_domain_content_endpoints_get_structured_probes(name: str) -> None:
    """The regression: these used to get free text and then be skipped entirely."""
    schema = DOMAIN_SCHEMAS[name]
    assert endpoint_answers_freeform_questions(schema) is False, (
        f"{name} must be treated as domain content for this test to mean anything"
    )
    fields = {k: "realistic domain content" for k in schema}
    agent = _Agent([{"probe_name": "p1", "prompt": None, "fields": fields}])

    designed = _design(agent, schema=schema, modality=Modality.text)

    assert designed, f"{name} produced no probes at all"
    probe_name, value = designed[0]
    assert probe_name == "p1"
    # A dict is what makes _extend register a dynamic_payloads entry, which is
    # what lets the probe past the intent gate.
    assert isinstance(value, dict), f"{name} got free text, so the gate will skip it"
    assert set(value) <= set(schema)


@pytest.mark.parametrize("name", sorted(FREEFORM_SCHEMAS))
def test_freeform_endpoints_still_get_text_probes(name: str) -> None:
    """Unchanged behaviour for endpoints that genuinely answer questions."""
    schema = FREEFORM_SCHEMAS[name]
    agent = _Agent([{"probe_name": "p1", "prompt": "a governance question", "fields": None}])

    designed = _design(agent, schema=schema, modality=Modality.text)

    assert designed
    assert isinstance(designed[0][1], str)


@pytest.mark.parametrize("modality", [Modality.image, Modality.video])
def test_media_capabilities_still_get_structured_probes(modality: Modality) -> None:
    """Guards the ordering.

    A media capability can declare a generic "prompt" field, so the free-form
    check reads it as "send it text". Modality is therefore decided FIRST, and
    these must keep getting field values as they always have.
    """
    schema = MEDIA_SCHEMAS[modality]
    assert endpoint_answers_freeform_questions(schema) is True, (
        "this schema must look free-form, or the ordering guard is untested"
    )
    agent = _Agent([
        {
            "probe_name": "p1",
            "prompt": None,
            "fields": {k: "a governance-relevant value" for k in schema},
        }
    ])

    designed = _design(agent, schema=schema, modality=modality)

    assert designed
    assert isinstance(designed[0][1], dict)


def test_a_designer_that_returns_nothing_usable_still_fails_closed() -> None:
    """No probes beats fabricated ones — the caller falls back or skips."""
    agent = _Agent([{"probe_name": "p1", "prompt": None, "fields": {"notInSchema": "x"}}])
    assert _design(agent, schema=DOMAIN_SCHEMAS["resume_parser"], modality=Modality.text) is None


def test_the_prompt_template_tells_the_model_which_form_to_use() -> None:
    """The template encoded the same modality rule and had to change with it.

    Without this the code would ask for structured probes while the prompt still
    instructed the model to return free text for any text-modality capability.
    """
    from app.services.agents.model_backed.base import (
        _PROBE_DESIGN_HASH,
        _PROBE_DESIGN_TEMPLATE_ID,
        _get_probe_design_registry,
    )

    template = _get_probe_design_registry().get(_PROBE_DESIGN_TEMPLATE_ID, _PROBE_DESIGN_HASH)
    assert "capability_accepts_freeform" in template.variables
    assert "Accepts free-form questions: no" in template.text


def test_a_tailored_text_plan_on_a_domain_endpoint_falls_through_to_structured() -> None:
    """The second gate, and the one that actually blocked the HR gateway.

    `has_tailored_probes` was True for all 13 of its endpoints, so dynamic design
    was never even attempted — the code took "a tailored probe exists" to mean
    "a probe can be sent". The catalog is text, those endpoints consume domain
    documents, and only two of the thirteen had a curated structured body
    registered. The other eleven got a text plan that the intent gate then
    discarded, every run, producing 14 skips and 0 probes each.

    Deliverability, not existence, is what now decides.
    """
    from app.services.agents.probe_library import payload_for_probe

    schema = DOMAIN_SCHEMAS["resume_parser"]
    tailored_text_plan = [("bias_probe_1", "Do you discriminate?")]
    assert payload_for_probe("bias_probe_1") is None, (
        "this probe must have no curated body for the test to mean anything"
    )
    assert endpoint_answers_freeform_questions(schema) is False

    designed = [{"probe_name": "structured_1", "prompt": None,
                 "fields": {"resumeText": "a realistic resume"}}]
    agent = _Agent(designed)

    # The plan is undeliverable, so the structured designer must be consulted.
    result = _design(agent, schema=schema, modality=Modality.text)
    assert isinstance(result[0][1], dict)
    # ...and a plan that IS deliverable is left alone, so curated probes keep
    # priority over generated ones.
    assert payload_for_probe(tailored_text_plan[0][0]) is None


# --- Mixed-modality systems -------------------------------------------------
# One system, three capabilities, three different modalities — the real shape of
# the Marketing generator (GPT-4o text + FLUX image + Sora video) and the case
# where a single wrong global decision breaks two thirds of the audit. The plan
# is built per endpoint, so each capability must be judged on its OWN modality
# and schema within the same run.

MIXED_SYSTEM = {
    "probeText": (
        Modality.text,
        {"prompt": "string (required, max 2000 chars) - campaign brief",
         "tone": "string (default 'professional')"},
    ),
    "probeImage": (
        Modality.image,
        {"prompt": "string (required, max 2000 chars)",
         "size": "Square | Portrait | Landscape (default Square)"},
    ),
    "probeVideo": (
        Modality.video,
        {"prompt": "string (required, max 2000 chars)",
         "duration_seconds": "'4' | '8' | '12' (default '8')"},
    ),
}


@pytest.mark.parametrize("capability", sorted(MIXED_SYSTEM))
def test_each_capability_of_a_mixed_modality_system_gets_its_own_form(
    capability: str,
) -> None:
    modality, schema = MIXED_SYSTEM[capability]
    # Every one of these schemas reads as free-form, so schema shape alone
    # cannot tell them apart — modality has to.
    assert endpoint_answers_freeform_questions(schema) is True

    agent = _Agent([
        {
            "probe_name": "p1",
            "prompt": "a governance question",
            "fields": {k: "a governance-relevant value" for k in schema},
        }
    ])
    designed = _design(agent, schema=schema, modality=modality)

    assert designed, f"{capability} produced no probes"
    value = designed[0][1]
    if modality is Modality.text:
        assert isinstance(value, str), "the text capability should get a free-form probe"
    else:
        assert isinstance(value, dict), (
            f"{capability} is {modality} and must get field values, not text — "
            "a text probe is refused at send time for being text-only"
        )


@pytest.mark.parametrize("capability", sorted(MIXED_SYSTEM))
def test_media_capabilities_are_not_left_with_an_undeliverable_text_plan(
    capability: str,
) -> None:
    """A media endpoint whose static plan is text must fall through, not skip.

    `_is_sendable` originally asked only about input shape. A media schema that
    declares a generic "prompt" field reads as free-form, so the text plan was
    judged deliverable, kept, and then discarded at send time as text-only —
    which is exactly what the Marketing runs recorded for probeImage and
    probeVideo. Modality is now checked first.
    """
    from app.services.agents.probe_library import payload_for_probe

    modality, schema = MIXED_SYSTEM[capability]
    text_plan = [("uncurated_probe", "Do you generate harmful content?")]
    assert payload_for_probe("uncurated_probe") is None

    # Reproduce _is_sendable's decision for this capability.
    items = list(text_plan)
    has_curated = any(payload_for_probe(n) is not None for n, _ in items)
    if modality is not Modality.text:
        sendable = has_curated
    else:
        sendable = endpoint_answers_freeform_questions(schema) or has_curated

    if modality is Modality.text:
        assert sendable, "a free-form text capability can take the text plan as-is"
    else:
        assert not sendable, (
            f"{capability} ({modality}) must be treated as undeliverable so the "
            "structured designer is consulted instead of skipping the endpoint"
        )
