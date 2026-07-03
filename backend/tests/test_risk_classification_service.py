"""Unit tests for the deterministic preliminary risk screening."""

from app.models.enums import RiskTier
from app.services.risk_classification_service import (
    MAX_RISK_SCORE,
    RISK_QUESTIONS,
    clamp_to_risk_tier,
    screen_risk,
)


def test_max_score_matches_question_weights() -> None:
    assert MAX_RISK_SCORE == sum(weight for weight, _ in RISK_QUESTIONS.values())


def test_no_answers_is_unassessed() -> None:
    result = screen_risk(None)
    assert result.preliminary_risk_tier == "unassessed"
    assert result.preliminary_risk_score == 0
    assert result.triggered_risk_factors == []


def test_all_unknown_is_unassessed() -> None:
    answers = {q: "unknown" for q in RISK_QUESTIONS}
    result = screen_risk(answers)
    assert result.preliminary_risk_tier == "unassessed"
    assert result.preliminary_risk_score == 0


def test_all_no_is_low() -> None:
    answers = {q: "no" for q in RISK_QUESTIONS}
    result = screen_risk(answers)
    assert result.preliminary_risk_tier == "low"
    assert result.preliminary_risk_score == 0


def test_per_se_escalator_forces_critical() -> None:
    # A single safety-critical "yes" (weight 10, below the numeric critical
    # threshold) must still escalate to critical.
    result = screen_risk({"used_in_safety_critical": "yes"})
    assert result.preliminary_risk_tier == "critical"
    assert "safety-critical" in result.risk_summary.lower()


def test_legal_effects_escalator_forces_critical() -> None:
    result = screen_risk({"affects_legal_or_significant_effects": "yes"})
    assert result.preliminary_risk_tier == "critical"


def test_medium_band() -> None:
    # personal data (6) + public facing (4) + generative (3) + third party (3)
    # + high volume (3) = 19 -> medium (>= 19, < 43), no escalators.
    answers = {
        "processes_personal_data": "yes",
        "public_facing_external_users": "yes",
        "generative_free_text_output": "yes",
        "third_party_or_opaque_model": "yes",
        "high_volume_or_scale": "yes",
    }
    result = screen_risk(answers)
    assert result.preliminary_risk_score == 19
    assert result.preliminary_risk_tier == "medium"


def test_high_band_without_escalator() -> None:
    # sensitive (8) + automated (8) + biometric (8) + regulated (6) + tool (6)
    # + no oversight (5) = 41... add personal (6) = 47 -> high (43..65), and
    # none of these are per-se escalators.
    answers = {
        "processes_sensitive_special_category": "yes",
        "fully_automated_decisioning": "yes",
        "biometric_identification": "yes",
        "regulated_domain": "yes",
        "tool_or_action_execution": "yes",
        "no_human_oversight_configured": "yes",
        "processes_personal_data": "yes",
    }
    result = screen_risk(answers)
    assert result.preliminary_risk_score == 47
    assert result.preliminary_risk_tier == "high"


def test_triggered_factors_listed() -> None:
    result = screen_risk({"processes_personal_data": "yes"})
    assert any("personal data" in factor.lower() for factor in result.triggered_risk_factors)


def test_clamp_maps_full_scale_to_engine_tier() -> None:
    assert clamp_to_risk_tier("unassessed") == RiskTier.medium
    assert clamp_to_risk_tier("low") == RiskTier.low
    assert clamp_to_risk_tier("medium") == RiskTier.medium
    assert clamp_to_risk_tier("high") == RiskTier.high
    assert clamp_to_risk_tier("critical") == RiskTier.high
    # Anything unexpected defaults to a safe medium and stays in the enum.
    assert clamp_to_risk_tier("bogus") in set(RiskTier)
