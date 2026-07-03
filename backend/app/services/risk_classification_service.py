"""Deterministic, explainable preliminary risk screening.

Developers answer factual yes/no/unknown questions during registration; this
module turns those answers into a *preliminary* risk score and tier. It is not
the final approved governance classification — that is derived later by the
governance engine. The logic is pure (no DB, no LLM) so it is trivially testable
and reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.enums import RiskTier

# ── Screening questions ───────────────────────────────────────────────────────
# Each question is a factual yes/no/unknown. "yes" contributes its weight; "no",
# "unknown", and missing contribute 0 (unknown is treated conservatively-neutral
# in phase 1 rather than assumed-yes, to avoid over-flagging incomplete drafts).

YES = "yes"

# question_id -> (weight, human-readable factor label)
RISK_QUESTIONS: dict[str, tuple[int, str]] = {
    "affects_legal_or_significant_effects": (10, "Legal or significant effects on individuals"),
    "processes_personal_data": (6, "Processes personal data"),
    "processes_sensitive_special_category": (8, "Processes sensitive/special-category data"),
    "fully_automated_decisioning": (8, "Fully automated decision-making"),
    "used_in_safety_critical": (10, "Used in a safety-critical context"),
    "biometric_identification": (8, "Biometric identification"),
    "vulnerable_populations": (6, "Affects vulnerable populations"),
    "public_facing_external_users": (4, "Public-facing / external users"),
    "high_volume_or_scale": (3, "High volume or scale"),
    "generative_free_text_output": (3, "Generative free-text output"),
    "tool_or_action_execution": (6, "Executes tools or takes actions"),
    "cross_border_data_transfer": (3, "Cross-border data transfer"),
    "third_party_or_opaque_model": (3, "Third-party / opaque model"),
    "no_human_oversight_configured": (5, "No human oversight configured"),
    "regulated_domain": (6, "Operates in a regulated domain"),
    "prior_incidents_or_known_risks": (5, "Prior incidents or known risks"),
}

# Questions that, when answered "yes", force the top tier regardless of score.
PER_SE_ESCALATORS: tuple[str, ...] = (
    "affects_legal_or_significant_effects",
    "used_in_safety_critical",
)

MAX_RISK_SCORE: int = sum(weight for weight, _ in RISK_QUESTIONS.values())

# Tier thresholds on the raw score (inclusive lower bounds).
_CRITICAL_THRESHOLD = 66
_HIGH_THRESHOLD = 43
_MEDIUM_THRESHOLD = 19


@dataclass(frozen=True)
class RiskScreeningResult:
    preliminary_risk_score: int
    preliminary_risk_tier: str
    triggered_risk_factors: list[str] = field(default_factory=list)
    risk_summary: str = ""


def _is_yes(value: object) -> bool:
    return isinstance(value, str) and value.strip().lower() == YES


def _is_definitive(value: object) -> bool:
    """A yes/no answer is a real assessment; 'unknown' (or blank) is not."""
    return isinstance(value, str) and value.strip().lower() in {"yes", "no"}


def screen_risk(answers: dict[str, str] | None) -> RiskScreeningResult:
    """Compute a preliminary risk score + tier from screening answers."""
    answers = answers or {}
    # "unknown"/blank answers don't count as an assessment — if the developer
    # answered nothing definitively, the tier stays UNASSESSED rather than low.
    answered = any(_is_definitive(answers.get(q)) for q in RISK_QUESTIONS)

    score = 0
    triggered: list[str] = []
    escalated = False
    for question_id, (weight, label) in RISK_QUESTIONS.items():
        if _is_yes(answers.get(question_id)):
            score += weight
            triggered.append(label)
            if question_id in PER_SE_ESCALATORS:
                escalated = True

    if not answered:
        tier = "unassessed"
    elif escalated or score >= _CRITICAL_THRESHOLD:
        tier = "critical"
    elif score >= _HIGH_THRESHOLD:
        tier = "high"
    elif score >= _MEDIUM_THRESHOLD:
        tier = "medium"
    else:
        tier = "low"

    summary = _summarize(tier, score, triggered, escalated)
    return RiskScreeningResult(
        preliminary_risk_score=score,
        preliminary_risk_tier=tier,
        triggered_risk_factors=triggered,
        risk_summary=summary,
    )


def _summarize(tier: str, score: int, triggered: list[str], escalated: bool) -> str:
    if tier == "unassessed":
        return "Preliminary risk tier UNASSESSED — no screening answers provided yet."
    lead = f"Preliminary tier {tier.upper()} (score {score}/{MAX_RISK_SCORE})."
    if escalated:
        lead += " Escalated to critical by a per-se risk factor."
    if triggered:
        return f"{lead} Contributing factors: {'; '.join(triggered)}."
    return f"{lead} No elevated risk factors reported."


def clamp_to_risk_tier(preliminary_tier: str) -> RiskTier:
    """Map the full preliminary scale onto the 3-value engine ``RiskTier``.

    The orchestrator only understands low/medium/high; ``unassessed`` defaults
    to ``medium`` (matching the AISystem default) and ``critical`` folds into
    ``high``.
    """
    mapping = {
        "unassessed": RiskTier.medium,
        "low": RiskTier.low,
        "medium": RiskTier.medium,
        "high": RiskTier.high,
        "critical": RiskTier.high,
    }
    return mapping.get((preliminary_tier or "").strip().lower(), RiskTier.medium)
