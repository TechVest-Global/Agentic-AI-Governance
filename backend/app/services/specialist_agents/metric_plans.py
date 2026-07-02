from uuid import UUID

from sqlmodel import Session, select

from app.models.ai_system import AISystem, AISystemCapability
from app.models.config import FrameworkMapping, MetricConfig
from app.schemas.governance import MetricPlanControl, MetricPlanItem, MetricPlanRead
from app.services.run_validation import get_run_or_raise


def build_metric_plan(session: Session, *, run_id: UUID) -> MetricPlanRead:
    run = get_run_or_raise(session, run_id)
    ai_system = session.get(AISystem, run.ai_system_id)
    capability_types = set(
        session.exec(
            select(AISystemCapability.capability_type).where(
                AISystemCapability.ai_system_id == run.ai_system_id,
                AISystemCapability.enabled == True,  # noqa: E712
            )
        ).all()
    )
    enabled_metrics = list(
        session.exec(
            select(MetricConfig)
            .where(MetricConfig.enabled == True)  # noqa: E712
            .order_by(MetricConfig.metric_id.asc())
        ).all()
    )
    enabled_mappings = list(
        session.exec(
            select(FrameworkMapping)
            .where(FrameworkMapping.enabled == True)  # noqa: E712
            .order_by(FrameworkMapping.control_ref.asc())
        ).all()
    )

    mappings = _filter_mappings_for_run(
        mappings=enabled_mappings,
        selected_frameworks=run.selected_frameworks,
    )
    metric_ids = _resolve_metric_ids(
        selected_metrics=run.selected_metrics,
        mappings=mappings,
    )
    metrics = _filter_metrics_for_run(
        metrics=enabled_metrics,
        metric_ids=metric_ids,
        selected_metrics=run.selected_metrics,
        selected_frameworks=run.selected_frameworks,
    )
    # System-context hard floor: a metric that declares applicability
    # requirements only applies to systems whose capabilities/modality
    # actually satisfy them. Explicit selected_metrics always bypasses this —
    # the user asked for it by name, so we respect that intent even if the
    # system's declared capabilities don't (yet) reflect it.
    if not run.selected_metrics:
        metrics = [
            metric
            for metric in metrics
            if _metric_applies_to_system(
                metric, ai_system=ai_system, capability_types=capability_types
            )
        ]
    metric_items = [
        _build_metric_plan_item(metric=metric, mappings=mappings) for metric in metrics
    ]

    return MetricPlanRead(
        run_id=run.id,
        ai_system_id=run.ai_system_id,
        selected_frameworks=run.selected_frameworks,
        selected_metrics=run.selected_metrics,
        metric_count=len(metric_items),
        control_count=sum(len(item.controls) for item in metric_items),
        metrics=metric_items,
    )


def _filter_mappings_for_run(
    *,
    mappings: list[FrameworkMapping],
    selected_frameworks: list[str],
) -> list[FrameworkMapping]:
    if not selected_frameworks:
        return mappings
    return [
        mapping
        for mapping in mappings
        if mapping.framework_id in selected_frameworks
    ]


def _resolve_metric_ids(
    *,
    selected_metrics: list[str],
    mappings: list[FrameworkMapping],
) -> set[str] | None:
    if selected_metrics:
        return set(selected_metrics)

    mapped_metric_ids = {
        metric_id
        for mapping in mappings
        for metric_id in mapping.metric_ids
    }
    return mapped_metric_ids or None


def _filter_metrics_for_run(
    *,
    metrics: list[MetricConfig],
    metric_ids: set[str] | None,
    selected_metrics: list[str],
    selected_frameworks: list[str],
) -> list[MetricConfig]:
    filtered_metrics = metrics
    if metric_ids is not None:
        filtered_metrics = [
            metric for metric in filtered_metrics if metric.metric_id in metric_ids
        ]
    if selected_frameworks and not selected_metrics:
        filtered_metrics = [
            metric
            for metric in filtered_metrics
            if set(metric.framework_ids).intersection(selected_frameworks)
        ]
    return filtered_metrics


def _metric_applies_to_system(
    metric: MetricConfig,
    *,
    ai_system: AISystem | None,
    capability_types: set[str],
) -> bool:
    if metric.applicable_capability_types and not capability_types.intersection(
        metric.applicable_capability_types
    ):
        return False
    if (
        metric.applicable_modalities
        and ai_system is not None
        and ai_system.modality not in metric.applicable_modalities
    ):
        return False
    return True


def _build_metric_plan_item(
    *,
    metric: MetricConfig,
    mappings: list[FrameworkMapping],
) -> MetricPlanItem:
    controls = [
        MetricPlanControl(
            framework_id=mapping.framework_id,
            framework_name=mapping.framework_name,
            framework_version=mapping.framework_version,
            control_ref=mapping.control_ref,
            control_title=mapping.control_title,
            control_category=mapping.control_category,
            jurisdiction=mapping.jurisdiction,
            evidence_requirements=mapping.evidence_requirements,
            agent_names=mapping.agent_names,
            risk_tiers=mapping.risk_tiers,
        )
        for mapping in mappings
        if metric.metric_id in mapping.metric_ids
    ]
    threshold = _extract_threshold(metric.threshold_rules)
    return MetricPlanItem(
        metric_config_id=metric.id,
        metric_id=metric.metric_id,
        name=metric.name,
        description=metric.description,
        dimension=metric.dimension,
        primary_agent=metric.primary_agent,
        tool_name=metric.tool_name,
        framework_ids=metric.framework_ids,
        modality=metric.modality,
        threshold_rules=metric.threshold_rules,
        scoring_config=metric.scoring_config,
        version=metric.version,
        enabled=metric.enabled,
        threshold=threshold,
        controls=controls,
    )


def _extract_threshold(threshold_rules: dict) -> float | None:
    for key in ("minimum", "medium_risk_minimum", "high_risk_minimum"):
        value = threshold_rules.get(key)
        if isinstance(value, int | float):
            return float(value)
    return None
