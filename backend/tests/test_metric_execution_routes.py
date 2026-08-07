from uuid import uuid4

import app.services.specialist_agents.metric_execution as metric_execution_module
import pytest
from app.services.evaluators.mock import MockMetricEvaluator
from fastapi.testclient import TestClient


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Metric Execution System",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_metric(client: TestClient, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/metrics",
        json={
            "metric_id": metric_id,
            "name": f"{metric_id} metric",
            "dimension": "Task Fulfilment",
            "primary_agent": "orchestrator",
            "tool_name": "promptfoo",
            "framework_ids": ["nist_ai_rmf"],
            "threshold_rules": {"minimum": 0.8},
            "scoring_config": {"direction": "higher_is_better"},
        },
    )
    assert response.status_code == 201
    return response.json()


def create_mapping(
    client: TestClient, metric_id: str, control_ref: str = "MAP-1"
) -> dict[str, object]:
    response = client.post(
        "/api/v1/framework-mappings",
        json={
            "framework_id": "nist_ai_rmf",
            "framework_name": "NIST AI RMF",
            "framework_version": "1.0",
            "control_ref": control_ref,
            "control_title": "Context is established",
            "control_category": "map",
            "jurisdiction": "US",
            "metric_ids": [metric_id],
            "agent_names": ["orchestrator"],
            "risk_tiers": ["medium"],
            "evidence_requirements": ["metric_result"],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, system_id: str, metric_id: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system_id,
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": [metric_id],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_mock_metric_execution_creates_evidence_and_metric_results(
    client: TestClient,
) -> None:
    system = create_system(client)
    create_metric(client, "M-RUN")
    create_mapping(client, "M-RUN")
    run = create_run(client, system["id"], "M-RUN")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={
            "mock_score": 0.92,
            "source_name": "local_mock_runner",
            "evaluator_name": "mock",
        },
    )

    assert response.status_code == 201
    execution = response.json()
    assert execution["run_id"] == run["id"]
    assert execution["evidence_created"] == 1
    assert execution["metric_results_created"] == 1
    assert execution["evidence"][0]["source_type"] == "mock_metric"
    # Evidence is attributed to the metric's configured tool ("promptfoo" per
    # create_metric() above), not the request's source_name hint — see
    # metric_execution.py's persistence loop.
    assert execution["evidence"][0]["source_name"] == "promptfoo"
    assert execution["evidence"][0]["passed"] is True
    assert execution["metric_results"][0]["metric_id"] == "M-RUN"
    assert execution["metric_results"][0]["status"] == "passed"
    assert execution["metric_results"][0]["evidence_ids"] == [
        execution["evidence"][0]["id"]
    ]

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    assert updated_run["status"] == "metrics_running"
    assert updated_run["current_phase"] == "metric_execution"
    assert updated_run["result_summary"]["metric_results_created"] == 1
    assert updated_run["result_summary"]["evaluator_name"] == "mock"


def test_mock_metric_execution_can_force_status(client: TestClient) -> None:
    system = create_system(client)
    create_metric(client, "M-FORCE")
    create_mapping(client, "M-FORCE")
    run = create_run(client, system["id"], "M-FORCE")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.2, "force_status": "skipped"},
    )

    assert response.status_code == 201
    execution = response.json()
    assert execution["metric_results"][0]["status"] == "skipped"
    assert execution["metric_results"][0]["passed"] is False


def test_mock_metric_execution_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.post(
        f"/api/v1/evaluation-runs/{run_id}/metrics/run",
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }


def test_mock_metric_execution_validates_score(client: TestClient) -> None:
    system = create_system(client)
    create_metric(client, "M-INVALID")
    create_mapping(client, "M-INVALID")
    run = create_run(client, system["id"], "M-INVALID")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 1.5},
    )

    assert response.status_code == 422


def test_one_metric_erroring_does_not_discard_other_metrics_results(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One metric's evaluator raising must not discard the other metrics'
    already-computed evidence/metric_results for the same run (previously
    ThreadPoolExecutor.map re-raised on the first failure, and persistence
    only happened after the whole pool finished, so a single transient
    failure wiped out every other metric's results)."""
    system = create_system(client)
    create_metric(client, "M-OK")
    create_metric(client, "M-FAIL")
    create_mapping(client, "M-OK", control_ref="MAP-OK")
    create_mapping(client, "M-FAIL", control_ref="MAP-FAIL")
    run = create_run(client, system["id"], "M-OK")
    # Widen the same run's selected metrics to include the failing one too.
    response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system["id"],
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["M-OK", "M-FAIL"],
        },
    )
    assert response.status_code == 201
    run = response.json()

    class _FlakyEvaluator:
        name = "mock"

        def evaluate(self, evaluation_input):
            if evaluation_input.metric.metric_id == "M-FAIL":
                raise RuntimeError("simulated transient failure probing target")
            return MockMetricEvaluator().evaluate(evaluation_input)

    monkeypatch.setattr(
        metric_execution_module, "get_evaluator", lambda name: _FlakyEvaluator()
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.9, "evaluator_name": "mock"},
    )

    assert response.status_code == 201, response.text
    execution = response.json()
    # Both metrics persisted: the successful one AND the errored one (as an
    # error result), instead of the failure discarding everything.
    assert execution["evidence_created"] == 2
    assert execution["metric_results_created"] == 2
    statuses = {mr["metric_id"]: mr["status"] for mr in execution["metric_results"]}
    assert statuses["M-OK"] == "passed"
    assert statuses["M-FAIL"] == "error"

    run_response = client.get(f"/api/v1/evaluation-runs/{run['id']}")
    assert run_response.status_code == 200
    updated_run = run_response.json()
    # Partial failure is surfaced via the same RunStatus.degraded convention
    # run_agents already uses for partial specialist-agent failures.
    assert updated_run["status"] == "degraded"
    assert updated_run["result_summary"]["metrics_failed"] == 1
    assert updated_run["result_summary"]["metric_results_created"] == 2


def test_metric_execution_rejects_unknown_evaluator(client: TestClient) -> None:
    system = create_system(client)
    create_metric(client, "M-UNKNOWN-EVALUATOR")
    create_mapping(client, "M-UNKNOWN-EVALUATOR")
    run = create_run(client, system["id"], "M-UNKNOWN-EVALUATOR")

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"evaluator_name": "not_registered"},
    )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details["unknown_evaluator"] == "not_registered"
    assert set(details["available_evaluators"]) == {
        "mock",
        "threshold",
        "garak",
        "presidio",
        "ragas",
        "deepeval",
        "pyrit",
        "inspect_ai",
        "vision",
        "asr",
        "drift",
        # Alias of "drift", kept selectable because databases seeded before
        # CM-030/031/032 gained a real evaluator still store tool_name
        # "evidently" — see evaluators/registry.py.
        "evidently",
        # Scores CM-039 (trace_completeness) for real; CM-040/041/044 skip with
        # a specific reason — see evaluators/langfuse_evaluator.py.
        "langfuse",
        "auto",
    }
