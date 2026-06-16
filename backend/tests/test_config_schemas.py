"""
Tests for MetricConfig and FrameworkConfig schemas, loader, and fixtures.

Coverage:
- Valid metric config loads and round-trips correctly.
- Valid EU AI Act framework config loads and round-trips correctly.
- Each category of invalid config fails for the EXPECTED reason.

Invalid-config categories tested:
  M1 — missing required field (metric_id absent)
  M2 — bad enum value (formula not in registered list)
  M3 — unknown extra field (extra="forbid")
  M4 — framework_mapping contains a clause reference (fails abstract-key pattern)
  M5 — critical_blocker condition_key not in registered list
  F1 — missing required field (framework_id absent)
  F2 — unknown agent key in agent_instructions
  F3 — unknown extra field on a nested model
  F4 — score_range min ≥ max (cross-field constraint)
  F5 — requirement_mapping key contains a clause reference (fails abstract-key pattern)
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest
import yaml

from app.configs.config_loader import ConfigLoadError, load_framework_config, load_metric_config
from app.configs.config_models import (
    AgentOwner,
    CriticalBlockerCondition,
    FrameworkConfig,
    MetricConfig,
    MetricFormula,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Helper: load a YAML string as a tmp file and invoke the loader
# ---------------------------------------------------------------------------


def _write_and_load_metric(tmp_path: Path, yaml_text: str) -> MetricConfig:
    p = tmp_path / "metric.yaml"
    p.write_text(textwrap.dedent(yaml_text), encoding="utf-8")
    return load_metric_config(p)


def _write_and_load_framework(tmp_path: Path, yaml_text: str) -> FrameworkConfig:
    p = tmp_path / "framework.yaml"
    p.write_text(textwrap.dedent(yaml_text), encoding="utf-8")
    return load_framework_config(p)


# ---------------------------------------------------------------------------
# Valid configs
# ---------------------------------------------------------------------------


class TestValidMetricConfig:
    def test_loads_without_error(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert isinstance(result, MetricConfig)

    def test_field_values_round_trip(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert result.metric_id == "B-1"
        assert result.dimension == "fairness"
        assert result.formula == "demographic_parity_ratio"
        assert result.agent_owner == "bias_auditor"
        assert result.secondary_tool == "aif360_metrics"

    def test_thresholds_shape(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert "eu_ai_act" in result.thresholds
        assert result.thresholds["eu_ai_act"].critical == 0.6
        assert result.thresholds["eu_ai_act"].low == 0.9

    def test_critical_blockers_parsed(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert len(result.critical_blockers) == 2
        assert result.critical_blockers[0].condition_key == "bias_exceeds_hard_limit"
        assert result.critical_blockers[0].threshold == 0.5
        assert result.critical_blockers[1].threshold is None

    def test_framework_mapping_abstract_keys(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert "REQ_BIAS_001" in result.framework_mapping
        assert "REQ_NON_DISCRIMINATION_002" in result.framework_mapping

    def test_evidence_required_non_empty(self) -> None:
        result = load_metric_config(FIXTURES_DIR / "valid_metric.yaml")
        assert len(result.evidence_required) >= 1


class TestValidFrameworkConfig:
    def test_loads_without_error(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        assert isinstance(result, FrameworkConfig)

    def test_top_level_fields(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        assert result.framework_id == "eu_ai_act"
        assert result.display_name == "EU Artificial Intelligence Act"
        assert result.version == "2024-08"

    def test_all_six_agents_present(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        expected_agents = set(AgentOwner.__args__)  # type: ignore[attr-defined]
        assert set(result.agent_instructions.keys()) == expected_agents

    def test_all_four_severity_levels_in_rubrics(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        assert set(result.evaluation_rubrics.keys()) == {"critical", "high", "medium", "low"}

    def test_score_range_ordering(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        for level, rubric in result.evaluation_rubrics.items():
            lo, hi = rubric.score_range
            assert lo < hi, f"score_range for '{level}' is not ordered: {lo} >= {hi}"

    def test_requirement_mapping_abstract_keys_only(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        for key in result.requirement_mapping:
            assert key.isupper() or "_" in key, f"Suspicious key that may be a clause ref: {key!r}"
        # Verify no key looks like a clause reference
        assert not any("Article" in k for k in result.requirement_mapping)

    def test_severity_thresholds_remediation_days(self) -> None:
        result = load_framework_config(FIXTURES_DIR / "valid_framework_eu_ai_act.yaml")
        assert result.severity_thresholds["critical"].remediation_days == 0
        assert result.severity_thresholds["critical"].escalation_required is True
        assert result.severity_thresholds["low"].remediation_days == 90


# ---------------------------------------------------------------------------
# Invalid metric configs
# ---------------------------------------------------------------------------


class TestInvalidMetricConfigs:
    def test_M1_missing_required_field_metric_id(self, tmp_path: Path) -> None:
        """metric_id is required; omitting it must raise ConfigLoadError."""
        yaml_text = """\
            dimension: "fairness"
            formula: "demographic_parity_ratio"
            thresholds:
              eu_ai_act:
                critical: 0.6
            tool: "fairlearn_metrics"
            agent_owner: "bias_auditor"
            framework_mapping:
              - "REQ_BIAS_001"
            evidence_required:
              - "confusion_matrix"
        """
        with pytest.raises(ConfigLoadError) as exc_info:
            _write_and_load_metric(tmp_path, yaml_text)
        assert "metric_id" in str(exc_info.value).lower() or "required" in str(exc_info.value).lower()

    def test_M2_bad_formula_enum_value(self, tmp_path: Path) -> None:
        """formula must be in the registered Literal list; free text must be rejected."""
        yaml_text = """\
            metric_id: "B-1"
            dimension: "fairness"
            formula: "lambda x: x > 0.5"
            thresholds:
              eu_ai_act:
                critical: 0.6
            tool: "fairlearn_metrics"
            agent_owner: "bias_auditor"
            framework_mapping:
              - "REQ_BIAS_001"
            evidence_required:
              - "confusion_matrix"
        """
        with pytest.raises(ConfigLoadError) as exc_info:
            _write_and_load_metric(tmp_path, yaml_text)
        error_text = str(exc_info.value)
        assert "formula" in error_text or "enum" in error_text or "valid" in error_text.lower()

    def test_M3_unknown_extra_field(self, tmp_path: Path) -> None:
        """An unrecognised top-level field must be rejected (extra='forbid')."""
        yaml_text = """\
            metric_id: "B-1"
            dimension: "fairness"
            formula: "demographic_parity_ratio"
            thresholds:
              eu_ai_act:
                critical: 0.6
            tool: "fairlearn_metrics"
            agent_owner: "bias_auditor"
            framework_mapping:
              - "REQ_BIAS_001"
            evidence_required:
              - "confusion_matrix"
            regulatory_clause: "Article 10"
        """
        with pytest.raises(ConfigLoadError) as exc_info:
            _write_and_load_metric(tmp_path, yaml_text)
        error_text = str(exc_info.value).lower()
        assert "regulatory_clause" in error_text or "additional" in error_text or "extra" in error_text

    def test_M4_framework_mapping_contains_clause_reference(self, tmp_path: Path) -> None:
        """framework_mapping items must match abstract-key pattern; clause refs must fail."""
        yaml_text = """\
            metric_id: "B-1"
            dimension: "fairness"
            formula: "demographic_parity_ratio"
            thresholds:
              eu_ai_act:
                critical: 0.6
            tool: "fairlearn_metrics"
            agent_owner: "bias_auditor"
            framework_mapping:
              - "Article 10, Paragraph 2"
            evidence_required:
              - "confusion_matrix"
        """
        with pytest.raises(ConfigLoadError):
            _write_and_load_metric(tmp_path, yaml_text)

    def test_M5_unknown_critical_blocker_condition_key(self, tmp_path: Path) -> None:
        """condition_key must be a registered evaluator name; unknown names must fail."""
        yaml_text = """\
            metric_id: "B-1"
            dimension: "fairness"
            formula: "demographic_parity_ratio"
            thresholds:
              eu_ai_act:
                critical: 0.6
            tool: "fairlearn_metrics"
            agent_owner: "bias_auditor"
            framework_mapping:
              - "REQ_BIAS_001"
            evidence_required:
              - "confusion_matrix"
            critical_blockers:
              - condition_key: "score < 0.5"
                description: "arbitrary expression"
        """
        with pytest.raises(ConfigLoadError):
            _write_and_load_metric(tmp_path, yaml_text)


# ---------------------------------------------------------------------------
# Invalid framework configs
# ---------------------------------------------------------------------------


# Minimal valid framework YAML reused across F* tests.  Individual tests
# override or remove specific fields by manipulating the parsed dict directly
# and writing it back, avoiding large YAML duplication.

_MINIMAL_FRAMEWORK: dict = {
    "framework_id": "test_fw",
    "display_name": "Test Framework",
    "version": "1.0",
    "regulation_text": [
        {"chunk_id": "C-001", "title": "Test", "content": "Test content."}
    ],
    "agent_instructions": {
        agent: {
            "focus": f"Focus for {agent}.",
            "methodology": ["Step 1."],
            "output_format": "structured_finding",
        }
        for agent in AgentOwner.__args__  # type: ignore[attr-defined]
    },
    "evaluation_rubrics": {
        "critical": {"description": "Critical.", "score_range": [0.0, 0.4]},
        "high": {"description": "High.", "score_range": [0.4, 0.6]},
        "medium": {"description": "Medium.", "score_range": [0.6, 0.75]},
        "low": {"description": "Low.", "score_range": [0.75, 1.0]},
    },
    "citation_format": {
        "template": "{regulation_name}, Article {article}",
        "regulation_name": "Test Regulation",
        "version": "1.0",
    },
    "severity_thresholds": {
        "critical": {"remediation_days": 0, "escalation_required": True},
        "high": {"remediation_days": 7, "escalation_required": True},
        "medium": {"remediation_days": 30, "escalation_required": False},
        "low": {"remediation_days": 90, "escalation_required": False},
    },
    "requirement_mapping": {"REQ_TEST_001": "Article 1, Section 1"},
}


def _write_framework_dict(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "framework.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


class TestInvalidFrameworkConfigs:
    def test_F1_missing_required_field_framework_id(self, tmp_path: Path) -> None:
        """framework_id is required; omitting it must raise ConfigLoadError."""
        data = {k: v for k, v in _MINIMAL_FRAMEWORK.items() if k != "framework_id"}
        with pytest.raises(ConfigLoadError) as exc_info:
            load_framework_config(_write_framework_dict(tmp_path, data))
        assert "framework_id" in str(exc_info.value).lower() or "required" in str(exc_info.value).lower()

    def test_F2_unknown_agent_key_in_agent_instructions(self, tmp_path: Path) -> None:
        """agent_instructions keys must be valid AgentOwner values."""
        import copy
        data = copy.deepcopy(_MINIMAL_FRAMEWORK)
        data["agent_instructions"]["unknown_agent"] = {
            "focus": "Rogue agent.",
            "methodology": ["Do something."],
            "output_format": "structured_finding",
        }
        with pytest.raises(ConfigLoadError) as exc_info:
            load_framework_config(_write_framework_dict(tmp_path, data))
        assert "unknown_agent" in str(exc_info.value) or "unknown" in str(exc_info.value).lower()

    def test_F3_unknown_extra_field_on_nested_model(self, tmp_path: Path) -> None:
        """Extra fields on a nested model (CitationFormat) must be rejected."""
        import copy
        data = copy.deepcopy(_MINIMAL_FRAMEWORK)
        data["citation_format"]["undocumented_field"] = "surprise"
        with pytest.raises(ConfigLoadError) as exc_info:
            load_framework_config(_write_framework_dict(tmp_path, data))
        error_text = str(exc_info.value).lower()
        assert "undocumented_field" in error_text or "additional" in error_text or "extra" in error_text

    def test_F4_score_range_min_not_less_than_max(self, tmp_path: Path) -> None:
        """score_range[0] must be strictly less than score_range[1]."""
        import copy
        data = copy.deepcopy(_MINIMAL_FRAMEWORK)
        data["evaluation_rubrics"]["critical"]["score_range"] = [0.5, 0.3]
        with pytest.raises(ConfigLoadError) as exc_info:
            load_framework_config(_write_framework_dict(tmp_path, data))
        assert "score_range" in str(exc_info.value).lower() or "less than" in str(exc_info.value).lower()

    def test_F5_requirement_mapping_key_is_clause_reference(self, tmp_path: Path) -> None:
        """requirement_mapping keys must follow abstract-key pattern; clause refs must fail."""
        import copy
        data = copy.deepcopy(_MINIMAL_FRAMEWORK)
        data["requirement_mapping"]["Article 10"] = "Something"
        with pytest.raises(ConfigLoadError):
            load_framework_config(_write_framework_dict(tmp_path, data))


# ---------------------------------------------------------------------------
# Enum completeness checks (fast, no I/O)
# ---------------------------------------------------------------------------


class TestEnumCompleteness:
    def test_metric_formula_has_entries(self) -> None:
        assert len(MetricFormula.__args__) >= 1  # type: ignore[attr-defined]

    def test_critical_blocker_conditions_has_entries(self) -> None:
        assert len(CriticalBlockerCondition.__args__) >= 1  # type: ignore[attr-defined]

    def test_agent_owner_has_exactly_six_entries(self) -> None:
        assert len(AgentOwner.__args__) == 6  # type: ignore[attr-defined]

    def test_agent_owner_contains_expected_specialists(self) -> None:
        specialists = set(AgentOwner.__args__)  # type: ignore[attr-defined]
        expected = {
            "bias_auditor",
            "drift_analyst",
            "misuse_detector",
            "compliance_mapper",
            "explainability_agent",
            "risk_scorer",
        }
        assert specialists == expected
