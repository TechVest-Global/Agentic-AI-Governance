"""Audit scope: probe the whole app (base endpoint) or specific capabilities."""

from types import SimpleNamespace

from app.services.agents.base import AgentContext


def _ctx(*, selected, capabilities, base="http://gw/api/v1/ai"):
    system = SimpleNamespace(target_endpoint_ref=base, name="HR System", system_type="hr")
    caps = [SimpleNamespace(name=n, endpoint_ref=r) for n, r in capabilities]
    return AgentContext(
        ai_system=system,
        context_profile=None,
        capabilities=caps,
        evidence=[],
        metric_results=[],
        existing_findings=[],
        selected_capabilities=selected,
    )


def test_whole_app_probes_base_endpoint():
    ctx = _ctx(selected=[], capabilities=[("parseResume", "parse-resume")])
    assert ctx.probe_endpoints() == ["http://gw/api/v1/ai"]


def test_scoped_by_endpoint_ref():
    ctx = _ctx(
        selected=["parse-resume", "rank-candidates"],
        capabilities=[("parseResume", "parse-resume"), ("rankCandidatesForJob", "rank-candidates")],
    )
    assert ctx.probe_endpoints() == ["parse-resume", "rank-candidates"]


def test_scoped_by_capability_name_resolves_to_endpoint_ref():
    # Selecting the camelCase capability name resolves to its endpoint_ref.
    ctx = _ctx(
        selected=["parseResume"],
        capabilities=[("parseResume", "parse-resume")],
    )
    assert ctx.probe_endpoints() == ["parse-resume"]


def test_scope_dedupes_and_preserves_order():
    ctx = _ctx(
        selected=["parse-resume", "parseResume", "rank-candidates"],
        capabilities=[("parseResume", "parse-resume"), ("rankCandidatesForJob", "rank-candidates")],
    )
    # "parse-resume" and "parseResume" both resolve to the same endpoint_ref.
    assert ctx.probe_endpoints() == ["parse-resume", "rank-candidates"]


def test_unknown_selection_passes_through():
    # An unrecognized selection is used verbatim (caller responsibility).
    ctx = _ctx(selected=["custom-path"], capabilities=[])
    assert ctx.probe_endpoints() == ["custom-path"]
