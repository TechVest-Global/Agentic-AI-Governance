from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
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
    GovernancePipelineRunRead,
    GovernanceReportRead,
    MetricExecutionCreate,
    MetricExecutionRead,
    MetricPlanRead,
)
from app.services import (
    adaptive_orchestrator,
    context_assembly,
    framework_maps,
    metric_execution,
    metric_plans,
    orchestration,
    reports,
)
from app.services import evaluation_runs as service

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


@router.post("/{run_id}/orchestrate", response_model=GovernancePipelineRunRead)
def run_governance_pipeline(
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
    session: SessionDependency,
) -> GovernancePipelineRunRead:
    return orchestration.run_governance_pipeline(session, run_id=run_id, payload=payload)


@router.post(
    "/{run_id}/metrics/run",
    response_model=MetricExecutionRead,
    status_code=status.HTTP_201_CREATED,
)
def run_mock_metrics(
    run_id: UUID,
    payload: MetricExecutionCreate,
    session: SessionDependency,
) -> MetricExecutionRead:
    return metric_execution.run_mock_metrics(session, run_id=run_id, payload=payload)
