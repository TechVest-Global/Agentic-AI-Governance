"""Audit scope: probe the whole app (base endpoint) or specific capabilities."""

from types import SimpleNamespace

from app.models.enums import Modality
from app.services.agents.base import AgentContext


def _ctx(*, selected, capabilities, base="http://gw/api/v1/ai", modality=Modality.text):
    system = SimpleNamespace(target_endpoint_ref=base, name="HR System", system_type="hr")
    caps = [SimpleNamespace(name=n, endpoint_ref=r, modality=modality) for n, r in capabilities]
    return AgentContext(
        ai_system=system,
        context_profile=None,
        capabilities=caps,
        evidence=[],
        metric_results=[],
        existing_findings=[],
        selected_capabilities=selected,
    )


def test_whole_app_probes_every_registered_capability():
    # A whole-application audit must reach EVERY registered capability, not
    # just a text one — a specialist agent can design a real structured probe
    # for a non-text capability (see ModelBackedAgent._design_probes_dynamically
    # + the fail-closed modality gate in _execute_probe_plan), so image/video
    # capabilities must be in the list for that machinery to ever run.
    ctx = _ctx(
        selected=[],
        capabilities=[("parseResume", "parse-resume"), ("scanID", "scan-id")],
    )
    assert ctx.probe_endpoints() == ["parse-resume", "scan-id"]


def test_whole_app_includes_non_text_capabilities():
    # Previously this fell back to the bare base endpoint, on the theory that
    # nothing here is safe to send a free-text probe to — but that also meant
    # image/video capabilities were never even attempted, not skipped with a
    # reason. They're included now; dispatch-time safety is the gate's job.
    ctx = _ctx(
        selected=[], capabilities=[("probeImage", "probe/image")], modality=Modality.image
    )
    assert ctx.probe_endpoints() == ["probe/image"]


def test_whole_app_falls_back_to_base_endpoint_with_no_capabilities():
    ctx = _ctx(selected=[], capabilities=[])
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
