from uuid import UUID

from sqlmodel import Session

from app.models.enums import LedgerActorType, RunPhase
from app.schemas.governance import (
    AgentRunCreate,
    AuditLedgerEntryCreate,
    ContextAssemblyCreate,
    ContextAssemblyRead,
    CouncilDeliberationCreate,
    GovernancePipelineRunCreate,
    GovernancePipelineRunRead,
    GovernanceStateEntryCreate,
    MetricExecutionCreate,
)
from app.services import (
    agent_execution,
    audit_ledger,
    context_assembly,
    council,
    governance_state,
    metric_execution,
    reports,
)
from app.services.run_validation import get_run_or_raise


def run_governance_pipeline(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> GovernancePipelineRunRead:
    get_run_or_raise(session, run_id)

    context_result: ContextAssemblyRead | None = None
    if payload.logs:
        # Layer 1 runs first so the state chain captures context assembly and the
        # run progresses through phases in the spec-mandated order. The assembler
        # records its own GovernanceState and audit-ledger entries.
        context_result = context_assembly.assemble_context(
            session,
            run_id=run_id,
            payload=ContextAssemblyCreate(
                logs=payload.logs,
                requested_by=payload.requested_by,
                notes=payload.notes,
            ),
        )

    metric_result = metric_execution.run_mock_metrics(
        session,
        run_id=run_id,
        payload=MetricExecutionCreate(
            mock_score=payload.mock_score,
            force_status=payload.force_metric_status,
            source_name=payload.source_name,
            evaluator_name=payload.evaluator_name,
        ),
    )
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.metric_execution,
        entry_type="metric_execution_completed",
        event_type="metric_execution.completed",
        actor_type=LedgerActorType.tool,
        actor_id=payload.evaluator_name,
        payload={
            "evaluator_name": payload.evaluator_name,
            "evidence_created": metric_result.evidence_created,
            "metric_results_created": metric_result.metric_results_created,
        },
    )

    agent_result = agent_execution.run_agents(
        session,
        run_id=run_id,
        payload=AgentRunCreate(agent_names=payload.agent_names),
    )
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.specialist_agents,
        entry_type="agent_execution_completed",
        event_type="agent_execution.completed",
        actor_type=LedgerActorType.agent,
        actor_id="agent_orchestrator",
        payload={
            "agents_requested": payload.agent_names,
            "agents_run": [agent.agent_name for agent in agent_result.agents_run],
            "findings_created": agent_result.findings_created,
        },
    )

    council_result = council.deliberate(
        session,
        run_id=run_id,
        payload=CouncilDeliberationCreate(
            requested_by=payload.requested_by,
            notes=payload.notes,
        ),
    )
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.deliberation_council,
        entry_type="council_deliberation_completed",
        event_type="council_deliberation.completed",
        actor_type=LedgerActorType.system,
        actor_id="council_service",
        payload={
            "requested_by": payload.requested_by,
            "label": council_result.verdict.label,
            "action_tier": council_result.verdict.action_tier,
            "confidence_score": council_result.verdict.confidence_score,
            "finding_count": council_result.finding_count,
            "metric_result_count": council_result.metric_result_count,
        },
    )

    report = reports.build_governance_report(session, run_id=run_id)
    _record_pipeline_step(
        session,
        run_id=run_id,
        phase=RunPhase.action_reporting,
        entry_type="governance_report_generated",
        event_type="governance_report.generated",
        actor_type=LedgerActorType.system,
        actor_id="report_service",
        payload={
            "counts": report.counts,
            "state_chain_valid": report.state_chain.valid,
        },
    )
    report = reports.build_governance_report(session, run_id=run_id)

    return GovernancePipelineRunRead(
        run_id=run_id,
        context_assembly=context_result,
        metric_execution=metric_result,
        agent_run=agent_result,
        council=council_result,
        report=report,
    )


def _record_pipeline_step(
    session: Session,
    *,
    run_id: UUID,
    phase: RunPhase,
    entry_type: str,
    event_type: str,
    actor_type: LedgerActorType,
    actor_id: str | None,
    payload: dict[str, object],
) -> None:
    governance_state.append_state_entry(
        session,
        run_id=run_id,
        payload=GovernanceStateEntryCreate(
            entry_type=entry_type,
            source="orchestrator",
            phase=phase,
            payload=payload,
        ),
    )
    audit_ledger.append_ledger_entry(
        session,
        run_id=run_id,
        payload=AuditLedgerEntryCreate(
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            payload={**payload, "phase": phase},
        ),
    )
