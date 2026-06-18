from uuid import UUID

from sqlmodel import Session

from app.schemas.governance import (
    AgentRunCreate,
    CouncilDeliberationCreate,
    GovernancePipelineRunCreate,
    GovernancePipelineRunRead,
    MetricExecutionCreate,
)
from app.services import agent_execution, council, metric_execution, reports
from app.services.run_validation import get_run_or_raise


def run_governance_pipeline(
    session: Session,
    *,
    run_id: UUID,
    payload: GovernancePipelineRunCreate,
) -> GovernancePipelineRunRead:
    get_run_or_raise(session, run_id)

    metric_result = metric_execution.run_mock_metrics(
        session,
        run_id=run_id,
        payload=MetricExecutionCreate(
            mock_score=payload.mock_score,
            force_status=payload.force_metric_status,
            source_name=payload.source_name,
        ),
    )
    agent_result = agent_execution.run_agents(
        session,
        run_id=run_id,
        payload=AgentRunCreate(agent_names=payload.agent_names),
    )
    council_result = council.deliberate(
        session,
        run_id=run_id,
        payload=CouncilDeliberationCreate(
            requested_by=payload.requested_by,
            notes=payload.notes,
        ),
    )
    report = reports.build_governance_report(session, run_id=run_id)

    return GovernancePipelineRunRead(
        run_id=run_id,
        metric_execution=metric_result,
        agent_run=agent_result,
        council=council_result,
        report=report,
    )
