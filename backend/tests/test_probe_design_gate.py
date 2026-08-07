"""The catalog is a floor for probe selection, not a ceiling.

Dynamic probe design used to be gated behind ``not has_tailored_probes(...)``,
so a system whose category had ANY catalog entry for a dimension never had a
probe designed for it. That check is category-coarse: ``classify_system`` maps
on keyword substrings, so a medical triage assistant lands in ``DECISIONING``
(``"triage"`` is a DECISIONING keyword) and is answered "tailored probes exist"
— the hiring and lending ones. It then received Jamal Washington / Emily Carter
resume probes and nothing about triage, on every endpoint, every run.

Design now runs alongside the catalog and the two sets are merged, so curated
probes (the only ones the structured-payload registry and counterfactual
expander are keyed on) are kept AND the system gets probes of its own.
"""

from app.models.enums import Modality
from app.services.agents.base import AgentContext
from app.services.agents.model_backed.base import ModelBackedAgent
from app.services.agents.probe_library import (
    SystemCategory,
    classify_system,
    has_tailored_probes,
    merge_curated_and_designed,
)

CURATED = [("curated_a", "prompt a"), ("curated_b", "prompt b")]
DESIGNED = [("designed_a", "designed prompt a"), ("designed_b", "designed prompt b")]


# --- the merge policy ------------------------------------------------------


def test_curated_probes_are_kept_whole() -> None:
    merged = merge_curated_and_designed(CURATED, DESIGNED)
    assert merged[: len(CURATED)] == CURATED


def test_designed_probes_are_added_not_substituted() -> None:
    merged = merge_curated_and_designed(CURATED, DESIGNED)
    assert [name for name, _ in merged] == [
        "curated_a", "curated_b", "designed_a", "designed_b",
    ]


def test_no_designed_probes_leaves_the_curated_set_untouched() -> None:
    assert merge_curated_and_designed(CURATED, None) == CURATED
    assert merge_curated_and_designed(CURATED, []) == CURATED


def test_a_designed_probe_cannot_shadow_a_curated_name() -> None:
    """The curated probe owns that name in the payload registry."""

    merged = merge_curated_and_designed(
        CURATED, [("curated_a", "different prompt"), ("designed_a", "p")]
    )
    assert [name for name, _ in merged] == ["curated_a", "curated_b", "designed_a"]
    assert dict(merged)["curated_a"] == "prompt a"


def test_budget_caps_the_combined_set() -> None:
    merged = merge_curated_and_designed(CURATED, DESIGNED, budget=3)
    assert len(merged) == 3
    assert [name for name, _ in merged] == ["curated_a", "curated_b", "designed_a"]


def test_a_tight_budget_never_drops_a_curated_probe() -> None:
    """Same invariant `_scale_to_budget` holds: never fewer than the curated set."""

    merged = merge_curated_and_designed(CURATED, DESIGNED, budget=1)
    assert merged[: len(CURATED)] == CURATED


def test_at_least_one_designed_probe_survives_any_budget() -> None:
    """Otherwise a tight budget silently restores catalog-only behavior."""

    merged = merge_curated_and_designed(CURATED, DESIGNED, budget=1)
    designed_names = [name for name, _ in merged if name.startswith("designed")]
    assert len(designed_names) >= 1


def test_structured_designed_probes_merge_too() -> None:
    """A designed probe for a schema-driven endpoint carries fields, not a prompt."""

    structured = [("designed_structured", {"resumeText": "..."})]
    merged = merge_curated_and_designed(CURATED, structured)
    assert merged[-1] == ("designed_structured", {"resumeText": "..."})


# --- the gate itself -------------------------------------------------------


def test_triage_system_classifies_as_decisioning_and_reports_tailored_probes() -> None:
    """The premise of the bug: this is what suppressed design for such a system."""

    profile = classify_system("medical triage assistant")
    assert profile.category is SystemCategory.DECISIONING
    assert has_tailored_probes("bias", "assess-patient", profile) is True


