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
from app.services.context_assembly.registry_facts import RegistryFacts

# Categories evaluated as set-membership against observed log values.
_SET_OBSERVATIONS = {
    "demographic_coverage": "observed_demographic_groups",
    "jurisdiction_coverage": "observed_jurisdictions",
    "request_category": "observed_request_categories",
    "outcome_balance": "observed_outcomes",
}

# Categories evaluated against the AI Registry's DECLARED configuration rather
# than against submitted logs, mapped to what each one expects to see. Membership
# in this table is what routes a requirement to the registry evaluator, so adding
# a category here and a branch below is all a new declared-fact check needs.
_REGISTRY_EXPECTATIONS = {
    "human_oversight": (
        "every state-changing capability requires human review"
    ),
    "context_profile": (
        "an ApplicationContextProfile with all five areas populated"
    ),
    "capability_schema": (
        "every enabled capability declares an input schema"
    ),
    "capability_registration": (
        "at least one enabled capability"
    ),
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


def _evaluate_registry_requirement(
    requirement: CoverageRequirement,
    registry: RegistryFacts | None,
) -> tuple[bool, str, list[str], list[str]]:
    """Evaluate a requirement against what the registry DECLARES.

    These categories need no logs and no probing: a declared deficiency is
    findable from the registration alone. Absent facts are reported as a gap
    rather than a pass, for the same reason empty logs are — "we could not
    look" is not "there is nothing there".
    """

    category = requirement.category
    if registry is None or not registry.available:
        return (
            True,
            "No registry facts available to assess the declared configuration.",
            [_REGISTRY_EXPECTATIONS[category]],
            ["registry_facts=unavailable"],
        )

    expected = [_REGISTRY_EXPECTATIONS[category]]

    if category == "human_oversight":
        offenders = list(registry.state_changing_without_review)
        return (
            bool(offenders),
            (
                f"{len(offenders)} state-changing capability(ies) act without "
                f"human review: {', '.join(offenders)}."
            ),
            expected,
            offenders or ["all state-changing capabilities require human review"],
        )

    if category == "context_profile":
        missing = list(registry.empty_profile_areas)
        if not registry.profile_present:
            return (
                True,
                "No ApplicationContextProfile is registered for this system.",
                expected,
                ["profile=absent"],
            )
        return (
            bool(missing),
            f"Context profile area(s) not populated: {', '.join(missing)}.",
            expected,
            missing or ["all five profile areas populated"],
        )

    if category == "capability_schema":
        offenders = list(registry.capabilities_without_schema)
        return (
            bool(offenders),
            (
                f"{len(offenders)} capability(ies) declare no input schema, so "
                f"they cannot be probed with a valid request: "
                f"{', '.join(offenders)}."
            ),
            expected,
            offenders or ["all capabilities declare an input schema"],
        )

    # capability_registration
    return (
        registry.capability_count == 0,
        "No enabled capabilities are registered, so there is no audited surface.",
        expected,
        [f"capability_count={registry.capability_count}"],
    )


def _evaluate_requirement(
    requirement: CoverageRequirement,
    log_analysis: LogAnalysisSummary,
    registry: RegistryFacts | None = None,
) -> tuple[bool, str, list[str], list[str]]:
    """Return (is_gap, description, expected, observed) for one requirement."""

    category = requirement.category

    if category in _REGISTRY_EXPECTATIONS:
        return _evaluate_registry_requirement(requirement, registry)

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
    registry_facts: RegistryFacts | None = None,
) -> list[CoverageGapRead]:
    """Cross-reference observed log coverage AND declared registry facts against
    each resolved framework's coverage requirements.

    ``registry_facts`` is optional so a caller with only logs (a test, or an
    analysis of a log sample outside a run) keeps working. Requirements in the
    registry categories then report an honest "could not assess" gap rather than
    passing by default.
    """
    gaps: list[CoverageGapRead] = []

    for framework in regulatory_context.frameworks:
        knowledge = get_framework_knowledge(framework.framework_id)
        if knowledge is None:
            continue
        for requirement in knowledge.coverage_requirements:
            is_gap, description, expected, observed = _evaluate_requirement(
                requirement, log_analysis, registry_facts
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
