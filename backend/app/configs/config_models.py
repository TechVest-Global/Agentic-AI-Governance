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
    # Task Fulfilment / Instruction Following (CM-001 to CM-004)
    "task_success_rate",
    "instruction_following_pass_rate",
    "schema_format_adherence_rate",
    "action_completion_rate",
    # Groundedness / Hallucination Control (CM-005 to CM-008)
    "hallucination_rate",
    "faithfulness_score",
    "citation_coverage_rate",
    "unsupported_claim_rate",
    # Retrieval Quality (CM-009 to CM-012)
    "context_recall_at_k",
    "context_precision",
    "answer_relevancy",
    "retrieved_asset_fidelity",
    # Safety Policy Violation (CM-013 to CM-016)
    "policy_violation_rate",
    "toxicity_score",
    "refusal_f1_score",
    "unsafe_completion_rate",
    # Fairness / Bias / Representational Harm (CM-017 to CM-021)
    "disparate_failure_rate",
    "toxicity_disparity",
    "sentiment_disparity",
    "representational_harm_rate",
    "stereotyping_rate",
    # Privacy / Data Leakage / Memorization (CM-022 to CM-025)
    "pii_leakage_rate",
    "secret_leakage_rate",
    "memorization_extraction_rate",
    "redaction_failure_rate",
    # Security / Prompt Injection / Jailbreak (CM-026 to CM-029)
    "jailbreak_success_rate",
    "prompt_injection_success_rate",
    "data_exfiltration_success_rate",
    "unsafe_tool_call_rate",
    # Robustness / Consistency (CM-030 to CM-034)
    "regression_rate_under_perturbation",
    "consistency_score",
    "identity_style_drift",
    "temporal_consistency",
    "asr_robustness",
    # Transparency / Provenance / Traceability (CM-035 to CM-039)
    "citation_correctness",
    "confidence_calibration",
    "provenance_detection_rate",
    "explanation_usefulness",
    "trace_completeness",
    # Human Oversight / Escalation Effectiveness (CM-040 to CM-044)
    "escalation_f1_score",
    "human_override_rate",
    "false_refusal_rate",
    "uncertainty_calibration",
    "review_queue_hit_rate",
    # Generated-media safety (CM-045+). The vision evaluator has judged images
    # since it was written, but no formula named its output, so no metric could
    # declare it and the whole image path was unreachable from a config.
    "visual_content_safety_rate",
]

AgentOwner = Literal[
    "quality_evaluator",
    "bias_auditor",
    "drift_analyst",
    "misuse_detector",
    "compliance_mapper",
    "explainability_agent",
    "risk_scorer",
]

SeverityLevel = Literal["critical", "high", "medium", "low"]

# Mirrors app.models.enums.CapabilityType — kept as a separate literal here
# (rather than importing the SQLModel enum) so the config-loading package has
# no dependency on the DB layer.
CapabilityTypeLiteral = Literal[
    "inference", "retrieval", "generation", "action", "integration", "other"
]

ModalityLiteral = Literal["text", "audio", "video", "image"]

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
    # Empty (the default) means universally applicable — most metrics apply to
    # every system regardless of capability/modality. Only set these when a
    # metric is structurally meaningless for systems lacking that capability
    # (e.g. retrieval-quality metrics) or modality (e.g. an ASR-specific check).
    applicable_capability_types: list[CapabilityTypeLiteral] = Field(default_factory=list)
    applicable_modalities: list[ModalityLiteral] = Field(default_factory=list)

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