class _Agent(ModelBackedAgent):
    name = "gate_agent"
    probe_dimension = "bias"

    def __init__(self, designed) -> None:
        self._designed = designed
        self.design_calls = 0

    def _design_probes_dynamically(self, **_kwargs):
        self.design_calls += 1
        return self._designed


def _context(**overrides) -> AgentContext:
    class _System:
        name = "Triage Assistant"
        system_type = "medical triage assistant"

    defaults = dict(
        ai_system=_System(),
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[],
        existing_findings=[],
    )
    return AgentContext(**{**defaults, **overrides})  # type: ignore[arg-type]


def test_design_runs_even_when_the_catalog_has_tailored_probes() -> None:
    """The inversion. Previously `design_calls` stayed at 0 for this system."""

    agent = _Agent(DESIGNED)
    context = _context()
    profile = classify_system("medical triage assistant")
    assert has_tailored_probes("bias", "assess-patient", profile) is True

    designed = agent._design_probes_once(
        context=context,
        capability=None,
        endpoint_ref="assess-patient",
        dimension="bias",
        profile=profile,
    )
    assert agent.design_calls == 1
    assert designed == DESIGNED


def test_a_design_is_paid_for_once_per_endpoint_and_dimension() -> None:
    agent = _Agent(DESIGNED)
    context = _context()
    profile = classify_system("medical triage assistant")

    for _ in range(3):
        agent._design_probes_once(
            context=context,
            capability=None,
            endpoint_ref="assess-patient",
            dimension="bias",
            profile=profile,
        )
    assert agent.design_calls == 1
    assert context.designed_probes["gate_agent|assess-patient|bias"] == DESIGNED


def test_a_failed_design_is_cached_too() -> None:
    """A second pass must not re-pay for a call already known to fail."""

    agent = _Agent(None)
    context = _context()
    profile = classify_system("medical triage assistant")

    for _ in range(3):
        result = agent._design_probes_once(
            context=context,
            capability=None,
            endpoint_ref="assess-patient",
            dimension="bias",
            profile=profile,
        )
        assert result is None
    assert agent.design_calls == 1


def test_a_blank_system_type_designs_nothing_without_calling_the_model() -> None:
    """No signal to design from — the result would be a generic prompt, which is
    what the curated fallback already is."""

    agent = _Agent(DESIGNED)
    result = agent._design_probes_once(
        context=_context(),
        capability=None,
        endpoint_ref="endpoint",
        dimension="bias",
        profile=classify_system(""),
    )
    assert result is None
    assert agent.design_calls == 0


def test_no_dimension_designs_nothing() -> None:
    agent = _Agent(DESIGNED)
    result = agent._design_probes_once(
        context=_context(),
        capability=None,
        endpoint_ref="endpoint",
        dimension=None,
        profile=classify_system("medical triage assistant"),
    )
    assert result is None
    assert agent.design_calls == 0


def test_curated_decisioning_probes_still_reach_a_decisioning_system() -> None:
    """The regression guard for the merge: the counterfactual and payload-backed
    catalog probes are keyed by NAME, so losing them would silently disable the
    matched-pair experiment against the real ranking endpoint."""

    from app.services.agents.probe_library import probes_for

    profile = classify_system("hiring")
    curated = probes_for("bias", profile, [])
    merged = merge_curated_and_designed(curated, DESIGNED)
    names = {name for name, _ in merged}
    assert "demographic_parity_matched_pair" in names
    assert "counterfactual_gender_swap" in names
    assert "screening_question_identity_parity" in names


def test_modality_is_untouched_by_the_merge() -> None:
    """Merging plans an endpoint's probes; it must not change what a capability
    accepts. The fail-closed gates in `_execute_probe_plan` still decide that."""

    assert Modality.text is not Modality.image
    merged = merge_curated_and_designed(CURATED, [("designed_fields", {"prompt": "x"})])
    assert isinstance(dict(merged)["designed_fields"], dict)
