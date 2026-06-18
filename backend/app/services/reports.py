from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ResourceNotFoundError
from app.models.agent import AgentExecution
from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.models.verdict import Verdict
from app.schemas.governance import GovernanceReportRead
from app.services.governance_state import verify_state_chain
from app.services.metric_plans import build_metric_plan
from app.services.run_validation import get_run_or_raise


def build_governance_report(
    session: Session,
    *,
    run_id: UUID,
) -> GovernanceReportRead:
    run = get_run_or_raise(session, run_id)
    ai_system = session.get(AISystem, run.ai_system_id)
    if ai_system is None:
        raise ResourceNotFoundError("AI system", str(run.ai_system_id))

    context_profile = session.exec(
        select(ApplicationContextProfile).where(
            ApplicationContextProfile.ai_system_id == run.ai_system_id
        )
    ).one_or_none()
    capabilities = list(
        session.exec(
            select(AISystemCapability)
            .where(AISystemCapability.ai_system_id == run.ai_system_id)
            .order_by(AISystemCapability.created_at.asc())
        ).all()
    )
    evidence = list(
        session.exec(
            select(EvidenceRecord)
            .where(EvidenceRecord.run_id == run_id)
            .order_by(EvidenceRecord.created_at.asc())
        ).all()
    )
    metric_results = list(
        session.exec(
            select(MetricResult)
            .where(MetricResult.run_id == run_id)
            .order_by(MetricResult.created_at.asc())
        ).all()
    )
    agent_executions = list(
        session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .order_by(AgentExecution.created_at.asc())
        ).all()
    )
    findings = list(
        session.exec(
            select(Finding)
            .where(Finding.run_id == run_id)
            .order_by(Finding.created_at.asc())
        ).all()
    )
    verdict = session.exec(select(Verdict).where(Verdict.run_id == run_id)).first()
    state_chain = verify_state_chain(session, run_id=run_id)
    metric_plan = build_metric_plan(session, run_id=run_id)

    return GovernanceReportRead(
        run=run,
        ai_system=ai_system,
        context_profile=context_profile,
        capabilities=capabilities,
        metric_plan=metric_plan,
        agent_executions=agent_executions,
        evidence=evidence,
        metric_results=metric_results,
        findings=findings,
        verdict=verdict,
        state_chain=state_chain,
        counts={
            "capabilities": len(capabilities),
            "planned_metrics": metric_plan.metric_count,
            "planned_controls": metric_plan.control_count,
            "evidence": len(evidence),
            "metric_results": len(metric_results),
            "agent_executions": len(agent_executions),
            "findings": len(findings),
            "state_entries": int(state_chain["entry_count"]),
        },
    )
