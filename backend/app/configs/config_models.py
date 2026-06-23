"""
Pydantic v2 config models for metric and framework YAML files.

Design principles enforced here:
- extra="forbid" on every model: unknown/misspelled fields raise immediately.
- formula and condition_key are Literal enums of REGISTERED function names — no free
  expressions, no eval().
- framework_mapping items are validated against an abstract-key pattern; clause
  references (e.g. "Article 10") cannot satisfy it.
- Thresholds are a nested model so extra="forbid" catches severity-level typos.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Shared Literal enums
# ---------------------------------------------------------------------------

MetricFormula = Literal[
    # Fairness / bias
    "demographic_parity_ratio",
    "equalized_odds_ratio",
    "predictive_parity_ratio",
    "calibration_score",
    "counterfactual_fairness_rate",
    "individual_fairness_score",
    # Drift
    "concept_drift_psi",
    "data_drift_ks_statistic",
    "feature_importance_stability",
    # Robustness / misuse
    "adversarial_robustness_rate",
    "prompt_injection_resistance_rate",
    "jailbreak_resistance_rate",
    "output_toxicity_rate",
    "pii_leakage_rate",
    # Accuracy / faithfulness
    "hallucination_rate",
    "faithfulness_score",
    "context_precision_score",
    # Explainability
    "explanation_fidelity_score",
    "shap_consistency_score",
    "lime_agreement_rate",
    # Composite / compliance
    "composite_risk_score",
    "regulatory_compliance_score",
    "purpose_limitation_adherence_rate",
    "data_minimisation_score",
]

AgentOwner = Literal[
    "bias_auditor",
    "drift_analyst",
    "misuse_detector",
    "compliance_mapper",
    "explainability_agent",
    "risk_scorer",
]

SeverityLevel = Literal["critical", "high", "medium", "low"]

CriticalBlockerCondition = Literal[
    "score_below_threshold",
    "prohibited_use_case_detected",
    "pii_exposure_detected",
    "adversarial_manipulation_confirmed",
    "audit_trail_integrity_failure",
    "data_provenance_unverifiable",
    "bias_exceeds_hard_limit",
    "toxicity_exceeds_hard_limit",
]

# Abstract requirement key pattern — e.g. REQ_BIAS_001, TRANSPARENCY_REQ_007.
# Positively rejects clause-style strings like "Article 10".
_ABSTRACT_KEY_PATTERN = r"^[A-Z][A-Z0-9_]+$"

# Metric ID pattern — e.g. B-1, A-12, DR-3
_METRIC_ID_PATTERN = r"^[A-Z]+-\d+$"


# ---------------------------------------------------------------------------
# Shared sub-models
# ---------------------------------------------------------------------------


class SeverityThresholds(BaseModel):
    """Numeric gate per severity level for one framework.

    All four levels are optional so a metric may only define thresholds for
    the severities it actually uses, but no other keys are accepted.
    """

    model_config = ConfigDict(extra="forbid")

    critical: float | None = None
    high: float | None = None
    medium: float | None = None
    low: float | None = None


class CriticalBlocker(BaseModel):
    """A hard gate: if this condition is met the metric result is FAIL regardless of score.

    condition_key must be a registered evaluator name — never a free expression.
    threshold is the numeric parameter passed to that evaluator; None for boolean conditions.
    """

    model_config = ConfigDict(extra="forbid")

    condition_key: CriticalBlockerCondition
    threshold: float | None = None
    description: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# MetricConfig
# ---------------------------------------------------------------------------


class MetricConfig(BaseModel):
    """Validates a single metric definition YAML file.

    framework_mapping contains only abstract requirement keys — concrete clause
    references belong exclusively in FrameworkConfig.requirement_mapping.
    """

    model_config = ConfigDict(extra="forbid")

    metric_id: str = Field(pattern=_METRIC_ID_PATTERN)
    dimension: str = Field(min_length=1)
    formula: MetricFormula
    thresholds: dict[str, SeverityThresholds]
    tool: str = Field(min_length=1)
    secondary_tool: str | None = None
    agent_owner: AgentOwner
    framework_mapping: list[Annotated[str, Field(pattern=_ABSTRACT_KEY_PATTERN)]] = Field(
        min_length=1
    )
    evidence_required: list[str] = Field(min_length=1)
    critical_blockers: list[CriticalBlocker] = Field(default_factory=list)

    @field_validator("thresholds")
    @classmethod
    def thresholds_must_not_be_empty(
        cls,
        value: dict[str, SeverityThresholds],
    ) -> dict[str, SeverityThresholds]:
        if not value:
            raise ValueError("thresholds must define at least one framework entry")
        return value


# ---------------------------------------------------------------------------
# FrameworkConfig sub-models
# ---------------------------------------------------------------------------


class RegulationChunk(BaseModel):
    """A single extracted chunk of regulatory text for RAG / agent grounding."""

    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)


class AgentInstructionSet(BaseModel):
    """Per-agent, per-framework behavioural instructions."""

    model_config = ConfigDict(extra="forbid")

    focus: str = Field(min_length=1)
    methodology: list[str] = Field(min_length=1)
    output_format: str = Field(min_length=1)


class SeverityRubric(BaseModel):
    """Scoring criteria for a single severity level."""

    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1)
    score_range: tuple[float, float]

    @model_validator(mode="after")
    def validate_range_order(self) -> SeverityRubric:
        lo, hi = self.score_range
        if lo >= hi:
            raise ValueError(
                f"score_range min ({lo}) must be strictly less than max ({hi})"
            )
        return self


class ProbeTemplate(BaseModel):
    """A framework-specific probe template for the misuse detector."""

    model_config = ConfigDict(extra="forbid")

    probe_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    template: str = Field(min_length=1)
    variables: list[str] = Field(default_factory=list)


class CitationFormat(BaseModel):
    """How this framework's findings should be cited in reports."""

    model_config = ConfigDict(extra="forbid")

    template: str = Field(min_length=1)
    regulation_name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class SeverityTimeline(BaseModel):
    """Remediation SLA and escalation policy per severity level."""

    model_config = ConfigDict(extra="forbid")

    remediation_days: int = Field(ge=0)
    escalation_required: bool


