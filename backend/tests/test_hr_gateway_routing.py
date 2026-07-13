"""HR gateway probe routing.

Regression guard for the critical bug where every free-text behavioral probe was
routed to the parse-resume extractor, which returns
``{"firstName": "Not Provided", ...}`` for anything that isn't a literal resume —
producing meaningless evidence for bias / oversight / explainability findings.

Behavioral probes must default to a reasoning endpoint (analyze-response);
resume-parsing probes must still reach parse-resume; explicit function names and
structured-payload endpoint overrides must be honored.
"""

from app.services.model_clients.base import TargetModelRequest
from app.services.model_clients.hr_gateway import _DEFAULT_PATH, _prompt_body, _resolve_path


def _req(capability_name: str) -> TargetModelRequest:
    # endpoint_ref is the system name for a whole-application audit (not a known
    # function), so routing is driven by capability_name (the probe name).
    return TargetModelRequest(
        endpoint_ref="HR Recruitment System (AI Gateway)",
        prompt="probe text",
        capability_name=capability_name,
    )


def test_default_endpoint_is_a_reasoning_endpoint_not_the_extractor():
    # The core fix: unknown/behavioral probes must NOT default to parse-resume.
    assert _DEFAULT_PATH == "analyze-response"


def test_behavioral_probes_route_to_reasoning_endpoint():
    for probe in (
        "protected_attribute_use",
        "decision_rationale",
        "adverse_action_explanation",
        "structured_output_adherence",
        "rubric_exfiltration",
        "record_for_audit",
    ):
        assert _resolve_path(_req(probe)) == "analyze-response", probe


def test_resume_probes_still_route_to_parse_resume():
    for probe in ("parse_resume_name_signal", "parse_resume_name_control"):
        assert _resolve_path(_req(probe)) == "parse-resume", probe


def test_explicit_function_names_are_honored():
    assert _resolve_path(_req("rank-candidates")) == "rank-candidates"
    assert _resolve_path(_req("rankCandidatesForJob")) == "rank-candidates"
    assert _resolve_path(_req("/api/v1/ai/deep-rank-candidates")) == "deep-rank-candidates"


def test_default_body_is_valid_for_reasoning_endpoint():
    # The default endpoint's body builder must produce a valid analyze-response
    # request (question + response), so a plain probe yields real analysis.
    body = _prompt_body(_DEFAULT_PATH, "Explain whether age influenced the score.")
    assert "response" in body
    assert body["response"] == "Explain whether age influenced the score."
    assert "question" in body
