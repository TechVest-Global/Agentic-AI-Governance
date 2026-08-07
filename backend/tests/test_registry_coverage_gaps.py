"""Coverage gaps found in what the registry DECLARES, not only in the logs.

Layer 1 evaluated every coverage requirement against submitted logs, so every
gap it could raise meant one thing: we have no observational evidence about X.
The other half of an audit — what the system was registered as — went
unexamined, even though FR-005 makes an ApplicationContextProfile a
precondition for starting a run at all.

A capability that writes or destroys data while `requires_human_review` is
false is a Risk Controls deficiency in the declaration itself. It needs no
probing and no logs to establish, and it is exactly the kind of finding a
governance audit exists to surface.
"""

from uuid import UUID

from app.schemas.governance import LogAnalysisSummary, RegulatoryContextRead
from app.services.context_assembly.coverage_gap_detector import detect_coverage_gaps
from app.services.context_assembly.registry_facts import (
    PROFILE_AREAS,
    RegistryFacts,
    load_registry_facts,
)
from fastapi.testclient import TestClient

FULL_PROFILE = {
    "identity_purpose": {"purpose": "Loan eligibility decision support"},
    "pre_model_controls": {"input_validation": "schema + PII redaction"},
    "model_configuration": {"temperature": 0.2},
    "post_model_controls": {"output_review": "threshold-based escalation"},
    "integration_context": {"consumers": ["underwriting console"]},
}


def _bootstrap(client: TestClient) -> None:
    assert client.post("/api/v1/governance-config/bootstrap").status_code in (200, 201)


def _facts_for(system_id: str) -> RegistryFacts:
    """Load registry facts through the same engine the `client` fixture rebound."""

    import app.db.session as db_session
    from sqlmodel import Session

    with Session(db_session.engine) as session:
        return load_registry_facts(session, ai_system_id=UUID(str(system_id)))


def _create_system(client: TestClient, **overrides) -> dict:
    payload = {
        "name": "Registry Facts System",
        "owner": "AI Governance",
        "system_type": "decision_support",
        "risk_tier": "high",
        "selected_frameworks": ["iso_42001", "eu_ai_act"],
        **overrides,
    }
    response = client.post("/api/v1/ai-systems", json=payload)
    assert response.status_code == 201
    return response.json()


def _add_capability(client: TestClient, system_id: str, **overrides) -> dict:
    payload = {
        "name": "process-refund",
        "endpoint_ref": "process-refund",
        "capability_type": "action",
        "side_effect_level": "write",
        "requires_human_review": False,
        "input_schema": {"amount": "number (required)"},
        **overrides,
    }
    response = client.post(
        f"/api/v1/ai-systems/{system_id}/capabilities", json=payload
    )
    assert response.status_code == 201
    return response.json()


def _assemble(client: TestClient, system_id: str) -> dict:
    run = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["iso_42001", "eu_ai_act"],
        },
    ).json()
    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": []},
    )
    assert response.status_code == 201
    return response.json()


# --- fact extraction -------------------------------------------------------


def test_a_system_with_no_profile_reports_every_area_missing(client: TestClient) -> None:
    _bootstrap(client)
    system = _create_system(client)

    facts = _facts_for(system["id"])

    assert facts.available is True
    assert facts.profile_present is False
    assert facts.empty_profile_areas == PROFILE_AREAS


def test_a_completed_profile_reports_no_empty_areas(client: TestClient) -> None:
    _bootstrap(client)
    system = _create_system(client)
    client.put(
        f"/api/v1/ai-systems/{system['id']}/context-profile", json=FULL_PROFILE
    )

    facts = _facts_for(system["id"])

    assert facts.profile_present is True
    assert facts.empty_profile_areas == ()


def test_state_changing_capability_without_review_is_recorded(client: TestClient) -> None:
    _bootstrap(client)
    system = _create_system(client)
    _add_capability(client, system["id"], name="process-refund")

    facts = _facts_for(system["id"])

    assert facts.state_changing_without_review == ("process-refund",)


def test_a_read_only_capability_is_not_an_oversight_concern(client: TestClient) -> None:
    """`read` and `none` cannot damage anything by acting."""

    _bootstrap(client)
    system = _create_system(client)
    _add_capability(
        client,
        system["id"],
        name="lookup-balance",
        side_effect_level="read",
        requires_human_review=False,
    )

    facts = _facts_for(system["id"])

    assert facts.state_changing_without_review == ()


def test_a_reviewed_state_changing_capability_is_not_a_gap(client: TestClient) -> None:
    _bootstrap(client)
    system = _create_system(client)
    _add_capability(
        client, system["id"], name="process-refund", requires_human_review=True
    )

    facts = _facts_for(system["id"])

    assert facts.state_changing_without_review == ()


