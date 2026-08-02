from uuid import uuid4

from fastapi.testclient import TestClient

from tests.conftest import advance_run_to_council


def create_system(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/v1/ai-systems",
        json={
            "name": "Report System",
            "description": "System used for governance report testing.",
            "owner": "AI Governance",
            "system_type": "chatbot",
            "selected_frameworks": ["nist_ai_rmf"],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_governance_report_aggregates_run_outputs(client: TestClient) -> None:
    system = create_system(client)
    context_response = client.put(
        f"/api/v1/ai-systems/{system['id']}/context-profile",
        json={
            "identity_purpose": {"business_domain": "internal_operations"},
            "pre_model_controls": {"pii_handling": "redact"},
            "model_configuration": {"provider": "azure_foundry"},
            "post_model_controls": {"human_review": True},
            "integration_context": {"rollback": "manual"},
        },
    )
    assert context_response.status_code == 200
    capability_response = client.post(
        f"/api/v1/ai-systems/{system['id']}/capabilities",
        json={
            "name": "answer_question",
            "capability_type": "generation",
            "endpoint_ref": "/api/answer",
        },
    )
    assert capability_response.status_code == 201
    assert (
        client.post(
            "/api/v1/metrics",
            json={
                "metric_id": "REPORT-M01",
                "name": "Report metric",
                "dimension": "Task Fulfilment",
                "primary_agent": "orchestrator",
                "tool_name": "promptfoo",
                "framework_ids": ["nist_ai_rmf"],
                "threshold_rules": {"minimum": 0.8},
                "scoring_config": {"direction": "higher_is_better"},
            },
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/v1/framework-mappings",
            json={
                "framework_id": "nist_ai_rmf",
                "framework_name": "NIST AI RMF",
                "framework_version": "1.0",
                "control_ref": "MAP-REPORT",
                "control_title": "Context is established",
                "control_category": "map",
                "jurisdiction": "US",
                "metric_ids": ["REPORT-M01"],
                "agent_names": ["orchestrator"],
                "risk_tiers": ["medium"],
                "evidence_requirements": ["metric_result"],
            },
        ).status_code
        == 201
    )
    run_response = client.post(
        "/api/v1/evaluation-runs",
        json={
            "ai_system_id": system["id"],
            "selected_frameworks": ["nist_ai_rmf"],
            "selected_metrics": ["REPORT-M01"],
        },
    )
    assert run_response.status_code == 201
    run = run_response.json()
    assert (
        client.post(
            f"/api/v1/evaluation-runs/{run['id']}/state",
            json={
                "entry_type": "context_loaded",
                "source": "report_test",
                "phase": "context_assembly",
                "payload": {"ok": True},
            },
        ).status_code
        == 201
    )
    metric_execution = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/metrics/run",
        json={"mock_score": 0.9},
    )
    assert metric_execution.status_code == 201
    evidence_id = metric_execution.json()["evidence"][0]["id"]
    finding_response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/findings",
        json={
            "finding_type": "quality",
            "title": "Report finding",
            "summary": "A finding included in the report.",
            "severity": "low",
            "confidence": 0.7,
            "dimension": "Task Fulfilment",
            "evidence_ids": [evidence_id],
        },
    )
    assert finding_response.status_code == 201
    # Recording a verdict by hand requires the run to have reached the council.
    advance_run_to_council(run["id"])
    verdict_response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/verdict",
        json={
            "confidence_score": 0.9,
            "action_tier": "human_review",
            "label": "conditional_approval",
        },
    )
    assert verdict_response.status_code == 201

    response = client.get(f"/api/v1/evaluation-runs/{run['id']}/report")

    assert response.status_code == 200
    report = response.json()
    assert report["run"]["id"] == run["id"]
    assert report["ai_system"]["id"] == system["id"]
    assert report["context_profile"]["identity_purpose"] == {
        "business_domain": "internal_operations"
    }
    assert [item["name"] for item in report["capabilities"]] == ["answer_question"]
    assert report["metric_plan"]["metric_count"] == 1
    assert report["counts"] == {
        "capabilities": 1,
        "planned_metrics": 1,
        "planned_controls": 1,
        "evidence": 1,
        "metric_results": 1,
        "agent_executions": 0,
        "findings": 1,
        "state_entries": 1,
        # This run registered one capability endpoint and never probed it. The
        # report says so rather than implying the surface was covered.
        "endpoints_registered": 1,
        "endpoints_unprobed": 1,
    }

    # ...and the per-endpoint breakdown names the surface that went unprobed.
    coverage = report["endpoint_coverage"]
    assert coverage["registered_endpoint_count"] == 1
    assert coverage["unprobed_endpoint_count"] == 1
    assert [e["capability_name"] for e in coverage["endpoints"]] == ["answer_question"]
    assert coverage["endpoints"][0]["probes_sent"] == 0
    assert report["evidence"][0]["id"] == evidence_id
    assert report["metric_results"][0]["metric_id"] == "REPORT-M01"
    assert report["findings"][0]["title"] == "Report finding"
    assert report["verdict"]["label"] == "conditional_approval"
    assert report["state_chain"]["valid"] is True


def test_governance_report_requires_existing_run(client: TestClient) -> None:
    run_id = uuid4()

    response = client.get(f"/api/v1/evaluation-runs/{run_id}/report")

    assert response.status_code == 404
    assert response.json()["error"]["details"] == {
        "resource": "Evaluation run",
        "id": str(run_id),
    }
