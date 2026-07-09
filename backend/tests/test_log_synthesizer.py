"""Deterministic per-system log synthesizer (Layer 1 fallback)."""

from uuid import UUID

from app.models.ai_system import AISystem
from app.models.enums import Modality, RiskTier
from app.services.agents.probe_library import SystemCategory
from app.services.context_assembly.log_synthesizer import synthesize_logs_for_system


def _system(
    *,
    system_type: str,
    risk_tier: RiskTier = RiskTier.medium,
    sid: str = "11111111-1111-1111-1111-111111111111",
) -> AISystem:
    return AISystem(
        id=UUID(sid),
        name="Test System",
        owner="Tester",
        system_type=system_type,
        risk_tier=risk_tier,
        modality=Modality.text,
        selected_frameworks=["nist_ai_rmf"],
    )


def test_synthesizes_nonempty_sample():
    logs = synthesize_logs_for_system(_system(system_type="hiring_screening"))
    assert logs, "synthesizer must produce log evidence"
    assert all(entry.request_category for entry in logs)


def test_is_deterministic_for_same_system():
    sys = _system(system_type="hiring_screening")
    first = synthesize_logs_for_system(sys)
    second = synthesize_logs_for_system(sys)
    assert [e.model_dump() for e in first] == [e.model_dump() for e in second]


def test_decisioning_attaches_demographics_and_pii():
    logs = synthesize_logs_for_system(_system(system_type="hiring_candidate_screening"))
    # A decisioning system decides about people: every record carries a demographic.
    assert all(e.demographic_group for e in logs)
    assert any(e.contains_pii for e in logs)
    categories = {e.request_category for e in logs}
    assert "candidate_screening" in categories


def test_rag_uses_retrieval_categories_not_hiring():
    logs = synthesize_logs_for_system(_system(system_type="rag support chatbot"))
    categories = {e.request_category for e in logs}
    assert "knowledge_lookup" in categories
    assert "candidate_screening" not in categories


def test_partial_demographic_coverage_leaves_a_gap():
    # Covers exactly 3 of the 4 expected demographics -> satisfies the minimum but
    # leaves one real, deterministic coverage gap for the orchestrator to adapt to.
    logs = synthesize_logs_for_system(_system(system_type="hiring_screening"))
    groups = {e.demographic_group for e in logs if e.demographic_group}
    assert len(groups) == 3
    assert groups < {"female", "age_over_60", "ethnicity_minority", "disability"}


def test_high_risk_gets_adversarial_sample_medium_does_not():
    high = synthesize_logs_for_system(
        _system(system_type="hiring_screening", risk_tier=RiskTier.high)
    )
    medium = synthesize_logs_for_system(
        _system(system_type="hiring_screening", risk_tier=RiskTier.medium)
    )
    assert any(e.flagged for e in high)
    assert not any(e.flagged for e in medium)


def test_different_systems_omit_different_demographics():
    a = synthesize_logs_for_system(
        _system(system_type="hiring", sid="00000000-0000-0000-0000-000000000000")
    )
    b = synthesize_logs_for_system(
        _system(system_type="hiring", sid="00000000-0000-0000-0000-000000000003")
    )
    groups_a = {e.demographic_group for e in a if e.demographic_group}
    groups_b = {e.demographic_group for e in b if e.demographic_group}
    # Different seeds omit different demographics -> orchestrator varies per system.
    assert groups_a != groups_b


def test_generic_system_still_produces_logs():
    logs = synthesize_logs_for_system(_system(system_type="something_unmapped"))
    assert logs
    profile_categories = {e.request_category for e in logs}
    assert "general_request" in profile_categories


def test_classify_is_used_for_category_branching():
    # Sanity: the generative branch is reachable and distinct from RAG/decisioning.
    logs = synthesize_logs_for_system(_system(system_type="content drafting assistant"))
    categories = {e.request_category for e in logs}
    assert categories & {"draft_generation", "summarization"}
    assert SystemCategory.GENERATIVE_ASSISTANT  # enum import is exercised
