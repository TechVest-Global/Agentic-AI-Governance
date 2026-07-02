import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.db.session import get_session
from app.models.agent import AgentExecution
from app.models.base import utc_now
from app.models.enums import RunPhase, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.finding import Finding
from app.schemas.governance import (
    ContextAssemblyCreate,
    ContextAssemblyRead,
    EvaluationPlanCreate,
    EvaluationPlanRead,
    EvaluationRunCancel,
    EvaluationRunComplete,
    EvaluationRunCreate,
    EvaluationRunFail,
    EvaluationRunRead,
    EvaluationRunStart,
    FrameworkComplianceMapRead,
    GovernancePipelineRunCreate,
    GovernanceReportRead,
    LLMCallLogSummary,
    MetricExecutionCreate,
    MetricExecutionRead,
    MetricPlanRead,
)
from app.services import (
    adaptive_orchestrator,
    context_assembly,
    orchestration,
)
from app.services import evaluation_runs as service
from app.services.action_reporting import framework_maps, reports
from app.services.llm_gateway import call_log as llm_call_log_service
from app.services.specialist_agents import metric_execution, metric_plans

router = APIRouter(prefix="/evaluation-runs")
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=EvaluationRunRead, status_code=status.HTTP_201_CREATED)
def create_evaluation_run(
    payload: EvaluationRunCreate,
    session: SessionDependency,
) -> EvaluationRunRead:
    return service.create_evaluation_run(session, payload)


@router.get("", response_model=list[EvaluationRunRead])
def list_evaluation_runs(
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ai_system_id: UUID | None = None,
) -> list[EvaluationRunRead]:
    return service.list_evaluation_runs(
        session,
        offset=offset,
        limit=limit,
        ai_system_id=ai_system_id,
    )


@router.get("/{run_id}", response_model=EvaluationRunRead)
def get_evaluation_run(run_id: UUID, session: SessionDependency) -> EvaluationRunRead:
    return service.get_evaluation_run(session, run_id)


@router.post("/{run_id}/start", response_model=EvaluationRunRead)
def start_evaluation_run(
    run_id: UUID,
    payload: EvaluationRunStart,
    session: SessionDependency,
) -> EvaluationRunRead:
    return service.start_evaluation_run(session, run_id=run_id, payload=payload)


@router.post("/{run_id}/complete", response_model=EvaluationRunRead)
def complete_evaluation_run(
    run_id: UUID,
    payload: EvaluationRunComplete,
    session: SessionDependency,
) -> EvaluationRunRead:
    return service.complete_evaluation_run(session, run_id=run_id, payload=payload)


@router.post("/{run_id}/fail", response_model=EvaluationRunRead)
def fail_evaluation_run(
    run_id: UUID,
    payload: EvaluationRunFail,
    session: SessionDependency,
) -> EvaluationRunRead:
    return service.fail_evaluation_run(session, run_id=run_id, payload=payload)


@router.post("/{run_id}/cancel", response_model=EvaluationRunRead)
def cancel_evaluation_run(
    run_id: UUID,
    payload: EvaluationRunCancel,
    session: SessionDependency,
) -> EvaluationRunRead:
    return service.cancel_evaluation_run(session, run_id=run_id, payload=payload)


@router.post(
    "/{run_id}/context-assembly",
    response_model=ContextAssemblyRead,
    status_code=status.HTTP_201_CREATED,
)
def assemble_run_context(
    run_id: UUID,
    payload: ContextAssemblyCreate,
    session: SessionDependency,
) -> ContextAssemblyRead:
    return context_assembly.assemble_context(session, run_id=run_id, payload=payload)


@router.get("/{run_id}/context-assembly", response_model=ContextAssemblyRead)
def get_run_context(run_id: UUID, session: SessionDependency) -> ContextAssemblyRead:
    return context_assembly.get_latest_context(session, run_id=run_id)


@router.post(
    "/{run_id}/evaluation-plan",
    response_model=EvaluationPlanRead,
    status_code=status.HTTP_201_CREATED,
)
def prepare_evaluation_plan(
    run_id: UUID,
    payload: EvaluationPlanCreate,
    session: SessionDependency,
) -> EvaluationPlanRead:
    return adaptive_orchestrator.prepare_evaluation_plan(
        session, run_id=run_id, payload=payload
    )


@router.get("/{run_id}/evaluation-plan", response_model=EvaluationPlanRead)
def get_evaluation_plan(run_id: UUID, session: SessionDependency) -> EvaluationPlanRead:
    return adaptive_orchestrator.get_latest_plan(session, run_id=run_id)


