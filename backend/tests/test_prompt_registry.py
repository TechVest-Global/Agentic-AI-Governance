"""
Tests for the Prompt Template Registry.

Coverage
--------
Valid templates:
  V1 — valid template loads and hash-verifies correctly
  V2 — two textually identical templates produce the same hash
  V3 — one-character text change produces a different hash
  V4 — round-trip: get() → render() with correct variables succeeds
  V5 — from_directory() loads all YAML files from the valid corpus

Invalid templates (each fails for its EXPECTED reason):
  I1 — undeclared variable: placeholder in text not listed in variables
  I2 — hash mismatch: content_hash does not match the text
  I3 — framework text: regulatory clause reference in a structural template
  I4 — unknown field: extra="forbid" rejects an unrecognised key

render() failures:
  R1 — missing variable raises RenderError naming the template and the gap
  R2 — extra variable raises RenderError naming the unexpected key

TemplateLookupError:
  L1 — get() with wrong hash raises TemplateLookupError
  L2 — get() with wrong template_id raises TemplateLookupError
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from app.configs.prompt_registry import (
    PromptRegistry,
    RenderError,
    TemplateLoadError,
    TemplateLookupError,
    render,
)
from app.configs.prompt_template_models import compute_content_hash

# ---------------------------------------------------------------------------
# Paths to pre-built fixture directories
# ---------------------------------------------------------------------------

_CONFIGS_DIR = Path(__file__).resolve().parents[1] / "app" / "configs"
_VALID_CORPUS_DIR = _CONFIGS_DIR / "templates" / "valid"
_FIXTURES_VALID_DIR = _CONFIGS_DIR / "templates" / "fixtures" / "valid"
_FIXTURES_INVALID_DIR = _CONFIGS_DIR / "templates" / "fixtures" / "invalid"


# ---------------------------------------------------------------------------
# Helper: write a template dict to a tmp YAML file and load via from_files()
# ---------------------------------------------------------------------------


def _write_yaml(tmp_path: Path, name: str, data: dict) -> Path:
    path = tmp_path / name
    with path.open("w", encoding="utf-8") as fh:
        yaml.dump(data, fh, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return path


def _valid_template_dict(text: str, variables: list[str] | None = None) -> dict:
    """Build a minimal valid template dict from text, computing the hash."""
    variables = variables if variables is not None else []
    return {
        "template_id": "bias_auditor.probe_design",
        "section": "phase",
        "version": "1",
        "content_hash": compute_content_hash(text),
        "text": text,
        "variables": variables,
        "description": "Test template.",
    }


# ---------------------------------------------------------------------------
# V1 — valid template loads and hash-verifies
# ---------------------------------------------------------------------------


def test_v1_valid_template_loads(tmp_path: Path) -> None:
    text = "Audit {model_name} for bias in {risk_dimension}."
    data = _valid_template_dict(text, ["model_name", "risk_dimension"])
    path = _write_yaml(tmp_path, "valid.yaml", data)
    registry = PromptRegistry.from_files([path])

    tmpl = registry.get("bias_auditor.probe_design", data["content_hash"])
    assert tmpl.template_id == "bias_auditor.probe_design"
    assert tmpl.section == "phase"
    assert tmpl.content_hash == data["content_hash"]
    assert set(tmpl.variables) == {"model_name", "risk_dimension"}


# ---------------------------------------------------------------------------
# V2 — identical text → same hash
# ---------------------------------------------------------------------------


def test_v2_identical_text_same_hash() -> None:
    text = "You are auditing {model_name} for {risk_dimension} risk."
    h1 = compute_content_hash(text)
    h2 = compute_content_hash(text)
    assert h1 == h2, "same text must always produce the same hash"


# ---------------------------------------------------------------------------
# V3 — one-character change → different hash
# ---------------------------------------------------------------------------


def test_v3_single_char_change_different_hash() -> None:
    text_a = "You are auditing {model_name} for bias."
    text_b = "You are auditing {model_name} for biaS."  # capital S
    assert compute_content_hash(text_a) != compute_content_hash(text_b)


# ---------------------------------------------------------------------------
# V4 — round-trip: get() → render() with correct variables
# ---------------------------------------------------------------------------


def test_v4_get_then_render(tmp_path: Path) -> None:
    text = "Evaluate {model_name} on {task_category} tasks with {min_samples} samples."
    variables = ["model_name", "task_category", "min_samples"]
    data = _valid_template_dict(text, variables)
    path = _write_yaml(tmp_path, "rt.yaml", data)

    registry = PromptRegistry.from_files([path])
    tmpl = registry.get("bias_auditor.probe_design", data["content_hash"])
    result = render(tmpl, {"model_name": "GPT-4o", "task_category": "coding", "min_samples": "50"})

    assert result == "Evaluate GPT-4o on coding tasks with 50 samples."


# ---------------------------------------------------------------------------
# V5 — from_directory() loads the entire valid corpus
# ---------------------------------------------------------------------------


def test_v5_from_directory_loads_corpus() -> None:
    registry = PromptRegistry.from_directory(_VALID_CORPUS_DIR)
    # We authored at least 5 valid templates; just verify the registry is non-empty
    assert len(registry._index) >= 5, (
        f"Expected at least 5 templates in valid corpus, found {len(registry._index)}"
    )


# ---------------------------------------------------------------------------
# I1 — undeclared variable raises TemplateLoadError
# ---------------------------------------------------------------------------


def test_i1_undeclared_variable_fails() -> None:
    path = _FIXTURES_INVALID_DIR / "undeclared_variable.yaml"
    assert path.exists(), f"Fixture not found: {path}"
    with pytest.raises(TemplateLoadError) as exc_info:
        PromptRegistry.from_files([path])
    msg = str(exc_info.value)
    assert "undeclared_var" in msg or "placeholder" in msg.lower() or "not declared" in msg.lower()


# ---------------------------------------------------------------------------
# I2 — hash mismatch raises TemplateLoadError
# ---------------------------------------------------------------------------


def test_i2_hash_mismatch_fails() -> None:
    path = _FIXTURES_INVALID_DIR / "hash_mismatch.yaml"
    assert path.exists(), f"Fixture not found: {path}"
    with pytest.raises(TemplateLoadError) as exc_info:
        PromptRegistry.from_files([path])
    msg = str(exc_info.value)
    assert "hash" in msg.lower() or "mismatch" in msg.lower()


# ---------------------------------------------------------------------------
# I3 — framework text (clause reference) raises TemplateLoadError
# ---------------------------------------------------------------------------


def test_i3_framework_text_in_template_fails() -> None:
    path = _FIXTURES_INVALID_DIR / "framework_text_in_template.yaml"
    assert path.exists(), f"Fixture not found: {path}"
    with pytest.raises(TemplateLoadError) as exc_info:
        PromptRegistry.from_files([path])
    msg = str(exc_info.value)
    assert "clause" in msg.lower() or "article" in msg.lower() or "framework" in msg.lower()


# ---------------------------------------------------------------------------
# I4 — unknown field raises TemplateLoadError (extra="forbid")
# ---------------------------------------------------------------------------


def test_i4_unknown_field_fails() -> None:
    path = _FIXTURES_INVALID_DIR / "unknown_field.yaml"
    assert path.exists(), f"Fixture not found: {path}"
    with pytest.raises(TemplateLoadError) as exc_info:
        PromptRegistry.from_files([path])
    msg = str(exc_info.value)
    assert "unknown_field" in msg or "additional" in msg.lower() or "extra" in msg.lower()


# ---------------------------------------------------------------------------
# R1 — missing variable in render() raises RenderError
# ---------------------------------------------------------------------------


def test_r1_render_missing_variable(tmp_path: Path) -> None:
    text = "Audit {model_name} for {risk_dimension}."
    data = _valid_template_dict(text, ["model_name", "risk_dimension"])
    path = _write_yaml(tmp_path, "r1.yaml", data)
    registry = PromptRegistry.from_files([path])
    tmpl = registry.get("bias_auditor.probe_design", data["content_hash"])

    with pytest.raises(RenderError) as exc_info:
        render(tmpl, {"model_name": "GPT-4o"})  # risk_dimension missing
    msg = str(exc_info.value)
    assert "risk_dimension" in msg
    assert "bias_auditor.probe_design" in msg


# ---------------------------------------------------------------------------
# R2 — extra variable in render() raises RenderError
# ---------------------------------------------------------------------------


def test_r2_render_extra_variable(tmp_path: Path) -> None:
    text = "Audit {model_name} for bias."
    data = _valid_template_dict(text, ["model_name"])
    path = _write_yaml(tmp_path, "r2.yaml", data)
    registry = PromptRegistry.from_files([path])
    tmpl = registry.get("bias_auditor.probe_design", data["content_hash"])

    with pytest.raises(RenderError) as exc_info:
        render(tmpl, {"model_name": "GPT-4o", "unexpected_key": "oops"})
    msg = str(exc_info.value)
    assert "unexpected_key" in msg
    assert "bias_auditor.probe_design" in msg


# ---------------------------------------------------------------------------
# L1 — wrong hash raises TemplateLookupError
# ---------------------------------------------------------------------------


def test_l1_wrong_hash_raises_lookup_error(tmp_path: Path) -> None:
    text = "Audit {model_name} only."
    data = _valid_template_dict(text, ["model_name"])
    path = _write_yaml(tmp_path, "l1.yaml", data)
    registry = PromptRegistry.from_files([path])

    wrong_hash = "0" * 64
    with pytest.raises(TemplateLookupError) as exc_info:
        registry.get("bias_auditor.probe_design", wrong_hash)
    msg = str(exc_info.value)
    assert wrong_hash in msg
    assert "bias_auditor.probe_design" in msg


# ---------------------------------------------------------------------------
# L2 — wrong template_id raises TemplateLookupError
# ---------------------------------------------------------------------------


def test_l2_wrong_id_raises_lookup_error(tmp_path: Path) -> None:
    text = "Audit {model_name} only."
    data = _valid_template_dict(text, ["model_name"])
    path = _write_yaml(tmp_path, "l2.yaml", data)
    registry = PromptRegistry.from_files([path])

    with pytest.raises(TemplateLookupError) as exc_info:
        registry.get("nonexistent_agent.some_phase", data["content_hash"])
    msg = str(exc_info.value)
    assert "nonexistent_agent.some_phase" in msg


# ---------------------------------------------------------------------------
# Extra: list_versions returns entries only for known ids
# ---------------------------------------------------------------------------


def test_list_versions_known_and_unknown(tmp_path: Path) -> None:
    text = "Probe {model_name}."
    data = _valid_template_dict(text, ["model_name"])
    path = _write_yaml(tmp_path, "lv.yaml", data)
    registry = PromptRegistry.from_files([path])

    versions = registry.list_versions("bias_auditor.probe_design")
    assert len(versions) == 1
    assert versions[0].content_hash == data["content_hash"]

    assert registry.list_versions("totally.unknown") == []


# ---------------------------------------------------------------------------
# Extra: templates dir missing raises TemplateLoadError
# ---------------------------------------------------------------------------


def test_missing_directory_raises() -> None:
    with pytest.raises(TemplateLoadError) as exc_info:
        PromptRegistry.from_directory("/nonexistent/path/templates")
    assert "does not exist" in str(exc_info.value)
