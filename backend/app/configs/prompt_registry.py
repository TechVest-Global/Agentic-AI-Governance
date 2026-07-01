"""
Prompt Template Registry.

Loads versioned, immutable PromptTemplate YAML files from a templates/ directory
and serves them by (template_id, content_hash).  No "get latest by name" at
runtime — agents always pin the exact hash they were built against.

Seam for four-section prompt assembly
--------------------------------------
This module returns rendered SINGLE SLICES (§1, §3, or §4).  Assembling the
full four-section prompt — inserting §2 from FrameworkConfig.agent_instructions
between §1 and §3 — is the caller's responsibility.  A typical call site looks
like:

    role_text   = render(registry.get("bias_auditor.probe_design", ROLE_HASH),   vars)
    phase_text  = render(registry.get("bias_auditor.probe_design", PHASE_HASH),  vars)
    schema_text = render(registry.get("bias_auditor.probe_design", SCHEMA_HASH), vars)
    framework_instructions = framework_config.agent_instructions["bias_auditor"].focus
    prompt = f"{role_text}\n\n{framework_instructions}\n\n{phase_text}\n\n{schema_text}"

Content-policy guard
--------------------
The registry refuses to load a template whose text contains bare regulatory
clause references (e.g. "Article 10", "Section 4.2").  Those belong exclusively
in FrameworkConfig.requirement_mapping.  This is a belt-and-suspenders check on
top of the Literal section constraint — if a template somehow passes Pydantic
validation but contains clause prose, load fails loudly.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import NamedTuple

import jsonschema
import yaml
from pydantic import ValidationError

from app.configs.prompt_template_models import PromptTemplate

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).resolve().parent
_SCHEMA_PATH = _HERE / "schemas" / "prompt_template.schema.json"
_DEFAULT_TEMPLATES_DIR = _HERE / "templates" / "valid"

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class TemplateLoadError(Exception):
    """Raised when a template file fails to load, validate, or parse.

    Attributes:
        template_path: Path to the offending file.
        detail:        Human-readable explanation of the failure.
    """

    def __init__(self, template_path: Path, detail: str) -> None:
        self.template_path = template_path
        self.detail = detail
        super().__init__(f"Template load failed for '{template_path}': {detail}")


class TemplateLookupError(KeyError):
    """Raised when get() cannot find (template_id, content_hash) in the index."""

    def __init__(self, template_id: str, content_hash: str) -> None:
        self.template_id = template_id
        self.content_hash = content_hash
        super().__init__(
            f"No template found for id='{template_id}', hash='{content_hash}'. "
            "Check that the template file is present in the templates directory "
            "and that the hash matches the text exactly."
        )


class RenderError(ValueError):
    """Raised when render() encounters missing or extra variables."""

    def __init__(self, template_id: str, detail: str) -> None:
        self.template_id = template_id
        self.detail = detail
        super().__init__(f"Render failed for template '{template_id}': {detail}")


# ---------------------------------------------------------------------------
# Content-policy guard
# ---------------------------------------------------------------------------

# Matches bare regulatory clause references that belong in FrameworkConfig, not
# in a structural prompt slice.  Examples: "Article 10", "Section 4.2", "Clause 7".
_CLAUSE_RE = re.compile(
    r"\b(article|section|clause|recital|annex|appendix)\s+\d+",
    re.IGNORECASE,
)


def _check_no_framework_text(template: PromptTemplate, path: Path) -> None:
    matches = _CLAUSE_RE.findall(template.text)
    if matches:
        raise TemplateLoadError(
            path,
            f"template '{template.template_id}' contains regulatory clause reference(s) "
            f"({matches!r}) — these belong in FrameworkConfig.requirement_mapping, "
            "not in a structural prompt template.",
        )


# ---------------------------------------------------------------------------
# Version summary (for list_versions)
# ---------------------------------------------------------------------------


class TemplateSummary(NamedTuple):
    version: str
    content_hash: str
    description: str
    section: str


# ---------------------------------------------------------------------------
# PromptRegistry
# ---------------------------------------------------------------------------


class PromptRegistry:
    """Indexes PromptTemplate instances by (template_id, content_hash).

    Usage::

        registry = PromptRegistry.from_directory("backend/app/configs/templates/valid")
        tmpl = registry.get("bias_auditor.probe_design", "<sha256>")
        text = render(tmpl, {"model_name": "GPT-4o", ...})

    The registry is immutable after construction.  Re-instantiate to pick up
    new template files.
    """

    def __init__(self, templates: list[PromptTemplate]) -> None:
        # Primary index: (template_id, content_hash) → PromptTemplate
        self._index: dict[tuple[str, str], PromptTemplate] = {}
        # Secondary index: template_id → list[TemplateSummary] (all versions)
        self._by_id: dict[str, list[TemplateSummary]] = {}

        for tmpl in templates:
            key = (tmpl.template_id, tmpl.content_hash)
            if key in self._index:
                existing = self._index[key]
                if existing.version != tmpl.version:
                    # Same hash, different version label — harmless but suspicious.
                    # The hash is identity; treat them as the same template.
                    pass
            else:
                self._index[key] = tmpl
                self._by_id.setdefault(tmpl.template_id, []).append(
                    TemplateSummary(
                        version=tmpl.version,
                        content_hash=tmpl.content_hash,
                        description=tmpl.description,
                        section=tmpl.section,
                    )
                )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, template_id: str, content_hash: str) -> PromptTemplate:
        """Fetch a template by its exact (id, hash) pair.

        Args:
            template_id:  e.g. "bias_auditor.probe_design"
            content_hash: SHA-256 hex digest of the canonical text.

        Returns:
            The matching PromptTemplate.

        Raises:
            TemplateLookupError: If no template matches the exact (id, hash).
        """
        try:
            return self._index[(template_id, content_hash)]
        except KeyError:
            raise TemplateLookupError(template_id, content_hash) from None

    def list_versions(self, template_id: str) -> list[TemplateSummary]:
        """Return all known versions of a template, for human inspection only.

        This method is for tooling and debugging — never use it at runtime
        to auto-select a template, as that breaks reproducibility.

        Args:
            template_id: e.g. "bias_auditor.probe_design"

        Returns:
            List of TemplateSummary namedtuples (version, content_hash,
            description, section).  Empty list if id is unknown.
        """
        return list(self._by_id.get(template_id, []))

    # ------------------------------------------------------------------
    # Constructors
    # ------------------------------------------------------------------

    @classmethod
    def from_directory(cls, directory: str | Path | None = None) -> PromptRegistry:
        """Load all *.yaml template files from a directory.

        Args:
            directory: Path to a directory of template YAML files.
                       Defaults to backend/app/configs/templates/valid.

        Returns:
            A fully validated PromptRegistry.

        Raises:
            TemplateLoadError: If any file in the directory fails validation.
        """
        templates_dir = Path(directory) if directory is not None else _DEFAULT_TEMPLATES_DIR
        if not templates_dir.exists():
            raise TemplateLoadError(
                templates_dir,
                "templates directory does not exist",
            )

        schema = _load_json_schema(_SCHEMA_PATH)
        templates: list[PromptTemplate] = []

        for path in sorted(templates_dir.rglob("*.yaml")):
            tmpl = _load_template(path, schema)
            templates.append(tmpl)

        return cls(templates)

    @classmethod
    def from_files(cls, paths: list[str | Path]) -> PromptRegistry:
        """Load a specific list of template files.

        Useful for test fixtures or when loading individual templates by path.
        """
        schema = _load_json_schema(_SCHEMA_PATH)
        templates = [_load_template(Path(p), schema) for p in paths]
        return cls(templates)


# ---------------------------------------------------------------------------
# Internal loader helpers
# ---------------------------------------------------------------------------


def _load_json_schema(schema_path: Path) -> dict:
    if not schema_path.exists():
        raise TemplateLoadError(
            schema_path,
            "JSON Schema file not found — run "
            "`python backend/scripts/generate_prompt_schemas.py` to regenerate it",
        )
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _load_template(path: Path, schema: dict) -> PromptTemplate:
    """Full pipeline: YAML parse → JSON Schema → Pydantic → content policy."""
    if not path.exists():
        raise TemplateLoadError(path, "file not found")

    try:
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        raise TemplateLoadError(path, f"YAML parse error — {exc}") from exc

    if not isinstance(data, dict):
        raise TemplateLoadError(path, "expected a YAML mapping at the top level")

    # JSON Schema validation first — catches unknown fields and type errors with
    # readable messages before Pydantic sees the data.
    validator_cls = jsonschema.validators.validator_for(schema)
    validator = validator_cls(schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        messages = []
        for err in errors:
            location = " -> ".join(str(p) for p in err.absolute_path) or "<root>"
            messages.append(f"  [{location}] {err.message}")
        raise TemplateLoadError(
            path,
            "JSON Schema validation failed:\n" + "\n".join(messages),
        )

    # Pydantic validation — catches cross-field constraints (hash match,
    # variable/text consistency) that JSON Schema cannot express.
    try:
        tmpl = PromptTemplate.model_validate(data)
    except ValidationError as exc:
        messages = [
            f"  [{' -> '.join(str(loc) for loc in error['loc'])}] {error['msg']}"
            for error in exc.errors()
        ]
        raise TemplateLoadError(
            path,
            "Pydantic validation failed:\n" + "\n".join(messages),
        ) from exc

    # Content-policy guard: no §2 regulatory prose in structural slices.
    _check_no_framework_text(tmpl, path)

    return tmpl


# ---------------------------------------------------------------------------
# render()
# ---------------------------------------------------------------------------

# Matches every {placeholder} in template text (not {{ or }})
_PLACEHOLDER_RE = re.compile(r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})")


def render(template: PromptTemplate, variables: dict[str, str]) -> str:
    """Fill a template's declared variables and return the rendered text slice.

    This renders ONE section slice (§1, §3, or §4).  Assembling the full
    four-section prompt is the caller's responsibility (see module docstring).

    Args:
        template:  A PromptTemplate fetched from the registry.
        variables: A dict mapping each declared variable name to its value.
                   All declared variables must be supplied; no extra keys allowed.

    Returns:
        The rendered text with all {placeholder}s replaced.

    Raises:
        RenderError: If any declared variable is missing or any extra key is
                     supplied that is not in template.variables.
    """
    declared = set(template.variables)
    supplied = set(variables.keys())

    missing = declared - supplied
    extra = supplied - declared

    errors: list[str] = []
    if missing:
        errors.append(f"missing variable(s): {sorted(missing)}")
    if extra:
        errors.append(f"unexpected variable(s) not declared in template: {sorted(extra)}")

    if errors:
        raise RenderError(template.template_id, "; ".join(errors))

    # Use format_map so undeclared {placeholders} that somehow slipped through
    # raise a KeyError rather than silently remaining in the output.
    # (The Pydantic validator guarantees this can't happen, but belt-and-suspenders.)
    try:
        return template.text.format_map(variables)
    except KeyError as exc:
        raise RenderError(
            template.template_id,
            f"placeholder {exc} in text is not in variables dict — "
            "this is a bug in the template validator",
        ) from exc