@router.get("/{run_id}/metric-plan", response_model=MetricPlanRead)
def get_metric_plan(run_id: UUID, session: SessionDependency) -> MetricPlanRead:
    return metric_plans.build_metric_plan(session, run_id=run_id)


@router.get("/{run_id}/report", response_model=GovernanceReportRead)
def get_governance_report(
    run_id: UUID,
    session: SessionDependency,
) -> GovernanceReportRead:
    return reports.build_governance_report(session, run_id=run_id)


@router.get("/{run_id}/framework-map", response_model=FrameworkComplianceMapRead)
def get_framework_compliance_map(
    run_id: UUID,
    session: SessionDependency,
) -> FrameworkComplianceMapRead:
    return framework_maps.build_framework_compliance_map(session, run_id=run_id)


@router.post("/{run_id}/orchestrate", status_code=status.HTTP_202_ACCEPTED)
def run_governance_pipeline(
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> dict:
    """Kick off the governance pipeline in the background and return 202.

    The pipeline is long-running (target probes + judge LLM calls per metric).
    Running it inline blocked the request for its full duration, left the run at
    a non-terminal status, and prevented the Live Run view from showing phase
    progression. We now advance the run out of 'created' synchronously, then run
    the pipeline off the request thread so clients observe each phase via
    GET /{id} polling or the /progress/stream SSE endpoint.
    """
    run = service.get_evaluation_run(session, run_id)
    # Move out of 'created' immediately so the Live Run view stops showing
    # "Run Setup" the instant orchestration is requested.
    if run.current_phase == RunPhase.created:
        run.status = RunStatus.context_assembly
        run.current_phase = RunPhase.context_assembly
        run.started_at = run.started_at or utc_now()
        run.updated_at = utc_now()
        session.add(run)
        session.commit()

    background_tasks.add_task(
        orchestration.run_governance_pipeline_job, run_id, payload
    )
    return {"run_id": str(run_id), "status": "accepted"}


@router.post(
    "/{run_id}/metrics/run",
    response_model=MetricExecutionRead,
    status_code=status.HTTP_201_CREATED,
)
def run_metrics(
    run_id: UUID,
    payload: MetricExecutionCreate,
    session: SessionDependency,
) -> MetricExecutionRead:
    return metric_execution.run_metrics(session, run_id=run_id, payload=payload)


@router.get("/{run_id}/llm-calls", response_model=LLMCallLogSummary)
def get_llm_call_logs(
    run_id: UUID,
    session: SessionDependency,
) -> LLMCallLogSummary:
    return llm_call_log_service.get_llm_call_log_summary(session, run_id=run_id)


@router.get("/{run_id}/progress/stream")
async def stream_run_progress(
    run_id: UUID,
    session: SessionDependency,
) -> StreamingResponse:
    """SSE endpoint — emits a progress snapshot every 2 s until the run is terminal."""

    async def event_generator() -> AsyncGenerator[str, None]:
        terminal = {"completed", "failed", "cancelled"}
        while True:
            run = session.get(EvaluationRun, run_id)
            if run is None:
                yield _sse({"error": "run not found"})
                break

            executions = list(
                session.exec(
                    select(AgentExecution)
                    .where(AgentExecution.run_id == run_id)
                    .order_by(AgentExecution.created_at.asc())
                ).all()
            )
            finding_count = session.exec(
                select(Finding).where(Finding.run_id == run_id)
            ).all()

            probe_count = sum(
                (e.metadata_json or {}).get("probe_count", 0)
                for e in executions
            )

            payload = {
                "run_id": str(run_id),
                "status": run.status,
                "current_phase": run.current_phase,
                "progress": _phase_progress(run.current_phase),
                "agents": [
                    {
                        "name": e.agent_name,
                        "status": e.status,
                        "finding_count": e.finding_count or 0,
                        "started_at": e.started_at.isoformat() if e.started_at else None,
                        "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                    }
                    for e in executions
                ],
                "probe_count": probe_count,
                "finding_count": len(finding_count),
                "result_summary": run.result_summary or {},
            }
            yield _sse(payload)

            if run.status in terminal:
                break

            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_PHASE_ORDER = [
    "created",
    "context_assembly",
    "adaptive_orchestrator",
    "metric_execution",
    "specialist_agents",
    "deliberation_council",
    "action_reporting",
    "completed",
]


def _phase_progress(phase: str | None) -> int:
    idx = _PHASE_ORDER.index(phase) if phase in _PHASE_ORDER else 0
    return round(((idx + 1) / len(_PHASE_ORDER)) * 100)
