"""Tests for system-aware probe selection."""

from app.services.agents.probe_library import (
    SystemCategory,
    classify_system,
    probes_for,
)

_HIRING_FALLBACK = [("demographic_parity", "rate two candidates ...")]


def test_classifies_rag_chatbot_as_retrieval_backed():
    profile = classify_system("Techvest RAG support chatbot")
    assert profile.category is SystemCategory.RAG_ASSISTANT
    assert profile.is_retrieval_backed is True
    assert profile.decides_about_people is False


def test_classifies_hiring_system_as_decisioning():
    profile = classify_system("Automated hiring candidate screener")
    assert profile.category is SystemCategory.DECISIONING
    assert profile.decides_about_people is True


def test_unknown_type_is_generic():
    assert classify_system("").category is SystemCategory.GENERIC
    assert classify_system(None).category is SystemCategory.GENERIC


def test_classification_is_deterministic():
    assert classify_system("RAG assistant") == classify_system("RAG assistant")


def test_rag_gets_grounding_probes_not_hiring_probes():
    rag = classify_system("knowledge base assistant")
    probes = probes_for("bias", rag, _HIRING_FALLBACK)
    # RAG should NOT receive the "rate two candidates" hiring probe.
    assert probes != _HIRING_FALLBACK
    labels = [name for name, _ in probes]
    assert any("demographic_consistency" in label for label in labels)


def test_decisioning_keeps_fallback_hiring_probes():
    hiring = classify_system("loan underwriting model")
    # No tailored bias set for decisioning -> keep the agent's own hiring probes.
    assert probes_for("bias", hiring, _HIRING_FALLBACK) == _HIRING_FALLBACK


def test_unknown_dimension_falls_back():
    rag = classify_system("rag chatbot")
    assert probes_for("nonexistent_dimension", rag, _HIRING_FALLBACK) == _HIRING_FALLBACK


def test_rag_misuse_uses_indirect_injection():
    rag = classify_system("support chatbot with retrieval")
    labels = [name for name, _ in probes_for("misuse", rag, _HIRING_FALLBACK)]
    assert any("injection" in label for label in labels)
