"""Counterfactual probes must actually be counterfactual.

Before this, `counterfactual_gender_swap` and `demographic_parity_matched_pair`
sent the SAME request body as the plain fairness probe — six curated probes
resolved to two distinct requests. With nothing varying, nothing could be
compared, so no disparity was detectable even against the correct decisioning
endpoint. The agent could only editorialise about a single response.

The design under test is the résumé-audit standard: hold every qualification
byte-identical and vary only the protected-attribute signal on one focal
entity, so any output difference is attributable to that signal alone.
"""

import json

import pytest
from app.services.agents.probe_library import (
    apply_identity_variant,
    expand_counterfactual_probes,
    identity_variants,
    payload_carries_identity,
    payload_for_probe,
    variant_label_of,
)

_CANDIDATES = {
    "job": {"title": "Senior Backend Engineer"},
    "candidates": [
        {"id": "a", "firstName": "Jordan", "lastName": "Alvarez",
         "totalExperience": 8, "skills": ["Python"], "education": [{"degree": "B.S."}]},
        {"id": "b", "firstName": "Sam", "lastName": "Chen",
         "totalExperience": 4, "skills": ["Python", "Redis"], "education": [{"degree": "M.S."}]},
    ],
}


# ── variant substitution ─────────────────────────────────────────────────────


def test_only_the_focal_entity_is_renamed() -> None:
    """The matched-pair standard: one résumé's name changes, the rest of the
    cohort stays fixed as context so the focal score is attributable."""
    variant = next(v for v in identity_variants() if v.label == "gender:female")

    out = apply_identity_variant(_CANDIDATES, variant)

    assert out["candidates"][0]["firstName"] == variant.first_name
    assert out["candidates"][1] == _CANDIDATES["candidates"][1]


def test_qualifications_are_never_touched() -> None:
    """If anything but the name moves, the experiment is confounded and the
    result cannot be attributed to the protected attribute."""
    variant = next(v for v in identity_variants() if v.label == "religion:muslim")

    out = apply_identity_variant(_CANDIDATES, variant)

    focal_before = {k: v for k, v in _CANDIDATES["candidates"][0].items()
                    if k not in ("firstName", "lastName")}
    focal_after = {k: v for k, v in out["candidates"][0].items()
                   if k not in ("firstName", "lastName")}
    assert focal_before == focal_after
    assert out["job"] == _CANDIDATES["job"]


def test_whole_cohort_swap_is_available() -> None:
    variant = next(v for v in identity_variants() if v.label == "gender:male")

    out = apply_identity_variant(_CANDIDATES, variant, focal_only=False)

    assert {c["firstName"] for c in out["candidates"]} == {variant.first_name}


def test_substitution_does_not_mutate_the_base_payload() -> None:
    """The registry hands out one shared base body; mutating it would leak a
    variant's identity into every later probe."""
    original = json.dumps(_CANDIDATES, sort_keys=True)
    variant = next(v for v in identity_variants() if v.label == "gender:female")

    apply_identity_variant(_CANDIDATES, variant)

    assert json.dumps(_CANDIDATES, sort_keys=True) == original


def test_nested_and_scalar_payloads_survive() -> None:
    variant = next(v for v in identity_variants() if v.label == "gender:male")
    assert apply_identity_variant({"a": [1, "x", None]}, variant) == {"a": [1, "x", None]}
    assert apply_identity_variant("plain", variant) == "plain"


def test_generic_name_field_gets_the_full_name() -> None:
    """Works for a future system that registers a single `name` field rather
    than firstName/lastName."""
    variant = next(v for v in identity_variants() if v.label == "nationality:east_asian")

    out = apply_identity_variant({"applicant": {"name": "Someone Else"}}, variant)

    assert out["applicant"]["name"] == variant.full_name


# ── attribute coverage ───────────────────────────────────────────────────────


def test_all_three_requested_attributes_are_covered() -> None:
    attributes = {v.attribute for v in identity_variants()}
    assert {"gender", "nationality", "religion"} <= attributes


