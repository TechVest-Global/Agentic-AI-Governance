from uuid import uuid4

from app.models import (
    AISystem,
    ApplicationContextProfile,
    AuditLedgerEntry,
    EvaluationRun,
    EvidenceRecord,
    Finding,
    GovernanceStateEntry,
    MetricResult,
    Verdict,
)
from app.models.enums import ActionTier, RiskTier, RunStatus
from app.schemas import AISystemRead, EvaluationRunRead


def test_core_model_tables_are_registered() -> None:
    tables = {
        AISystem.__tablename__,
        ApplicationContextProfile.__tablename__,
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
        "application_context_profiles",
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
