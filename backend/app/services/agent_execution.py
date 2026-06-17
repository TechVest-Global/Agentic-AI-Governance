from uuid import UUID

from sqlmodel import Session, select

from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.base import utc_now
from app.models.enums import RunPhase, RunStatus
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.schemas.governance import AgentRunCreate, AgentRunRead, AgentRunSummary
from app.services.agents.base import AgentContext
from app.services.agents.registry import select_agents
from app.services.run_validation import get_run_or_raise


def run_agents(
    session: Session,
    *,
    run_id: UUID,
    payload: AgentRunCreate,
) -> AgentRunRead:
    run = get_run_or_raise(session, run_id)
    ai_system = session.get(AISystem, run.ai_system_id)
    context = AgentContext(
        ai_system=ai_system,
        context_profile=_get_context_profile(session, ai_system_id=run.ai_system_id),
        capabilities=_list_capabilities(session, ai_system_id=run.ai_system_id),
        evidence=_list_evidence(session, run_id=run_id),
        metric_results=_list_metric_results(session, run_id=run_id),
        existing_findings=_list_findings(session, run_id=run_id),
    )

    created_findings: list[Finding] = []
    summaries: list[AgentRunSummary] = []
    for agent in select_agents(payload.agent_names):
        finding_payloads = agent.evaluate(context)
        summaries.append(
            AgentRunSummary(
                agent_name=agent.name,
                finding_count=len(finding_payloads),
            )
        )
        for finding_payload in finding_payloads:
            finding = Finding(run_id=run_id, **finding_payload.model_dump())
            session.add(finding)
            created_findings.append(finding)

    run.status = RunStatus.agents_running
    run.current_phase = RunPhase.specialist_agents
    run.result_summary = {
        **(run.result_summary or {}),
        "agents_run": [summary.model_dump() for summary in summaries],
        "agent_findings_created": len(created_findings),
        "agents_completed_at": utc_now().isoformat(),
    }
    run.updated_at = utc_now()
    session.add(run)
    session.commit()
    for finding in created_findings:
        session.refresh(finding)

    return AgentRunRead(
        run_id=run_id,
        agents_run=summaries,
        findings_created=len(created_findings),
        findings=created_findings,
    )


def _get_context_profile(
    session: Session,
    *,
    ai_system_id: UUID,
) -> ApplicationContextProfile | None:
    return session.exec(
        select(ApplicationContextProfile).where(
            ApplicationContextProfile.ai_system_id == ai_system_id
        )
    ).one_or_none()


def _list_capabilities(
    session: Session,
    *,
    ai_system_id: UUID,
) -> list[AISystemCapability]:
    return list(
        session.exec(
            select(AISystemCapability).where(AISystemCapability.ai_system_id == ai_system_id)
        ).all()
    )


def _list_evidence(session: Session, *, run_id: UUID) -> list[EvidenceRecord]:
    return list(session.exec(select(EvidenceRecord).where(EvidenceRecord.run_id == run_id)).all())


def _list_metric_results(session: Session, *, run_id: UUID) -> list[MetricResult]:
    return list(session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all())


def _list_findings(session: Session, *, run_id: UUID) -> list[Finding]:
    return list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())
