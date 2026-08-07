"""Coverage gap detector (Layer 1, task P013).

Cross-references the deterministic log analysis against each resolved framework's
coverage requirements (from ``app.configs.frameworks``) and emits prioritized,
deterministic gap records that the orchestrator and specialist agents consume for
probe planning.

Set-membership checks compare *canonical* values: observed log values are folded
for case and whitespace and mapped through the requirement's configured aliases
before matching, so a client whose vocabulary differs from ours is not reported
as a false gap. The folding is config-driven and value-stable, which keeps the
assembled context reproducible for the hash-chained state entry.
"""

from collections.abc import Mapping

from app.configs.frameworks.base import CoverageRequirement
from app.configs.frameworks.registry import get_framework_knowledge
from app.models.enums import Severity
from app.schemas.governance import (
    CoverageGapRead,
    LogAnalysisSummary,
    RegulatoryContextRead,
)
from app.services.context_assembly.base import SEVERITY_ORDER, coerce_severity

# Categories evaluated as set-membership against observed log values.
_SET_OBSERVATIONS = {
    "demographic_coverage": "observed_demographic_groups",
    "jurisdiction_coverage": "observed_jurisdictions",
    "request_category": "observed_request_categories",
    "outcome_balance": "observed_outcomes",
}


def _fold(value: str) -> str:
    """Case- and whitespace-insensitive key for comparing vocabulary values.

    ``" European  Union "`` and ``"european union"`` fold to the same key, so a
    client is not reported as missing coverage over pure formatting.
    """

    return " ".join(value.casefold().split())


def _canonical_keys(observed: list[str], aliases: Mapping[str, str]) -> set[str]:
    """Fold observed values onto the canonical vocabulary a requirement expects.

    An observed value with no alias keeps its own folded key, so unrecognized
    values still count toward ``minimum_distinct`` rather than disappearing.
    """

    alias_lookup = {_fold(synonym): canonical for synonym, canonical in aliases.items()}
    keys: set[str] = set()
    for value in observed:
        key = _fold(value)
        canonical = alias_lookup.get(key)
        keys.add(_fold(canonical) if canonical is not None else key)
    return keys


def _evaluate_requirement(
    requirement: CoverageRequirement,
    log_analysis: LogAnalysisSummary,
) -> tuple[bool, str, list[str], list[str]]:
    """Return (is_gap, description, expected, observed) for one requirement."""

    category = requirement.category

    if category in _SET_OBSERVATIONS:
        observed = list(getattr(log_analysis, _SET_OBSERVATIONS[category]))
        expected = list(requirement.expected_values)
        if log_analysis.empty:
            return True, "No log evidence available to assess coverage.", expected, observed
        # Compare on canonical keys so a client's own wording ("European Union"
        # for "EU") satisfies the requirement instead of reading as a gap.
        observed_keys = _canonical_keys(observed, requirement.aliases)
        missing = [value for value in expected if _fold(value) not in observed_keys]
        below_minimum = (
            requirement.minimum_distinct > 0
            and len(observed_keys) < requirement.minimum_distinct
        )
        if missing:
            return True, f"Missing coverage for: {', '.join(missing)}.", expected, observed
        if below_minimum:
            return (
                True,
                f"Only {len(observed_keys)} distinct value(s) observed; "
                f"at least {requirement.minimum_distinct} required.",
                expected,
                observed,
            )
        return False, "", expected, observed

    if category == "pii_handling":
        observed = [f"pii_request_count={log_analysis.pii_request_count}"]
        expected = ["at least one PII-bearing sample"]
        is_gap = log_analysis.pii_request_count == 0
        description = "No PII-bearing samples available to assess data handling controls."
        return is_gap, description, expected, observed

    if category == "adversarial_coverage":
        observed = [f"flagged_request_count={log_analysis.flagged_request_count}"]
        expected = ["at least one flagged/adversarial sample"]
        is_gap = log_analysis.flagged_request_count == 0
        description = "No flagged or adversarial samples available to assess misuse resilience."
        return is_gap, description, expected, observed

    # Default: log_evidence and any unknown category fall back to a volume check.
    observed = [f"total_requests={log_analysis.total_requests}"]
    minimum = max(requirement.minimum_distinct, 1)
    expected = [f"at least {minimum} log record(s)"]
    is_gap = log_analysis.total_requests < minimum
    description = "Insufficient log evidence to assess system behavior."
    return is_gap, description, expected, observed


def _build_gap(
    *,
    framework_id: str,
    requirement: CoverageRequirement,
    description: str,
    expected: list[str],
    observed: list[str],
) -> CoverageGapRead:
    return CoverageGapRead(
        gap_id=f"{framework_id}:{requirement.requirement_id}",
        framework_id=framework_id,
        category=requirement.category,
        dimension=requirement.dimension,
        severity=coerce_severity(requirement.severity),
        description=description,
        control_refs=list(requirement.control_refs),
        recommended_probe_id=requirement.recommended_probe_id,
        recommended_action=requirement.recommendation,
        expected=expected,
        observed=observed,
    )


def detect_coverage_gaps(
    *,
    log_analysis: LogAnalysisSummary,
    regulatory_context: RegulatoryContextRead,
) -> list[CoverageGapRead]:
    gaps: list[CoverageGapRead] = []

    for framework in regulatory_context.frameworks:
        knowledge = get_framework_knowledge(framework.framework_id)
        if knowledge is None:
            continue
        for requirement in knowledge.coverage_requirements:
            is_gap, description, expected, observed = _evaluate_requirement(
                requirement, log_analysis
            )
            if not is_gap:
                continue
            gaps.append(
                _build_gap(
                    framework_id=framework.framework_id,
                    requirement=requirement,
                    description=description,
                    expected=expected,
                    observed=observed,
                )
            )

    # Highest severity first, then stable by framework_id and gap_id.
    gaps.sort(key=lambda gap: (-SEVERITY_ORDER[gap.severity], gap.framework_id, gap.gap_id))
    return gaps


def highest_gap_severity(gaps: list[CoverageGapRead]) -> Severity | None:
    if not gaps:
        return None
    return max(gaps, key=lambda gap: SEVERITY_ORDER[gap.severity]).severity
