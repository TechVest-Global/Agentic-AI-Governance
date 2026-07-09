"""Deterministic per-system production-log synthesizer (Layer 1 seed).

Real deployments feed the context assembler a stream of production/staging logs.
In this prototype most runs are started from the UI with no logs attached, so
Context Assembly saw ``total_requests: 0`` and every coverage-gap check tripped
the ``empty`` branch — producing the *same* "everything missing" gap set on every
run. Downstream, the adaptive orchestrator (whose only per-run variable is those
coverage gaps) then allocated an identical probe budget every time and looked
"static".

This module synthesizes a representative log sample **derived from the audited
system itself** so that, when a run supplies no logs, Context Assembly still has
real evidence to analyze and the orchestrator has real, system-specific gaps to
adapt to. The sample is:

- **Deterministic** — seeded from the system id, so the same system always yields
  the same logs (matching the append-only/reproducible invariant in
  ARCHITECTURE.md; no wall-clock, no randomness).
- **Category-aware** — a decisioning/hiring system emits hiring outcomes across
  demographic groups; a RAG assistant emits retrieval Q&A categories; etc. The
  category is resolved via :func:`classify_system`.
- **Deliberately partial** — it covers *most* but not all of the coverage
  vocabulary the frameworks expect (e.g. omits one protected demographic, or
  carries no adversarial samples for a low-risk system), so realistic, *varying*
  gaps surface instead of a uniform "all clear" or "all missing".

Only used as a fallback: an explicit ``logs`` payload (real logs, or a user
upload) always takes precedence.
"""

from __future__ import annotations

from app.models.ai_system import AISystem
from app.models.enums import RiskTier
from app.schemas.governance import ContextLogEntry
from app.services.agents.probe_library import SystemCategory, classify_system

# Framework coverage vocabularies these logs are written against (see
# app/configs/frameworks/*): demographic groups, jurisdictions, and outcomes the
# coverage-gap detector checks observed logs against.
_DEMOGRAPHICS = ("female", "age_over_60", "ethnicity_minority", "disability")
_JURISDICTIONS = ("US", "EU")


def _seed(ai_system: AISystem) -> int:
    """Stable per-system seed (from the UUID) — no wall clock, no randomness."""
    return int(ai_system.id.int % 997)


def _covered_demographics(seed: int) -> list[str]:
    """Cover 3 of the 4 expected demographics, omitting one deterministically.

    The framework requires >= 3 distinct groups, so covering exactly 3 satisfies
    the minimum while the omitted group surfaces as a real, system-specific
    coverage gap — different systems omit different groups.
    """
    omit = seed % len(_DEMOGRAPHICS)
    return [group for idx, group in enumerate(_DEMOGRAPHICS) if idx != omit]


def _is_high_risk(ai_system: AISystem) -> bool:
    return ai_system.risk_tier == RiskTier.high


def _category_profile(ai_system: AISystem) -> tuple[SystemCategory, list[str], list[str]]:
    """Return (category, request_categories, outcomes) for the system's shape."""
    category = classify_system(ai_system.system_type).category
    if category == SystemCategory.DECISIONING:
        return category, ["candidate_screening", "candidate_ranking"], ["advance", "reject"]
    if category == SystemCategory.RAG_ASSISTANT:
        return category, ["knowledge_lookup", "policy_question"], ["answered", "no_answer"]
    if category == SystemCategory.AGENTIC_WORKFLOW:
        return category, ["tool_action", "multi_step_task"], ["completed", "aborted"]
    if category == SystemCategory.GENERATIVE_ASSISTANT:
        return category, ["draft_generation", "summarization"], ["delivered", "refused"]
    return category, ["general_request"], ["handled", "declined"]


def synthesize_logs_for_system(ai_system: AISystem) -> list[ContextLogEntry]:
    """Build a deterministic, category-appropriate production-log sample.

    Returns a list of :class:`ContextLogEntry` records that give the log analyzer
    real evidence and produce realistic, *partial* coverage — so the coverage-gap
    detector and the adaptive orchestrator vary meaningfully per system instead of
    reporting a uniform empty result.
    """
    seed = _seed(ai_system)
    category, request_categories, outcomes = _category_profile(ai_system)
    demographics = _covered_demographics(seed)
    high_risk = _is_high_risk(ai_system)

    entries: list[ContextLogEntry] = []

    # Spread requests across categories, demographics, jurisdictions, and outcomes
    # so every set-membership coverage check has evidence. A decisioning system
    # attaches a demographic group to each record (it decides *about people*);
    # other categories only occasionally carry one.
    attaches_demographics = category == SystemCategory.DECISIONING
    sparse_demographic_counter = 0
    for i in range(12):
        req_category = request_categories[i % len(request_categories)]
        outcome = outcomes[i % len(outcomes)]
        jurisdiction = _JURISDICTIONS[i % len(_JURISDICTIONS)]
        if attaches_demographics:
            demographic = demographics[i % len(demographics)]
        elif i % 3 == 0:
            # Rotate through the covered groups with a dedicated counter.
            # (Indexing by `i` here always landed on demographics[0] — i is a
            # multiple of 3 and the list has 3 entries — so non-decisioning
            # systems reported a single observed group and a misleading
            # "missing coverage" gap for every other group.)
            demographic = demographics[sparse_demographic_counter % len(demographics)]
            sparse_demographic_counter += 1
        else:
            demographic = None
        # Every few records carry PII (satisfies pii_handling coverage).
        contains_pii = attaches_demographics or i % 4 == 0
        entries.append(
            ContextLogEntry(
                request_category=req_category,
                demographic_group=demographic,
                jurisdiction=jurisdiction,
                outcome=outcome,
                modality=ai_system.modality.value if ai_system.modality else "text",
                contains_pii=contains_pii,
                flagged=False,
            )
        )

    # Adversarial/flagged samples: present for high-risk systems (they get red-team
    # traffic), absent for lower-risk ones — so adversarial_coverage is satisfied
    # for some systems and surfaces as a gap for others. This is a primary source
    # of orchestrator variation between systems.
    if high_risk:
        entries.append(
            ContextLogEntry(
                request_category=request_categories[0],
                demographic_group=demographics[0],
                jurisdiction=_JURISDICTIONS[0],
                outcome=outcomes[-1],
                modality=ai_system.modality.value if ai_system.modality else "text",
                contains_pii=True,
                flagged=True,
            )
        )

    return entries
