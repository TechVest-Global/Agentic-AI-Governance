"""Registry of framework knowledge configurations.

The regulatory ingester resolves a framework_id to its ``FrameworkKnowledge``
record here. Frameworks that have seeded ``FrameworkMapping`` rows but no
knowledge record still resolve (with default citation format and empty rubric);
frameworks with neither are reported as missing.
"""

from app.configs.frameworks.base import FrameworkKnowledge
from app.configs.frameworks.iso_42001 import ISO_42001_KNOWLEDGE
from app.configs.frameworks.nist_ai_rmf import NIST_AI_RMF_KNOWLEDGE

FRAMEWORK_KNOWLEDGE: dict[str, FrameworkKnowledge] = {
    knowledge.framework_id: knowledge
    for knowledge in (
        NIST_AI_RMF_KNOWLEDGE,
        ISO_42001_KNOWLEDGE,
    )
}


def get_framework_knowledge(framework_id: str) -> FrameworkKnowledge | None:
    return FRAMEWORK_KNOWLEDGE.get(framework_id.strip().lower())


def available_frameworks() -> list[str]:
    return sorted(FRAMEWORK_KNOWLEDGE)
