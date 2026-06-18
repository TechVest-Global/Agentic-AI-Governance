from uuid import UUID

from sqlmodel import Session, select

from app.configs.defaults import DEFAULT_FRAMEWORK_MAPPINGS, DEFAULT_METRIC_CONFIGS
from app.core.exceptions import ResourceConflictError, ResourceNotFoundError
from app.models.config import FrameworkMapping, MetricConfig
from app.schemas.governance import (
    FrameworkMappingCreate,
    GovernanceConfigBootstrapRead,
    MetricConfigCreate,
)


def create_metric_config(
    session: Session,
    payload: MetricConfigCreate,
) -> MetricConfig:
    duplicate_statement = select(MetricConfig).where(
        MetricConfig.metric_id == payload.metric_id,
        MetricConfig.version == payload.version,
    )
    if session.exec(duplicate_statement).first() is not None:
        raise ResourceConflictError(
            "Metric config",
            "metric_id/version",
            f"{payload.metric_id}/{payload.version}",
        )

    metric_config = MetricConfig(**payload.model_dump())
    session.add(metric_config)
    session.commit()
    session.refresh(metric_config)
    return metric_config


def list_metric_configs(
    session: Session,
    *,
    offset: int,
    limit: int,
    framework_id: str | None = None,
    dimension: str | None = None,
    primary_agent: str | None = None,
    tool_name: str | None = None,
    modality: str | None = None,
    enabled: bool | None = True,
) -> list[MetricConfig]:
    statement = select(MetricConfig)
    if dimension is not None:
        statement = statement.where(MetricConfig.dimension == dimension)
    if primary_agent is not None:
        statement = statement.where(MetricConfig.primary_agent == primary_agent)
    if tool_name is not None:
        statement = statement.where(MetricConfig.tool_name == tool_name)
    if modality is not None:
        statement = statement.where(MetricConfig.modality == modality)
    if enabled is not None:
        statement = statement.where(MetricConfig.enabled == enabled)

    metrics = list(session.exec(statement.order_by(MetricConfig.metric_id.asc())).all())
    if framework_id is not None:
        metrics = [
            metric for metric in metrics if framework_id in metric.framework_ids
        ]
    return metrics[offset : offset + limit]


def get_metric_config(session: Session, metric_config_id: UUID) -> MetricConfig:
    metric_config = session.get(MetricConfig, metric_config_id)
    if metric_config is None:
        raise ResourceNotFoundError("Metric config", str(metric_config_id))
    return metric_config


def create_framework_mapping(
    session: Session,
    payload: FrameworkMappingCreate,
) -> FrameworkMapping:
    duplicate_statement = select(FrameworkMapping).where(
        FrameworkMapping.framework_id == payload.framework_id,
        FrameworkMapping.framework_version == payload.framework_version,
        FrameworkMapping.control_ref == payload.control_ref,
    )
    if session.exec(duplicate_statement).first() is not None:
        raise ResourceConflictError(
            "Framework mapping",
            "framework/control",
            (
                f"{payload.framework_id}/"
                f"{payload.framework_version}/"
                f"{payload.control_ref}"
            ),
        )

    mapping = FrameworkMapping(**payload.model_dump())
    session.add(mapping)
    session.commit()
    session.refresh(mapping)
    return mapping


def list_framework_mappings(
    session: Session,
    *,
    offset: int,
    limit: int,
    framework_id: str | None = None,
    framework_version: str | None = None,
    control_category: str | None = None,
    jurisdiction: str | None = None,
    risk_tier: str | None = None,
    metric_id: str | None = None,
    enabled: bool | None = True,
) -> list[FrameworkMapping]:
    statement = select(FrameworkMapping)
    if framework_id is not None:
        statement = statement.where(FrameworkMapping.framework_id == framework_id)
    if framework_version is not None:
        statement = statement.where(
            FrameworkMapping.framework_version == framework_version
        )
    if control_category is not None:
        statement = statement.where(
            FrameworkMapping.control_category == control_category
        )
    if jurisdiction is not None:
        statement = statement.where(FrameworkMapping.jurisdiction == jurisdiction)
    if enabled is not None:
        statement = statement.where(FrameworkMapping.enabled == enabled)

    mappings = list(
        session.exec(statement.order_by(FrameworkMapping.control_ref.asc())).all()
    )
    if risk_tier is not None:
        mappings = [
            mapping for mapping in mappings if risk_tier in mapping.risk_tiers
        ]
    if metric_id is not None:
        mappings = [
            mapping for mapping in mappings if metric_id in mapping.metric_ids
        ]
    return mappings[offset : offset + limit]


def get_framework_mapping(
    session: Session,
    framework_mapping_id: UUID,
) -> FrameworkMapping:
    mapping = session.get(FrameworkMapping, framework_mapping_id)
    if mapping is None:
        raise ResourceNotFoundError("Framework mapping", str(framework_mapping_id))
    return mapping


def bootstrap_default_governance_configs(
    session: Session,
) -> GovernanceConfigBootstrapRead:
    metric_ids_created: list[str] = []
    metric_ids_skipped: list[str] = []
    control_refs_created: list[str] = []
    control_refs_skipped: list[str] = []

    for payload in DEFAULT_METRIC_CONFIGS:
        existing_metric = session.exec(
            select(MetricConfig).where(
                MetricConfig.metric_id == payload.metric_id,
                MetricConfig.version == payload.version,
            )
        ).first()
        if existing_metric is not None:
            metric_ids_skipped.append(payload.metric_id)
            continue

        session.add(MetricConfig(**payload.model_dump()))
        metric_ids_created.append(payload.metric_id)

    for payload in DEFAULT_FRAMEWORK_MAPPINGS:
        existing_mapping = session.exec(
            select(FrameworkMapping).where(
                FrameworkMapping.framework_id == payload.framework_id,
                FrameworkMapping.framework_version == payload.framework_version,
                FrameworkMapping.control_ref == payload.control_ref,
            )
        ).first()
        control_key = (
            f"{payload.framework_id}/"
            f"{payload.framework_version}/"
            f"{payload.control_ref}"
        )
        if existing_mapping is not None:
            control_refs_skipped.append(control_key)
            continue

        session.add(FrameworkMapping(**payload.model_dump()))
        control_refs_created.append(control_key)

    session.commit()
    return GovernanceConfigBootstrapRead(
        metrics_created=len(metric_ids_created),
        metrics_skipped=len(metric_ids_skipped),
        framework_mappings_created=len(control_refs_created),
        framework_mappings_skipped=len(control_refs_skipped),
        metric_ids_created=metric_ids_created,
        metric_ids_skipped=metric_ids_skipped,
        control_refs_created=control_refs_created,
        control_refs_skipped=control_refs_skipped,
    )
