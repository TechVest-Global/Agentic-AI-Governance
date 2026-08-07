"""Framework knowledge configuration types.

The regulatory ingester (Layer 1) loads one ``FrameworkKnowledge`` record per
selected framework. These records hold the parts of a governance framework that
are *not* stored as ``FrameworkMapping`` rows in the database: scoring rubrics,
severity thresholds, target-model probe templates, the citation format, and the
coverage requirements the coverage-gap detector checks production logs against.

Keeping this as config (not hardcoded logic) satisfies the spec invariant that
framework behavior is configuration-driven rather than baked into services.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field

# Default citation format used when a framework knowledge record does not set one.
DEFAULT_CITATION_FORMAT = "{framework_id}:{framework_version}:{control_ref}"


@dataclass(frozen=True)
class RegulatoryRubricItem:
    """One scoring rubric entry an agent or evaluator applies to a dimension."""

    rubric_id: str
    dimension: str
    description: str
    scoring_guidance: str


@dataclass(frozen=True)
class ProbeTemplate:
    """A reusable target-model probe an orchestrator can schedule for a control."""

    probe_id: str
    dimension: str
    description: str
    prompt_template: str
    control_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class CoverageRequirement:
    """An expectation the coverage-gap detector checks production logs against.

    ``category`` selects how the requirement is evaluated against the log
    analysis. Supported categories:

    - ``demographic_coverage`` / ``jurisdiction_coverage`` / ``request_category``
      / ``outcome_balance``: set-membership checks against observed log values,
      with an optional ``minimum_distinct`` floor.
    - ``pii_handling``: requires at least one PII-bearing sample to assess.
    - ``adversarial_coverage``: requires at least one flagged/adversarial sample.
    - ``log_evidence``: requires a minimum number of log records overall.

    ``aliases`` maps a synonym a client might use in its own logs onto the
    canonical value in ``expected_values`` (``{"European Union": "EU"}``), so a
    client whose vocabulary differs from ours is not reported as a false gap.
    Matching is already case- and whitespace-insensitive, so aliases are only
    needed for genuinely different wording. Keys and values are matched under
    the same folding, and the mapping stays config so the check remains
    deterministic and reproducible from the framework version alone.
    """

    requirement_id: str
    category: str
    dimension: str
    description: str
    recommendation: str
    severity: str = "medium"
    expected_values: tuple[str, ...] = ()
    minimum_distinct: int = 0
    control_refs: tuple[str, ...] = ()
    recommended_probe_id: str | None = None
    aliases: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class FrameworkKnowledge:
    """Config-driven knowledge for one governance framework."""

    framework_id: str
    framework_name: str
    framework_version: str
    citation_format: str = DEFAULT_CITATION_FORMAT
    severity_thresholds: Mapping[str, float] = field(default_factory=dict)
    rubric: tuple[RegulatoryRubricItem, ...] = ()
    probe_templates: tuple[ProbeTemplate, ...] = ()
    coverage_requirements: tuple[CoverageRequirement, ...] = ()

    def citation_for(self, control_ref: str) -> str:
        return self.citation_format.format(
            framework_id=self.framework_id,
            framework_version=self.framework_version,
            control_ref=control_ref,
        )