# ---------------------------------------------------------------------------
# FrameworkConfig
# ---------------------------------------------------------------------------


class FrameworkConfig(BaseModel):
    """Validates a whole regulation YAML file.

    requirement_mapping resolves abstract keys (from MetricConfig.framework_mapping)
    to concrete regulatory clauses.  This file is the ONLY place clause references
    may appear.
    """

    model_config = ConfigDict(extra="forbid")

    framework_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    version: str = Field(min_length=1)

    regulation_text: list[RegulationChunk] = Field(min_length=1)
    agent_instructions: dict[str, AgentInstructionSet]
    evaluation_rubrics: dict[str, SeverityRubric]
    probe_library_extensions: list[ProbeTemplate] = Field(default_factory=list)
    citation_format: CitationFormat
    severity_thresholds: dict[str, SeverityTimeline]

    # Abstract key → concrete clause.  Keys must follow abstract-key pattern.
    requirement_mapping: dict[
        Annotated[str, Field(pattern=_ABSTRACT_KEY_PATTERN)], str
    ]

    @field_validator("agent_instructions")
    @classmethod
    def validate_agent_keys(
        cls,
        value: dict[str, AgentInstructionSet],
    ) -> dict[str, AgentInstructionSet]:
        valid_agents = set(AgentOwner.__args__)  # type: ignore[attr-defined]
        unknown = set(value.keys()) - valid_agents
        if unknown:
            raise ValueError(
                f"Unknown agent keys in agent_instructions: {sorted(unknown)}. "
                f"Must be one of: {sorted(valid_agents)}"
            )
        return value

    @field_validator("evaluation_rubrics", "severity_thresholds")
    @classmethod
    def validate_severity_keys(cls, value: dict[str, object]) -> dict[str, object]:
        valid_severities = set(SeverityLevel.__args__)  # type: ignore[attr-defined]
        unknown = set(value.keys()) - valid_severities
        if unknown:
            raise ValueError(
                f"Unknown severity keys: {sorted(unknown)}. "
                f"Must be one of: {sorted(valid_severities)}"
            )
        return value

    @field_validator("requirement_mapping")
    @classmethod
    def requirement_mapping_must_not_be_empty(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("requirement_mapping must contain at least one entry")
        return value
