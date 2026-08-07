"""Coverage-gap matching tolerates client vocabulary that differs from ours.

Set-membership requirements used to compare observed log values to expected
values by exact string equality, so a client logging ``"European Union"`` or
``"Women"`` was reported as missing coverage it actually had. Matching now folds
case/whitespace and applies the requirement's configured aliases.
"""

from app.configs.frameworks.base import CoverageRequirement
from app.schemas.governance import LogAnalysisSummary
from app.services.context_assembly.coverage_gap_detector import _evaluate_requirement
from fastapi.testclient import TestClient


def _requirement(**overrides: object) -> CoverageRequirement:
    defaults: dict[str, object] = {
        "requirement_id": "test-jurisdiction",
        "category": "jurisdiction_coverage",
        "dimension": "Operations",
        "description": "Logs should cover each jurisdiction.",
        "recommendation": "Add samples for the missing jurisdictions.",
        "expected_values": ("US", "EU"),
    }
    return CoverageRequirement(**{**defaults, **overrides})  # type: ignore[arg-type]


def _analysis(jurisdictions: list[str]) -> LogAnalysisSummary:
    return LogAnalysisSummary(
        total_requests=len(jurisdictions),
        empty=not jurisdictions,
        observed_jurisdictions=sorted(jurisdictions),
        distinct_jurisdictions=len(set(jurisdictions)),
    )


def test_matching_ignores_case_and_surrounding_whitespace() -> None:
    is_gap, _, _, _ = _evaluate_requirement(_requirement(), _analysis(["us", "  eu "]))
    assert is_gap is False


def test_configured_alias_satisfies_the_canonical_expected_value() -> None:
    requirement = _requirement(aliases={"United States": "US", "European Union": "EU"})
    is_gap, _, _, _ = _evaluate_requirement(
        requirement, _analysis(["united states", "European Union"])
    )
    assert is_gap is False


def test_unaliased_value_is_still_reported_as_missing() -> None:
    is_gap, description, expected, observed = _evaluate_requirement(
        _requirement(aliases={"United States": "US"}), _analysis(["United States", "Canada"])
    )
    assert is_gap is True
    assert "EU" in description
    # The gap record keeps the client's raw wording so an auditor sees what was sent.
    assert observed == ["Canada", "United States"]
    assert expected == ["US", "EU"]


def test_aliases_collapse_synonyms_rather_than_inflating_distinct_count() -> None:
    """"EU" and "European Union" are one jurisdiction, not two."""

    requirement = _requirement(
        expected_values=(),
        minimum_distinct=2,
        aliases={"European Union": "EU"},
    )
    is_gap, description, _, _ = _evaluate_requirement(
        requirement, _analysis(["EU", "European Union"])
    )
    assert is_gap is True
    assert "Only 1 distinct value(s) observed" in description


def test_unrecognized_values_still_count_toward_minimum_distinct() -> None:
    requirement = _requirement(expected_values=(), minimum_distinct=2)
    is_gap, _, _, _ = _evaluate_requirement(requirement, _analysis(["Canada", "Japan"]))
    assert is_gap is False


def test_empty_logs_remain_a_gap_regardless_of_aliases() -> None:
    is_gap, description, _, _ = _evaluate_requirement(
        _requirement(aliases={"United States": "US"}), _analysis([])
    )
    assert is_gap is True
    assert description == "No log evidence available to assess coverage."


def test_seeded_framework_aliases_prevent_false_gaps_end_to_end(client: TestClient) -> None:
    """A client using its own vocabulary gets the same verdict as one using ours."""

    assert client.post("/api/v1/governance-config/bootstrap").status_code in (200, 201)
    system = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Vocabulary System",
            "owner": "AI Governance",
            "system_type": "decision_support",
            "risk_tier": "high",
            "selected_frameworks": ["nist_ai_rmf", "iso_42001"],
        },
    ).json()
    run = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system["id"],
            "selected_frameworks": ["nist_ai_rmf", "iso_42001"],
        },
    ).json()

    logs = [
        {
            "request_category": "loan_decision",
            "demographic_group": "Seniors",
            "jurisdiction": "United States",
            "outcome": "approved",
            "contains_pii": True,
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "Women",
            "jurisdiction": "European Union",
            "outcome": "denied",
            "flagged": True,
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "ethnic_minority",
            "jurisdiction": "u.s.",
            "outcome": "denied",
        },
        {
            "request_category": "loan_decision",
            "demographic_group": "disabled",
            "jurisdiction": "European Union",
            "outcome": "approved",
        },
    ]

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/context-assembly",
        json={"logs": logs},
    )
    assert response.status_code == 201
    body = response.json()

    gap_ids = {gap["gap_id"] for gap in body["coverage_gaps"]}
    assert "nist_ai_rmf:nist-demographic-coverage" not in gap_ids
    assert "iso_42001:iso-jurisdiction-coverage" not in gap_ids

    # The raw client wording is preserved in the persisted analysis.
    assert body["log_analysis"]["observed_jurisdictions"] == [
        "European Union",
        "United States",
        "u.s.",
    ]
