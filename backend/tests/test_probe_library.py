"""Tests for system-aware probe selection."""

from app.services.agents.probe_library import (
    SystemCategory,
    classify_system,
    probes_for,
    probes_for_endpoint,
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


def test_decisioning_gets_tailored_bias_probes():
    hiring = classify_system("loan underwriting model")
    labels = [name for name, _ in probes_for("bias", hiring, _HIRING_FALLBACK)]
    # Decisioning systems get matched-pair / proxy / counterfactual bias probes,
    # not the agent's generic fallback.
    assert labels != [name for name, _ in _HIRING_FALLBACK]
    assert any("demographic_parity" in label or "proxy" in label for label in labels)


def test_all_dimensions_tailored_for_decisioning_and_rag():
    hr = classify_system("hr_recruitment_screening")
    rag = classify_system("rag chatbot")
    for dim in ("bias", "misuse", "explainability", "quality", "risk", "compliance"):
        hr_probes = probes_for(dim, hr, _HIRING_FALLBACK)
        rag_probes = probes_for(dim, rag, _HIRING_FALLBACK)
        # Each dimension has a tailored (non-fallback) set for both categories,
        # and the two categories get DIFFERENT probes.
        assert hr_probes != _HIRING_FALLBACK, f"{dim} not tailored for HR"
        assert rag_probes != _HIRING_FALLBACK, f"{dim} not tailored for RAG"
        assert hr_probes != rag_probes, f"{dim} identical for HR and RAG"


def test_unknown_dimension_falls_back():
    rag = classify_system("rag chatbot")
    assert probes_for("nonexistent_dimension", rag, _HIRING_FALLBACK) == _HIRING_FALLBACK


def test_rag_misuse_uses_indirect_injection():
    rag = classify_system("support chatbot with retrieval")
    labels = [name for name, _ in probes_for("misuse", rag, _HIRING_FALLBACK)]
    assert any("injection" in label for label in labels)


def test_per_endpoint_probes_differ_by_function():
    hr = classify_system("hr_recruitment_screening")
    parse = [n for n, _ in probes_for_endpoint("bias", "parse-resume", hr, _HIRING_FALLBACK)]
    rank = [
        n
        for n, _ in probes_for_endpoint(
            "bias", "http://gw/api/v1/ai/rank-candidates", hr, _HIRING_FALLBACK
        )
    ]
    assert any("parse_resume" in n for n in parse)
    assert any("rank_candidates" in n for n in rank)
    assert parse != rank


def test_per_endpoint_falls_back_to_system_probes():
    hr = classify_system("hr_recruitment_screening")
    # A function with no tailored set for the dimension -> system-type probes.
    got = probes_for_endpoint("bias", "unknown-function", hr, _HIRING_FALLBACK)
    assert got == probes_for("bias", hr, _HIRING_FALLBACK)
