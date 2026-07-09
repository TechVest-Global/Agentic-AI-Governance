from uuid import UUID

from sqlmodel import Session, select

from app.models.agent import AgentExecution
from app.models.ai_system import AISystem, AISystemCapability, ApplicationContextProfile
from app.models.base import utc_now
from app.models.enums import AgentExecutionStatus, RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import AgentRunCreate, AgentRunRead, AgentRunSummary, EvaluationPlanRead
from app.services.agents.base import AgentContext
from app.services.agents.registry import select_agents
from app.services.model_clients.gateway import (
    drain_log_capture,
    set_current_agent,
    start_log_capture,
)
from app.services.model_clients.registry import get_target_model_client_for_system
from app.services.run_validation import get_run_or_raise
from app.services.specialist_agents.metric_plans import build_metric_plan


def run_agents(
    session: Session,
    *,
    run_id: UUID,
    payload: AgentRunCreate,
    evaluation_plan: EvaluationPlanRead | None = None,
    probe_budget_override: int | None = None,
) -> AgentRunRead:
    run = get_run_or_raise(session, run_id)
    # Enter the specialist-agents phase up front and commit, so a client polling
    # the run / streaming SSE sees "Specialist Agents" become active while the
    # (slow, real-target) agents run — instead of the phase only flipping after
    # every agent finishes.
    run.status = RunStatus.agents_running
    run.current_phase = RunPhase.specialist_agents
    run.updated_at = utc_now()
    session.add(run)
    session.commit()

    start_log_capture()
    ai_system = session.get(AISystem, run.ai_system_id)
    if probe_budget_override is not None:
        # Mid-council re_probe remediation needs a *bit* more sample size, not
        # a full plan-scaled re-run (which could be up to 100 probes/agent) —
        # cap it explicitly regardless of what the evaluation plan allocated.
        probe_budgets = {name: probe_budget_override for name in (payload.agent_names or [])}
    elif evaluation_plan is not None:
        probe_budgets = {
            item.agent_name: item.probe_budget for item in evaluation_plan.activated_agents
        }
    else:
        probe_budgets = {}
    context = AgentContext(
        ai_system=ai_system,
        context_profile=_get_context_profile(session, ai_system_id=run.ai_system_id),
        capabilities=_list_capabilities(session, ai_system_id=run.ai_system_id),
        evidence=_list_evidence(session, run_id=run_id),
        metric_results=_list_metric_results(session, run_id=run_id),
        existing_findings=_list_findings(session, run_id=run_id),
        prior_metric_scores=_get_prior_metric_scores(
            session, ai_system_id=run.ai_system_id, current_run_id=run_id
        ),
        probe_budgets=probe_budgets,
        metric_plan_items=build_metric_plan(session, run_id=run_id).metrics,
        session=session,
        target_client=get_target_model_client_for_system(ai_system),
        probe_counts={},
        selected_capabilities=list(run.selected_capabilities or []),
    )

    created_findings: list[Finding] = []
    summaries: list[AgentRunSummary] = []
    executions: list[AgentExecution] = []
    failed_execution_count = 0
    for agent in select_agents(payload.agent_names):
        execution = AgentExecution(
            run_id=run_id,
            agent_name=agent.name,
            status=AgentExecutionStatus.running,
            started_at=utc_now(),
            metadata_json={
                "execution_mode": getattr(agent, "execution_mode", "deterministic"),
                "selected_by_request": payload.agent_names is not None,
            },
        )
        session.add(execution)
        # Attribute every LLM call this agent makes (probes + governance reasoning)
        # to the agent, so the UI can show each agent only its own transcript.
        set_current_agent(agent.name)
        try:
            finding_payloads = agent.evaluate(context)
        except Exception as exc:  # noqa: BLE001
            execution.status = AgentExecutionStatus.failed
            execution.error_summary = {
                "error_type": exc.__class__.__name__,
                "message": str(exc),
            }
            failed_execution_count += 1
        else:
            execution.status = AgentExecutionStatus.completed
            execution.finding_count = len(finding_payloads)
            for finding_payload in finding_payloads:
                finding = Finding(run_id=run_id, **finding_payload.model_dump())
                session.add(finding)
                created_findings.append(finding)
        finally:
            set_current_agent(None)
        # Persist the real probe count (set by the agent during evaluate) so the
        # SSE progress stream can report a live "Probes Sent" total. Runs even on
        # failure so partial probing is still counted.
        execution.metadata_json = {
            **(execution.metadata_json or {}),
            "probe_count": context.probe_counts.get(agent.name, 0),
        }
        execution.completed_at = utc_now()
        execution.updated_at = utc_now()
        executions.append(execution)
        summaries.append(_execution_summary(execution))

    run.status = RunStatus.degraded if failed_execution_count else RunStatus.agents_running
    run.current_phase = RunPhase.specialist_agents
    run.result_summary = {
        **(run.result_summary or {}),
        "agents_run": [summary.model_dump(mode="json") for summary in summaries],
        "agent_executions_failed": failed_execution_count,
        "agent_findings_created": len(created_findings),
        "agents_completed_at": utc_now().isoformat(),
    }
    run.updated_at = utc_now()
    session.add(run)
    for entry in drain_log_capture():
        session.add(LLMCallLog(run_id=run_id, **entry))
    session.commit()
    for finding in created_findings:
        session.refresh(finding)
    for execution in executions:
        session.refresh(execution)

    return AgentRunRead(
        run_id=run_id,
        agents_run=summaries,
        executions=executions,
        findings_created=len(created_findings),
        findings=created_findings,
    )


def list_agent_executions(session: Session, *, run_id: UUID) -> list[AgentExecution]:
    get_run_or_raise(session, run_id)
    return list(
        session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .order_by(AgentExecution.created_at.asc())
        ).all()
    )


def _execution_summary(execution: AgentExecution) -> AgentRunSummary:
    return AgentRunSummary(
        id=execution.id,
        agent_name=execution.agent_name,
        finding_count=execution.finding_count,
        status=execution.status,
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


def _get_prior_metric_scores(
    session: Session,
    *,
    ai_system_id: UUID,
    current_run_id: UUID,
) -> dict[str, float | None]:
    """Return metric_id -> normalized_score from the most recent completed run for this system."""
    prior_run = session.exec(
        select(EvaluationRun)
        .where(EvaluationRun.ai_system_id == ai_system_id)
        .where(EvaluationRun.id != current_run_id)
        .where(EvaluationRun.status.in_(["completed", "report_ready"]))
        .order_by(EvaluationRun.completed_at.desc())
    ).first()

    if prior_run is None:
        return {}

    prior_metrics = session.exec(
        select(MetricResult).where(MetricResult.run_id == prior_run.id)
    ).all()

    return {m.metric_id: m.normalized_score for m in prior_metrics}
