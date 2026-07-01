"""
Pydantic v2 model for the Prompt Template Registry.

Design principles enforced here:
- extra="forbid" on every model: unknown/misspelled fields raise immediately.
- content_hash is computed from canonical text on load and validated — never
  author-supplied without verification.
- section is Literal["role", "phase", "output_schema"] — §1, §3, §4 only.
  "framework" is not a valid value; §2 lives in FrameworkConfig.
- Variables declared in `variables` must appear in `text` and vice-versa;
  any mismatch raises with a clear message naming the template_id and the
  offending variable(s).
- Canonical normalization for hashing: strip trailing whitespace per line,
  join with "\\n", ensure single trailing "\\n", encode UTF-8, then SHA-256.
  Leading whitespace is preserved so indented output-schema blocks hash correctly.
"""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Literal enums
# ---------------------------------------------------------------------------

TemplateSection = Literal["role", "phase", "output_schema"]

# Agent prefix conventions — must match the six specialists + orchestrator +
# the three council agents that produce governance LLM calls.
_VALID_AGENT_PREFIXES = frozenset(
    {
        "bias_auditor",
        "quality_evaluator",
        "drift_analyst",
        "misuse_detector",
        "compliance_mapper",
        "explainability_agent",
        "risk_scorer",
        "orchestrator",
        "synthesis_agent",
        "devils_advocate_agent",
        "verdict_agent",
    }
)

# template_id format: "{agent_prefix}.{phase_purpose}"
# e.g. "bias_auditor.probe_design" or "synthesis_agent.council_memo"
_TEMPLATE_ID_PATTERN = re.compile(
    r"^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$"
)

# Matches every {placeholder} in template text (single-brace, not escaped {{…}})
_PLACEHOLDER_RE = re.compile(r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})")


# ---------------------------------------------------------------------------
# Canonical normalization + hashing
# ---------------------------------------------------------------------------


def _canonical(text: str) -> str:
    """Normalise text for hashing.

    Rules (in order):
      1. Strip trailing whitespace from every line.
      2. Join lines with "\\n".
      3. Ensure exactly one trailing "\\n".

    Leading whitespace is preserved so indented blocks in output_schema
    templates hash consistently.
    """
    lines = [line.rstrip() for line in text.splitlines()]
    return "\n".join(lines) + "\n"


def compute_content_hash(text: str) -> str:
    """Return the SHA-256 hex digest of the canonical form of text."""
    canonical = _canonical(text)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# PromptTemplate
# ---------------------------------------------------------------------------


class PromptTemplate(BaseModel):
    """A single versioned, immutable prompt slice (§1, §3, or §4).

    Identity is the content_hash, not the template_id or version.
    Two templates with identical text will have the same hash regardless
    of their id or version label.
    """

    model_config = ConfigDict(extra="forbid")

    template_id: str = Field(
        description=(
            'Stable human-readable identifier. Convention: "{agent}.{phase_purpose}". '
            "Agent prefix must be one of the registered agent names."
        ),
    )
    section: TemplateSection = Field(
        description="Which prompt slice: 'role' (§1), 'phase' (§3), or 'output_schema' (§4).",
    )
    version: str = Field(
        min_length=1,
        description=(
            "Human-facing version label (integer string or semver). "
            "NOT the identity — the content_hash is."
        ),
    )
    content_hash: str = Field(
        min_length=64,
        max_length=64,
        description="SHA-256 hex digest of the canonical text. Validated on load.",
    )
    text: str = Field(
        min_length=1,
        description="Parameterised template text. Use {variable_name} for placeholders.",
    )
    variables: list[str] = Field(
        default_factory=list,
        description=(
            "Declared variable names that appear in text. "
            "Every declared variable must appear in text and every {placeholder} "
            "in text must be declared here."
        ),
    )
    description: str = Field(
        min_length=1,
        description="One line describing what this template slice is for.",
    )

    # ------------------------------------------------------------------
    # Field-level validators
    # ------------------------------------------------------------------

    @field_validator("template_id")
    @classmethod
    def validate_template_id(cls, value: str) -> str:
        m = _TEMPLATE_ID_PATTERN.match(value)
        if not m:
            raise ValueError(
                f"template_id '{value}' must follow the pattern "
                "'{agent_prefix}.{phase_purpose}' using lowercase letters, "
                "digits, and underscores only."
            )
        prefix = m.group(1)
        if prefix not in _VALID_AGENT_PREFIXES:
            raise ValueError(
                f"template_id '{value}': unknown agent prefix '{prefix}'. "
                f"Must be one of: {sorted(_VALID_AGENT_PREFIXES)}"
            )
        return value

    @field_validator("variables")
    @classmethod
    def validate_variable_names(cls, value: list[str]) -> list[str]:
        bad = [v for v in value if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", v)]
        if bad:
            raise ValueError(
                f"variables contains invalid names (must be Python identifiers): {bad}"
            )
        if len(value) != len(set(value)):
            dupes = [v for v in value if value.count(v) > 1]
            raise ValueError(f"variables contains duplicates: {sorted(set(dupes))}")
        return value

    # ------------------------------------------------------------------
    # Cross-field validators
    # ------------------------------------------------------------------

    @model_validator(mode="after")
    def validate_hash_matches_text(self) -> PromptTemplate:
        expected = compute_content_hash(self.text)
        if self.content_hash != expected:
            raise ValueError(
                f"template '{self.template_id}': content_hash mismatch. "
                f"Stored hash:   {self.content_hash}\n"
                f"Computed hash: {expected}\n"
                "Re-run the hash utility if you edited the text."
            )
        return self

    @model_validator(mode="after")
    def validate_variable_text_consistency(self) -> PromptTemplate:
        declared = set(self.variables)
        # Find every {placeholder} in text, ignoring {{ and }} escapes
        in_text = set(_PLACEHOLDER_RE.findall(self.text))

        undeclared = in_text - declared
        unused = declared - in_text

        errors: list[str] = []
        if undeclared:
            errors.append(
                f"template '{self.template_id}': placeholder(s) found in text but "
                f"not declared in variables: {sorted(undeclared)}"
            )
        if unused:
            errors.append(
                f"template '{self.template_id}': variable(s) declared but not used "
                f"in text: {sorted(unused)}"
            )
        if errors:
            raise ValueError("\n".join(errors))
        return self
