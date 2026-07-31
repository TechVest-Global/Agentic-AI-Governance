from uuid import uuid4

from fastapi.testclient import TestClient


def create_system(client: TestClient, name: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": name,
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={"ai_system_id": system_id, "selected_metrics": ["M01"]},
    )
    assert response.status_code == 201
    return response.json()


def test_verdict_can_be_created_and_retrieved(client: TestClient) -> None:
    system = create_system(client, "Verdict System")
    run = create_run(client, system["id"])
    verdict_url = f"/api/v1/evaluation-runs/{run['id']}/verdict"

    create_response = client.post(
        verdict_url,
        json={
            "confidence_score": 0.91,
            "action_tier": "human_review",
            "label": "conditional_approval",
            "synthesis": "The system can proceed after owner review.",
            "objections": [
                {
                    "agent": "bias_agent",
                    "summary": "Needs more protected-class test coverage.",
                }
            ],
            "reasoning": "Most metrics passed, with one medium-risk gap.",
            "required_actions": [
                {
                    "owner": "system_owner",
                    "action": "Add bias coverage before production release.",
                }
            ],
        },
    )

    assert create_response.status_code == 201
    verdict = create_response.json()
    assert verdict["run_id"] == run["id"]
    assert verdict["confidence_score"] == 0.91
    assert verdict["label"] == "conditional_approval"
    assert verdict["objections"][0]["agent"] == "bias_agent"

    get_response = client.get(verdict_url)
    assert get_response.status_code == 200
    assert get_response.json() == verdict


def test_verdict_allows_only_one_decision_per_run(client: TestClient) -> None:
    system = create_system(client, "Single Verdict System")
    run = create_run(client, system["id"])
    verdict_url = f"/api/v1/evaluation-runs/{run['id']}/verdict"
    payload = {"label": "needs_review"}

    first_response = client.post(verdict_url, json=payload)
    second_response = client.post(verdict_url, json=payload)

    assert first_response.status_code == 201
    assert second_response.status_code == 409
    assert second_response.json()["error"]["details"] == {
        "resource": "Verdict",
        "field": "run_id",
        "value": run["id"],
    }


def test_verdict_requires_existing_run(client: TestClient) -> None:
    missing_run_id = uuid4()

    create_response = client.post(
        f"/api/v1/evaluation-runs/{missing_run_id}/verdict",
        json={"label": "missing_run"},
    )
    get_response = client.get(f"/api/v1/evaluation-runs/{missing_run_id}/verdict")

    assert create_response.status_code == 404
    assert get_response.status_code == 404
    assert create_response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert get_response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_verdict_rejects_invalid_confidence_score(client: TestClient) -> None:
    system = create_system(client, "Invalid Verdict System")
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={"label": "invalid_confidence", "confidence_score": 1.5},
    )

    assert response.status_code == 422


def test_verdict_override_captures_disagreement_without_mutating_the_original(
    client: TestClient,
) -> None:
    system = create_system(client, "Override System")
    run = create_run(client, system["id"])
    verdict_url = f"/api/v1/evaluation-runs/{run['id']}/verdict"

    original = client.post(
        verdict_url,
        json={"label": "approved", "confidence_score": 0.9},
    ).json()

    override_response = client.post(
        f"{verdict_url}/override",
        json={
            "human_override_label": "blocked",
            "human_override_reason": "Reviewer found an undisclosed data-sharing clause.",
        },
    )

    assert override_response.status_code == 200
    overridden = override_response.json()
    # The original verdict fields are untouched — override is additive data,
    # not a replacement, so a report that already showed this verdict stays
    # accurate to what the council actually decided.
    assert overridden["label"] == "approved"
    assert overridden["confidence_score"] == 0.9
    assert overridden["human_override_label"] == "blocked"
    assert overridden["human_override_reason"] == (
        "Reviewer found an undisclosed data-sharing clause."
    )
    assert overridden["overridden_by"] is not None
    assert overridden["overridden_at"] is not None
    assert overridden["id"] == original["id"]

    # The override is captured in the tamper-evident ledger too.
    ledger_events = [
        e for e in client.get(f"/api/v1/evaluation-runs/{run['id']}/ledger").json()
        if e["event_type"] == "verdict.overridden"
    ]
    assert len(ledger_events) == 1
    assert ledger_events[0]["payload"]["human_override_label"] == "blocked"


def test_verdict_override_requires_existing_verdict(client: TestClient) -> None:
    system = create_system(client, "No Verdict Yet System")
    run = create_run(client, system["id"])

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict/override",
        json={"human_override_label": "blocked", "human_override_reason": "test"},
    )

    assert response.status_code == 404