# --- gap detection ---------------------------------------------------------


def _no_logs() -> LogAnalysisSummary:
    return LogAnalysisSummary(total_requests=0, empty=True)


def _iso_context() -> RegulatoryContextRead:
    return RegulatoryContextRead(
        selected_frameworks=["iso_42001"],
        resolved_frameworks=["iso_42001"],
        missing_frameworks=[],
        control_count=0,
        frameworks=[
            {
                "framework_id": "iso_42001",
                "framework_name": "ISO/IEC 42001",
                "framework_version": "2023",
                "citation_format": "{control_ref}",
                "control_count": 0,
            }
        ],
    )


def test_absent_registry_facts_are_a_gap_not_a_pass() -> None:
    """"We could not look" must never read as "there is nothing there"."""

    gaps = detect_coverage_gaps(
        log_analysis=_no_logs(),
        regulatory_context=_iso_context(),
        registry_facts=None,
    )
    profile_gap = next(g for g in gaps if g.gap_id == "iso_42001:iso-context-profile")
    assert "No registry facts available" in profile_gap.description
    assert profile_gap.observed == ["registry_facts=unavailable"]


def test_a_complete_registration_clears_the_registry_gaps() -> None:
    facts = RegistryFacts(
        available=True,
        profile_present=True,
        empty_profile_areas=(),
        capability_count=1,
        state_changing_without_review=(),
        capabilities_without_schema=(),
    )
    gaps = detect_coverage_gaps(
        log_analysis=_no_logs(),
        regulatory_context=_iso_context(),
        registry_facts=facts,
    )
    gap_ids = {gap.gap_id for gap in gaps}
    assert "iso_42001:iso-context-profile" not in gap_ids
    assert "iso_42001:iso-agentic-human-oversight" not in gap_ids
    # Log-driven requirements still fire — empty logs are still a gap.
    assert "iso_42001:iso-pii-handling" in gap_ids


def test_the_gap_names_the_offending_capabilities() -> None:
    facts = RegistryFacts(
        available=True,
        profile_present=True,
        empty_profile_areas=(),
        capability_count=2,
        state_changing_without_review=("delete-record", "process-refund"),
    )
    gaps = detect_coverage_gaps(
        log_analysis=_no_logs(),
        regulatory_context=_iso_context(),
        registry_facts=facts,
    )
    oversight = next(
        g for g in gaps if g.gap_id == "iso_42001:iso-agentic-human-oversight"
    )
    assert oversight.observed == ["delete-record", "process-refund"]
    assert "delete-record, process-refund" in oversight.description
    assert oversight.severity.value == "high"


def test_partial_profile_names_only_the_empty_areas() -> None:
    facts = RegistryFacts(
        available=True,
        profile_present=True,
        empty_profile_areas=("post_model_controls", "integration_context"),
        capability_count=1,
    )
    gaps = detect_coverage_gaps(
        log_analysis=_no_logs(),
        regulatory_context=_iso_context(),
        registry_facts=facts,
    )
    profile_gap = next(g for g in gaps if g.gap_id == "iso_42001:iso-context-profile")
    assert profile_gap.observed == ["post_model_controls", "integration_context"]


# --- end to end ------------------------------------------------------------


def test_an_unreviewed_write_capability_surfaces_with_no_logs_at_all(
    client: TestClient,
) -> None:
    """The point of the whole feature: a real governance finding, zero probing."""

    _bootstrap(client)
    system = _create_system(client)
    client.put(f"/api/v1/ai-systems/{system['id']}/context-profile", json=FULL_PROFILE)
    _add_capability(client, system["id"], name="process-refund")

    body = _assemble(client, system["id"])
    gaps = {gap["gap_id"]: gap for gap in body["coverage_gaps"]}

    assert "iso_42001:iso-agentic-human-oversight" in gaps
    assert "eu_ai_act:eu-human-oversight-capability" in gaps
    assert gaps["eu_ai_act:eu-human-oversight-capability"]["observed"] == [
        "process-refund"
    ]
    # The profile was completed, so that requirement must NOT fire.
    assert "iso_42001:iso-context-profile" not in gaps


def test_a_fully_registered_system_raises_no_registry_gaps(client: TestClient) -> None:
    _bootstrap(client)
    system = _create_system(client)
    client.put(f"/api/v1/ai-systems/{system['id']}/context-profile", json=FULL_PROFILE)
    _add_capability(client, system["id"], requires_human_review=True)

    body = _assemble(client, system["id"])
    gap_ids = {gap["gap_id"] for gap in body["coverage_gaps"]}

    assert "iso_42001:iso-context-profile" not in gap_ids
    assert "iso_42001:iso-agentic-human-oversight" not in gap_ids
    assert "eu_ai_act:eu-human-oversight-capability" not in gap_ids
