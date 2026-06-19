"""Regulatory ingester (Layer 1, task P012).

Resolves the run's selected frameworks into structured regulatory context:
database-backed control chunks (from ``FrameworkMapping`` seeds) joined with
config-backed knowledge (rubrics, severity thresholds, probe templates, and the
citation format) from ``app.configs.frameworks``.

A framework that has neither seeded controls nor a knowledge record is reported
in ``missing_frameworks`` instead of failing the run, so callers get a clear,
actionable signal about misconfigured framework selections.
"""

from collections import defaultdict
from collections.abc import Iterable

from sqlmodel import Session, select

from app.configs.frameworks.base import DEFAULT_CITATION_FORMAT, FrameworkKnowledge
from app.configs.frameworks.registry import get_framework_knowledge
from app.models.config import FrameworkMapping
from app.schemas.governance import (
    RegulatoryContextRead,
    RegulatoryControlChunk,
    RegulatoryFrameworkContext,
    RegulatoryProbeTemplateRead,
    RegulatoryRubricItemRead,
)


def _dedupe_preserving_order(values: Iterable[str]) -> list[str]:
    cleaned = (value.strip() for value in values)
    return list(dict.fromkeys(value for value in cleaned if value))


def _citation(citation_format: str, mapping: FrameworkMapping) -> str:
    return citation_format.format(
        framework_id=mapping.framework_id,
        framework_version=mapping.framework_version,
        control_ref=mapping.control_ref,
    )


def _build_control_chunk(
    *,
    mapping: FrameworkMapping,
    citation_format: str,
) -> RegulatoryControlChunk:
    return RegulatoryControlChunk(
        framework_id=mapping.framework_id,
        framework_name=mapping.framework_name,
        framework_version=mapping.framework_version,
        control_ref=mapping.control_ref,
        citation=_citation(citation_format, mapping),
        control_title=mapping.control_title,
        control_category=mapping.control_category,
        jurisdiction=mapping.jurisdiction,
        requirement_text=mapping.requirement_text,
        metric_ids=list(mapping.metric_ids),
        agent_names=list(mapping.agent_names),
        risk_tiers=list(mapping.risk_tiers),
        evidence_requirements=list(mapping.evidence_requirements),
    )


def _build_framework_context(
    *,
    framework_id: str,
    mappings: list[FrameworkMapping],
    knowledge: FrameworkKnowledge | None,
) -> RegulatoryFrameworkContext:
    citation_format = knowledge.citation_format if knowledge else DEFAULT_CITATION_FORMAT
    ordered_mappings = sorted(mappings, key=lambda mapping: mapping.control_ref)
    controls = [
        _build_control_chunk(mapping=mapping, citation_format=citation_format)
        for mapping in ordered_mappings
    ]

    # Framework name/version come from the seeded controls when present, otherwise
    # from the knowledge record (for knowledge-only frameworks).
    if ordered_mappings:
        framework_name = ordered_mappings[0].framework_name
        framework_version = ordered_mappings[0].framework_version
    elif knowledge is not None:
        framework_name = knowledge.framework_name
        framework_version = knowledge.framework_version
    else:  # pragma: no cover - guarded by the caller (resolved vs missing).
        framework_name = framework_id
        framework_version = "unknown"

    rubric = [
        RegulatoryRubricItemRead(
            rubric_id=item.rubric_id,
            dimension=item.dimension,
            description=item.description,
            scoring_guidance=item.scoring_guidance,
        )
        for item in (knowledge.rubric if knowledge else ())
    ]
    probe_templates = [
        RegulatoryProbeTemplateRead(
            probe_id=template.probe_id,
            dimension=template.dimension,
            description=template.description,
            prompt_template=template.prompt_template,
            control_refs=list(template.control_refs),
        )
        for template in (knowledge.probe_templates if knowledge else ())
    ]

    return RegulatoryFrameworkContext(
        framework_id=framework_id,
        framework_name=framework_name,
        framework_version=framework_version,
        citation_format=citation_format,
        severity_thresholds=dict(knowledge.severity_thresholds) if knowledge else {},
        control_count=len(controls),
        controls=controls,
        rubric=rubric,
        probe_templates=probe_templates,
    )


def ingest_regulations(
    session: Session,
    *,
    selected_frameworks: list[str],
) -> RegulatoryContextRead:
    enabled_mappings = list(
        session.exec(
            select(FrameworkMapping)
            .where(FrameworkMapping.enabled == True)  # noqa: E712
            .order_by(FrameworkMapping.control_ref.asc())
        ).all()
    )
    mappings_by_framework: dict[str, list[FrameworkMapping]] = defaultdict(list)
    for mapping in enabled_mappings:
        mappings_by_framework[mapping.framework_id].append(mapping)

    requested = _dedupe_preserving_order(selected_frameworks)
    # With no explicit selection, fall back to every framework that has controls.
    target_frameworks = requested or sorted(mappings_by_framework)

    resolved: list[str] = []
    missing: list[str] = []
    framework_contexts: list[RegulatoryFrameworkContext] = []

    for framework_id in target_frameworks:
        knowledge = get_framework_knowledge(framework_id)
        mappings = mappings_by_framework.get(framework_id, [])
        if not mappings and knowledge is None:
            missing.append(framework_id)
            continue
        resolved.append(framework_id)
        framework_contexts.append(
            _build_framework_context(
                framework_id=framework_id,
                mappings=mappings,
                knowledge=knowledge,
            )
        )

    return RegulatoryContextRead(
        selected_frameworks=requested,
        resolved_frameworks=resolved,
        missing_frameworks=missing,
        control_count=sum(context.control_count for context in framework_contexts),
        frameworks=framework_contexts,
    )