def test_a_control_is_always_included() -> None:
    """Without an unchanged baseline in the same set there is nothing to measure
    the variants against."""
    assert any(v.attribute == "control" for v in identity_variants())
    assert any(v.attribute == "control" for v in identity_variants(attributes=("gender",)))


def test_attributes_can_be_narrowed() -> None:
    labels = {v.label for v in identity_variants(attributes=("gender",))}
    assert "gender:female" in labels
    assert not any(label.startswith("religion:") for label in labels)


# ── plan expansion ───────────────────────────────────────────────────────────


def test_counterfactual_probe_expands_into_distinct_requests() -> None:
    expanded = expand_counterfactual_probes([("counterfactual_gender_swap", "prompt")])

    bodies = set()
    for name, _ in expanded:
        payload = payload_for_probe(name)
        assert payload is not None, name
        bodies.add(json.dumps(payload.body, sort_keys=True))

    assert len(expanded) == len(identity_variants())
    # The whole point: every request in the set differs.
    assert len(bodies) == len(expanded)


def test_variant_label_is_recoverable_from_the_probe_name() -> None:
    """The label rides in the name so it lands in the stored probe record and a
    reviewer can line the responses up."""
    expanded = expand_counterfactual_probes([("demographic_parity_matched_pair", "p")])
    labels = {variant_label_of(name) for name, _ in expanded}

    assert "control" in labels
    assert "gender:female" in labels
    assert variant_label_of("plain_probe") is None
    assert variant_label_of("probe#gender:male@some-endpoint") == "gender:male"


def test_non_counterfactual_probes_pass_through_untouched() -> None:
    probes = [("rank_candidates_fairness", "p1"), ("some_text_probe", "p2")]
    assert expand_counterfactual_probes(probes) == probes


def test_probe_without_identity_in_its_payload_is_not_expanded() -> None:
    """N identical requests would prove nothing, so a payload with no name field
    must not be turned into a comparison."""
    assert payload_carries_identity({"jdText": "some text"}) is False
    assert payload_carries_identity(_CANDIDATES) is True


def test_variant_suffix_resolves_through_endpoint_and_pass_suffixes() -> None:
    """The agent base appends @endpoint and _passN; a variant must still resolve."""
    plain = payload_for_probe("counterfactual_gender_swap")
    scoped = payload_for_probe("counterfactual_gender_swap#gender:female@rank-candidates")

    assert plain is not None and scoped is not None
    assert scoped.endpoint == plain.endpoint
    assert scoped.body != plain.body


def test_screening_qa_is_a_second_counterfactual_surface() -> None:
    """Adverse TREATMENT, not just adverse scoring: a system can rank evenly and
    still interrogate some applicants harder. A signal appearing on two
    independent decision surfaces is much harder to dismiss as endpoint noise."""
    expanded = expand_counterfactual_probes([("screening_question_identity_parity", "p")])

    bodies, names = set(), set()
    for name, _ in expanded:
        payload = payload_for_probe(name)
        assert payload is not None and payload.endpoint == "screening-qa"
        bodies.add(json.dumps(payload.body, sort_keys=True))
        names.add(payload.body["candidateName"])

    assert len(expanded) == len(identity_variants())
    assert len(bodies) == len(expanded)
    assert len(names) == len(expanded)


def test_screening_qa_varies_only_the_candidate_name() -> None:
    control = payload_for_probe("screening_question_identity_parity#control").body
    variant = payload_for_probe("screening_question_identity_parity#nationality:west_african").body

    assert control["candidateName"] != variant["candidateName"]
    assert {k: v for k, v in control.items() if k != "candidateName"} == \
           {k: v for k, v in variant.items() if k != "candidateName"}


def test_unknown_variant_label_falls_back_to_the_base_body() -> None:
    base = payload_for_probe("counterfactual_gender_swap")
    unknown = payload_for_probe("counterfactual_gender_swap#gender:nonexistent")

    assert unknown is not None
    assert unknown.body == base.body
