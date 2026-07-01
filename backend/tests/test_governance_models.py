from uuid import uuid4

from app.models import (
    AISystem,
    AISystemCapability,
    ApplicationContextProfile,
    AuditLedgerEntry,
    EvaluationRun,
    EvidenceRecord,
    Finding,
    FrameworkMapping,
    GovernanceStateEntry,
    MetricConfig,
    MetricResult,
    Verdict,
)
from app.models.enums import ActionTier, RiskTier, RunStatus
from app.schemas import AISystemRead, EvaluationRunRead
from app.schemas.governance import (
    EvidenceRecordRead,
    FindingRead,
    FrameworkMappingRead,
    MetricConfigRead,
    MetricResultRead,
)


def test_core_model_tables_are_registered() -> None:
    tables = {
        AISystem.__tablename__,
        AISystemCapability.__tablename__,
        ApplicationContextProfile.__tablename__,
        MetricConfig.__tablename__,
        FrameworkMapping.__tablename__,
        EvaluationRun.__tablename__,
        GovernanceStateEntry.__tablename__,
        EvidenceRecord.__tablename__,
        MetricResult.__tablename__,
        Finding.__tablename__,
        Verdict.__tablename__,
        AuditLedgerEntry.__tablename__,
    }

    assert tables == {
        "ai_systems",
        "ai_system_capabilities",
        "application_context_profiles",
        "metric_configs",
        "framework_mappings",
        "evaluation_runs",
        "governance_state_entries",
        "evidence_records",
        "metric_results",
        "findings",
        "verdicts",
        "audit_ledger_entries",
    }


def test_ai_system_defaults_and_schema_serialization() -> None:
    system = AISystem(
        name="TechVest Support Chatbot",
        owner="AI Governance",
        system_type="chatbot",
        selected_frameworks=["nist_ai_rmf"],
    )

    payload = AISystemRead.model_validate(system)

    assert payload.risk_tier == RiskTier.medium
    assert payload.model_provider == "azure_foundry"
    assert payload.selected_frameworks == ["nist_ai_rmf"]


def test_evaluation_run_defaults_and_schema_serialization() -> None:
    system_id = uuid4()
    run = EvaluationRun(ai_system_id=system_id, selected_frameworks=["owasp_llm_top_10"])

    payload = EvaluationRunRead.model_validate(run)

    assert payload.ai_system_id == system_id
    assert payload.status == RunStatus.created
    assert payload.current_phase == "created"


def test_verdict_action_tier_default_is_conservative() -> None:
    verdict = Verdict(run_id=uuid4(), confidence_score=0.42, label="monitor")

    assert verdict.action_tier == ActionTier.human_review


def test_runtime_outputs_can_reference_a_specific_capability() -> None:
    run_id = uuid4()
    capability_id = uuid4()

    evidence = EvidenceRecord(
        run_id=run_id,
        ai_system_capability_id=capability_id,
        source_type="tool",
        source_name="promptfoo",
    )
    metric = MetricResult(
        run_id=run_id,
        ai_system_capability_id=capability_id,
        metric_id="M01",
        dimension="Task Fulfilment",
        tool_name="promptfoo",
    )
    finding = Finding(
        run_id=run_id,
        ai_system_capability_id=capability_id,
        finding_type="quality",
        title="Incomplete answer",
        summary="The response missed a required business rule.",
        dimension="Task Fulfilment",
    )

    assert EvidenceRecordRead.model_validate(evidence).ai_system_capability_id == capability_id
    assert MetricResultRead.model_validate(metric).ai_system_capability_id == capability_id
    assert FindingRead.model_validate(finding).ai_system_capability_id == capability_id


def test_metric_and_framework_config_schema_serialization() -> None:
    metric = MetricConfig(
        metric_id="M01",
        name="Task success rate",
        dimension="Task Fulfilment",
        primary_agent="orchestrator",
        tool_name="promptfoo",
        framework_ids=["nist_ai_rmf", "iso_42001"],
        threshold_rules={"high_risk_minimum": 0.95},
        scoring_config={"direction": "higher_is_better"},
    )
    mapping = FrameworkMapping(
        framework_id="nist_ai_rmf",
        framework_name="NIST AI RMF",
        framework_version="1.0",
        control_ref="MAP-1",
        control_title="Context is established",
        metric_ids=["M01"],
        agent_names=["orchestrator"],
        risk_tiers=["medium", "high"],
        evidence_requirements=["metric_result", "state_entry"],
    )

    metric_payload = MetricConfigRead.model_validate(metric)
    mapping_payload = FrameworkMappingRead.model_validate(mapping)

    assert metric_payload.metric_id == "M01"
    assert metric_payload.enabled is True
    assert metric_payload.threshold_rules["high_risk_minimum"] == 0.95
    assert mapping_payload.framework_id == "nist_ai_rmf"
    assert mapping_payload.metric_ids == ["M01"]
