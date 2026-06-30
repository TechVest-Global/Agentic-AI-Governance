"""Risk Scorer contract — aggregates specialist findings into a composite risk score.

This module is the bridge between specialist agents and the deliberation council.
It reads all findings accumulated so far in the run, applies severity weighting,
per-framework threshold compliance penalties, and a blast-radius multiplier derived
from the system's risk tier and capabilities.  The output is a ``RiskScoreBundle``
that the ``RiskScorerAgent`` attaches to its summary finding so the Synthesis Agent
and Verdict Agent have structured, calibrated input.

Metric group assignments:
  calibration  — CM-043 (uncertainty_calibration)
  uncertainty  — CM-040, CM-041, CM-044
  operational  — CM-001 to CM-012 (task_fulfilment, groundedness, retrieval)
  cost         — CM-026 to CM-029 (security probe budget proxies)
  workflow     — CM-041, CM-042, CM-044 (human oversight workflow metrics)

Score convention: 0.0 = no risk, 1.0 = maximum risk.
Composite scores are bounded [0.0, 1.0] before the blast-radius multiplier is
applied.  The multiplier can push the composite above 1.0 — the verdict layer
should treat values > 1.0 as automatic escalation triggers.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass, field

from app.configs.config_loader import load_metric_configs_from_dir
from app.configs.config_models import MetricConfig
from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.enums import RiskTier, Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SEVERITY_WEIGHT: dict[str, float] = {
    Severity.info: 1.0,
    Severity.low: 2.0,
    Severity.medium: 3.0,
    Severity.high: 4.0,
    Severity.critical: 5.0,
}

# Maximum possible weighted score for a single finding (critical × confidence 1.0)
_MAX_WEIGHT = _SEVERITY_WEIGHT[Severity.critical]

# Blast-radius multipliers keyed by risk tier
_BLAST_RADIUS_BASE: dict[str, float] = {
    RiskTier.high: 1.6,
    RiskTier.medium: 1.2,
    RiskTier.low: 1.0,
}

# Additional multiplier increments from capabilities
_DESTRUCTIVE_CAP_DELTA = 0.15   # any capability with side_effect_level=destructive
_NO_HUMAN_REVIEW_DELTA = 0.10   # high-risk system with zero human-review gates

# Framework compliance: penalty applied per metric that breaches its critical threshold
# under any active framework.  Scaled by how far below threshold the metric score is.
_THRESHOLD_PENALTY_SCALE = 0.08  # maximum penalty per metric per breach (8 pp)

# Metric group membership (by metric_id prefix ranges)
_CALIBRATION_IDS = {"CM-043"}
_UNCERTAINTY_IDS = {"CM-040", "CM-041", "CM-044"}
_OPERATIONAL_IDS = {f"CM-{i:03d}" for i in range(1, 13)}    # CM-001 to CM-012
_COST_IDS = {f"CM-{i:03d}" for i in range(26, 30)}          # CM-026 to CM-029
_WORKFLOW_IDS = {"CM-041", "CM-042", "CM-044"}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class GroupScore:
    """Risk contribution from one metric group."""

    group: str
    raw_score: float          # 0.0–1.0 before blast-radius
    finding_count: int
    metric_ids: list[str] = field(default_factory=list)
    threshold_penalty: float = 0.0


@dataclass
class RiskScoreBundle:
    """Composite risk score and per-group breakdown produced by the contract.

    Attach this to the risk_scorer's summary finding payload so downstream
    council agents receive structured, calibrated risk input.
    """

    composite_score: float          # blast-radius-adjusted total; may exceed 1.0
    base_score: float               # pre-blast-radius composite (0.0–1.0)
    blast_radius_multiplier: float  # applied to base_score
    severity_weighted_score: float  # finding-severity contribution before grouping

    groups: dict[str, GroupScore]   # keyed by group name

    framework_compliance_penalty: float   # total threshold-breach penalty
    active_frameworks: list[str]
    finding_count: int
    metric_count: int

    # Convenience flags for verdict layer
    has_critical_findings: bool
    has_regression: bool


# ---------------------------------------------------------------------------
# Metric catalogue — loaded once per process (lazy singleton)
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def _load_metric_catalogue() -> dict[str, MetricConfig]:
    """Return {metric_id: MetricConfig} for all YAML-defined metrics."""
    configs = load_metric_configs_from_dir()
    return {c.metric_id: c for c in configs}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def compute_risk_bundle(
    *,
    findings: list[Finding],
    metric_results: list[MetricResult],
    ai_system: AISystem,
    capabilities: list[AISystemCapability],
    context_profile: ApplicationContextProfile | None,
) -> RiskScoreBundle:
    """Compute the composite risk score bundle from all specialist findings.

    Args:
        findings: All ``Finding`` ORM objects persisted so far in the run.
        metric_results: All ``MetricResult`` records for the run.
        ai_system: The registered system being evaluated.
        capabilities: System capabilities (used for blast-radius calculation).
        context_profile: ACP, if registered (used for blast-radius signals).

    Returns:
        A populated ``RiskScoreBundle`` ready to be stored in payload.
    """
    catalogue = _load_metric_catalogue()
    metric_map = {m.metric_id: m for m in metric_results}

    active_frameworks = list(ai_system.selected_frameworks or [])

    # ------------------------------------------------------------------
    # 1. Severity-weighted finding score
    # ------------------------------------------------------------------
    severity_score, has_critical, has_regression = _score_findings(findings)

    # ------------------------------------------------------------------
    # 2. Per-framework threshold compliance penalty
    # ------------------------------------------------------------------
    threshold_penalty = _score_threshold_compliance(
        metric_map=metric_map,
        catalogue=catalogue,
        active_frameworks=active_frameworks,
    )

    # ------------------------------------------------------------------
    # 3. Per-group breakdown
    # ------------------------------------------------------------------
    groups = _build_group_scores(
        findings=findings,
        metric_map=metric_map,
        catalogue=catalogue,
        active_frameworks=active_frameworks,
    )

    # ------------------------------------------------------------------
    # 4. Base composite score (bounded [0, 1])
    # ------------------------------------------------------------------
    base_score = min(1.0, severity_score + threshold_penalty)

    # ------------------------------------------------------------------
    # 5. Blast-radius multiplier
    # ------------------------------------------------------------------
    blast = _compute_blast_radius(
        ai_system=ai_system,
        capabilities=capabilities,
    )

    composite = base_score * blast

    return RiskScoreBundle(
        composite_score=composite,
        base_score=base_score,
        blast_radius_multiplier=blast,
        severity_weighted_score=severity_score,
        groups=groups,
        framework_compliance_penalty=threshold_penalty,
        active_frameworks=active_frameworks,
        finding_count=len(findings),
        metric_count=len(metric_results),
        has_critical_findings=has_critical,
        has_regression=has_regression,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _score_findings(
    findings: list[Finding],
) -> tuple[float, bool, bool]:
    """Return (severity_weighted_score, has_critical, has_regression).

    The severity-weighted score is the mean of (weight × confidence) normalised
    by the maximum possible weight per finding, then capped at 1.0.
    """
    if not findings:
        return 0.0, False, False

    has_critical = False
    has_regression = False
    total_weighted = 0.0

    for f in findings:
        sev = f.severity or Severity.low
        weight = _SEVERITY_WEIGHT.get(sev, _SEVERITY_WEIGHT[Severity.low])
        confidence = float(f.confidence or 0.5)
        total_weighted += (weight / _MAX_WEIGHT) * confidence

        if sev == Severity.critical:
            has_critical = True
        if f.payload and f.payload.get("regression_flag"):
            has_regression = True

    score = total_weighted / len(findings)
    return min(1.0, score), has_critical, has_regression


def _score_threshold_compliance(
    *,
    metric_map: dict[str, MetricResult],
    catalogue: dict[str, MetricConfig],
    active_frameworks: list[str],
) -> float:
    """Return cumulative framework-threshold penalty (sum of per-metric breach penalties).

    For each metric result that breaches the *critical* threshold under at least
    one active framework, compute a penalty proportional to the shortfall:
        penalty = SCALE × (threshold − score) / threshold
    Penalties are summed and bounded to [0.0, 0.5] so a batch of threshold
    breaches can contribute at most 50 pp to the base composite score.
    """
    if not active_frameworks or not catalogue:
        return 0.0

    total_penalty = 0.0

    for metric_id, result in metric_map.items():
        config = catalogue.get(metric_id)
        if config is None:
            continue
        score = result.normalized_score
        if score is None:
            continue

        worst_penalty = 0.0
        for framework_id in active_frameworks:
            thresholds = config.thresholds.get(framework_id)
            if thresholds is None:
                continue
            critical_threshold = thresholds.critical
            if critical_threshold is None:
                continue
            if score < critical_threshold:
                shortfall_ratio = (critical_threshold - score) / max(critical_threshold, 1e-6)
                penalty = _THRESHOLD_PENALTY_SCALE * shortfall_ratio
                worst_penalty = max(worst_penalty, penalty)

        total_penalty += worst_penalty

    return min(0.5, total_penalty)


def _build_group_scores(
    *,
    findings: list[Finding],
    metric_map: dict[str, MetricResult],
    catalogue: dict[str, MetricConfig],
    active_frameworks: list[str],
) -> dict[str, GroupScore]:
    """Compute per-group risk scores.

    Each group is scored independently using the same severity-weighted logic
    applied to findings whose ``metric_id`` payload belongs to that group,
    plus a proportional share of the threshold penalty for metrics in the group.
    """
    group_defs: dict[str, set[str]] = {
        "calibration": _CALIBRATION_IDS,
        "uncertainty": _UNCERTAINTY_IDS,
        "operational": _OPERATIONAL_IDS,
        "cost": _COST_IDS,
        "workflow": _WORKFLOW_IDS,
    }

    # Index findings by their metric_id payload
    findings_by_metric: dict[str, list[Finding]] = {}
    ungrouped: list[Finding] = []
    for f in findings:
        mid = f.payload.get("metric_id") if f.payload else None
        if mid:
            findings_by_metric.setdefault(str(mid), []).append(f)
        else:
            ungrouped.append(f)

    groups: dict[str, GroupScore] = {}

    for group_name, member_ids in group_defs.items():
        group_findings: list[Finding] = []
        for mid in member_ids:
            group_findings.extend(findings_by_metric.get(mid, []))

        group_metric_ids = [mid for mid in member_ids if mid in metric_map]

        # Threshold penalty contribution from this group's metrics
        group_threshold_penalty = _score_threshold_compliance(
            metric_map={mid: metric_map[mid] for mid in group_metric_ids if mid in metric_map},
            catalogue=catalogue,
            active_frameworks=active_frameworks,
        )

        raw, _, _ = _score_findings(group_findings)
        group_score = min(1.0, raw + group_threshold_penalty)

        groups[group_name] = GroupScore(
            group=group_name,
            raw_score=group_score,
            finding_count=len(group_findings),
            metric_ids=group_metric_ids,
            threshold_penalty=group_threshold_penalty,
        )

    # Absorb ungrouped findings into an "other" bucket (does not inflate composite)
    if ungrouped:
        raw, _, _ = _score_findings(ungrouped)
        groups["other"] = GroupScore(
            group="other",
            raw_score=raw,
            finding_count=len(ungrouped),
            metric_ids=[],
        )

    return groups


def _compute_blast_radius(
    *,
    ai_system: AISystem,
    capabilities: list[AISystemCapability],
) -> float:
    """Return the blast-radius multiplier for the system.

    Base multiplier comes from risk tier.  Increments are added for:
    - Any capability with destructive side effects
    - High-risk system with no human-review gates on any capability
    """
    risk_tier = ai_system.risk_tier or RiskTier.medium
    multiplier = _BLAST_RADIUS_BASE.get(risk_tier, _BLAST_RADIUS_BASE[RiskTier.medium])

    has_destructive = any(
        getattr(cap, "side_effect_level", None) == "destructive"
        for cap in capabilities
    )
    if has_destructive:
        multiplier += _DESTRUCTIVE_CAP_DELTA

    if risk_tier == RiskTier.high:
        has_human_review = any(cap.requires_human_review for cap in capabilities)
        if not has_human_review:
            multiplier += _NO_HUMAN_REVIEW_DELTA

    return round(multiplier, 4)
