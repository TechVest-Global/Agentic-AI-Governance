"""Registry facts for coverage-gap detection (Layer 1).

Coverage requirements used to be evaluated against submitted logs only, so every
gap this layer could raise meant the same thing: *we have no observational
evidence about X*. That leaves the other half of an audit unexamined. The AI
Registry already holds what the system was **declared** to be — its context
profile (FR-005/FR-006), its capabilities, their side-effect levels and whether
they require human review — and a governance-relevant deficiency in a
declaration is findable with no probing at all.

A capability that writes or destroys data while ``requires_human_review`` is
false is a Risk Controls gap whether or not a single log line was submitted.

This module reduces the registry rows to the flat, comparable facts the
detector needs. It is deterministic: same rows in, same facts out, capability
lists sorted by name so the assembled context stays hash-stable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlmodel import Session, select

from app.models.ai_system import (
    AISystem,
    AISystemCapability,
    ApplicationContextProfile,
    RetrievalContextDocument,
)
from app.models.enums import SideEffectLevel

# The five named areas FR-006 requires an ApplicationContextProfile to carry.
PROFILE_AREAS: tuple[str, ...] = (
    "identity_purpose",
    "pre_model_controls",
    "model_configuration",
    "post_model_controls",
    "integration_context",
)

# Side-effect levels that change state in the world. A capability at one of
# these levels is where human oversight actually matters; `read` and `none`
# cannot damage anything by acting.
STATE_CHANGING_SIDE_EFFECTS = frozenset(
    {SideEffectLevel.write, SideEffectLevel.destructive}
)


@dataclass(frozen=True)
class RegistryFacts:
    """What the AI Registry declares about the system under evaluation.

    ``available`` is False when the system row could not be loaded at all. That
    is itself reportable — a requirement evaluated against absent facts yields
    a gap rather than silently passing, the same way empty logs do.
    """

    available: bool = False
    system_type: str = ""
    risk_tier: str = ""
    modality: str = ""
    profile_present: bool = False
    # Profile areas that are declared but empty, in PROFILE_AREAS order.
    empty_profile_areas: tuple[str, ...] = ()
    capability_count: int = 0
    # Capability names, sorted, for each declared deficiency.
    state_changing_without_review: tuple[str, ...] = ()
    capabilities_without_schema: tuple[str, ...] = ()
    retrieval_document_count: int = 0
    metadata: dict[str, object] = field(default_factory=dict)


def _empty_profile_areas(profile: ApplicationContextProfile | None) -> tuple[str, ...]:
    if profile is None:
        # Every area is missing when the profile itself is, which FR-005 makes a
        # precondition for starting a run in the first place.
        return PROFILE_AREAS
    return tuple(area for area in PROFILE_AREAS if not getattr(profile, area, None))


def load_registry_facts(session: Session, *, ai_system_id: UUID) -> RegistryFacts:
    """Reduce the registry rows for one AI system to comparable facts.

    Only ENABLED capabilities are considered: a disabled capability is not part
    of the audited surface, so a deficiency in one is not a gap in this run.
    """
    ai_system = session.get(AISystem, ai_system_id)
    if ai_system is None:
        return RegistryFacts(available=False)

    profile = session.exec(
        select(ApplicationContextProfile).where(
            ApplicationContextProfile.ai_system_id == ai_system_id
        )
    ).first()
    capabilities = list(
        session.exec(
            select(AISystemCapability)
            .where(AISystemCapability.ai_system_id == ai_system_id)
            .where(AISystemCapability.enabled == True)  # noqa: E712
        ).all()
    )
    retrieval_documents = list(
        session.exec(
            select(RetrievalContextDocument).where(
                RetrievalContextDocument.ai_system_id == ai_system_id
            )
        ).all()
    )

    return RegistryFacts(
        available=True,
        system_type=ai_system.system_type or "",
        risk_tier=str(ai_system.risk_tier),
        modality=str(ai_system.modality),
        profile_present=profile is not None,
        empty_profile_areas=_empty_profile_areas(profile),
        capability_count=len(capabilities),
        state_changing_without_review=tuple(
            sorted(
                capability.name
                for capability in capabilities
                if capability.side_effect_level in STATE_CHANGING_SIDE_EFFECTS
                and not capability.requires_human_review
            )
        ),
        capabilities_without_schema=tuple(
            sorted(
                capability.name
                for capability in capabilities
                if not capability.input_schema
            )
        ),
        retrieval_document_count=len(retrieval_documents),
    )
