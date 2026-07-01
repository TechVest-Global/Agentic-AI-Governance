from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.governance import (
    FrameworkMappingCreate,
    FrameworkMappingRead,
    GovernanceConfigBootstrapRead,
    MetricConfigCreate,
    MetricConfigRead,
)
from app.services import configs as service

router = APIRouter()
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/governance-config/bootstrap", response_model=GovernanceConfigBootstrapRead)
def bootstrap_default_governance_configs(
    session: SessionDependency,
) -> GovernanceConfigBootstrapRead:
    return service.bootstrap_default_governance_configs(session)


@router.post(
    "/metrics",
    response_model=MetricConfigRead,
    status_code=status.HTTP_201_CREATED,
)
def create_metric_config(
    payload: MetricConfigCreate,
    session: SessionDependency,
) -> MetricConfigRead:
    return service.create_metric_config(session, payload)


@router.get("/metrics", response_model=list[MetricConfigRead])
def list_metric_configs(
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    framework_id: str | None = None,
    dimension: str | None = None,
    primary_agent: str | None = None,
    tool_name: str | None = None,
    modality: str | None = None,
    enabled: bool | None = True,
) -> list[MetricConfigRead]:
    return service.list_metric_configs(
        session,
        offset=offset,
        limit=limit,
        framework_id=framework_id,
        dimension=dimension,
        primary_agent=primary_agent,
        tool_name=tool_name,
        modality=modality,
        enabled=enabled,
    )


@router.get("/metrics/{metric_config_id}", response_model=MetricConfigRead)
def get_metric_config(
    metric_config_id: UUID,
    session: SessionDependency,
) -> MetricConfigRead:
    return service.get_metric_config(session, metric_config_id)


@router.post(
    "/framework-mappings",
    response_model=FrameworkMappingRead,
    status_code=status.HTTP_201_CREATED,
)
def create_framework_mapping(
    payload: FrameworkMappingCreate,
    session: SessionDependency,
) -> FrameworkMappingRead:
    return service.create_framework_mapping(session, payload)


@router.get("/framework-mappings", response_model=list[FrameworkMappingRead])
def list_framework_mappings(
    session: SessionDependency,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    framework_id: str | None = None,
    framework_version: str | None = None,
    control_category: str | None = None,
    jurisdiction: str | None = None,
    risk_tier: str | None = None,
    metric_id: str | None = None,
    enabled: bool | None = True,
) -> list[FrameworkMappingRead]:
    return service.list_framework_mappings(
        session,
        offset=offset,
        limit=limit,
        framework_id=framework_id,
        framework_version=framework_version,
        control_category=control_category,
        jurisdiction=jurisdiction,
        risk_tier=risk_tier,
        metric_id=metric_id,
        enabled=enabled,
    )


@router.get(
    "/framework-mappings/{framework_mapping_id}",
    response_model=FrameworkMappingRead,
)
def get_framework_mapping(
    framework_mapping_id: UUID,
    session: SessionDependency,
) -> FrameworkMappingRead:
    return service.get_framework_mapping(session, framework_mapping_id)
