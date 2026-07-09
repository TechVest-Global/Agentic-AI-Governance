"""Transactional AI-system registration.

Turns the nested registration payload into normalized fact rows in a single
atomic transaction. Developers supply facts; the backend derives the
*preliminary* risk tier (see ``risk_classification_service``) and keeps the
engine-facing fields (``AISystem.risk_tier``, ``selected_frameworks``, and one
``AISystemCapability`` per endpoint) valid so orchestration keeps working.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.configs.frameworks.registry import get_framework_knowledge
from app.core.exceptions import (
    ApplicationError,
    ResourceConflictError,
    ResourceNotFoundError,
)
from app.models.ai_system import (
    AISystem,
    AISystemAgentConfig,
    AISystemCapability,
    AISystemDataSource,
    AISystemDependency,
    AISystemDocument,
    AISystemEndpoint,
    AISystemFramework,
    AISystemModel,
    AISystemOwner,
    AISystemRAGConfig,
    AISystemRiskScreening,
    AISystemSecurityControlStatus,
    AISystemUsageContext,
    ApplicationContextProfile,
)
from app.models.enums import AISystemStatus, CapabilityType, SideEffectLevel
from app.schemas.governance import (
    AISystemRegistrationCreate,
    AISystemRegistrationRead,
    RegistrationEndpointInput,
    RegistrationModelInput,
    RegistrationOwnerInput,
)
from app.services import registration_config
from app.services.risk_classification_service import clamp_to_risk_tier, screen_risk

# Lifecycle stages / environments that require at least one endpoint on register.
_ENDPOINT_REQUIRED_STAGES = {"staging", "production"}

# Recommended-profile checklist used for the completeness score. Each entry is a
# (label, predicate) pair evaluated against the payload.
_RECOMMENDED_FIELDS: list[str] = [
    "version",
    "description",
    "business_purpose",
    "system_type",
    "business_domain",
    "lifecycle_stage",
    "primary_owner",
    "technical_owner",
    "intended_users",
    "output_usage",
    "human_oversight",
    "at_least_one_model",
    "at_least_one_endpoint",
    "at_least_one_framework",
    "risk_screening",
]


def _validation_error(message: str, missing: list[str] | None = None) -> ApplicationError:
    return ApplicationError(
        status_code=422,
        code="VALIDATION_ERROR",
        message=message,
        details={"missing_fields": missing} if missing else None,
    )


def _validate_catalog(name: str, value: str | None, *, field: str) -> None:
    if not value:
        return
    allowed = registration_config.catalog_values(name)
    if allowed and value not in allowed:
        raise _validation_error(f"Invalid value for {field}: '{value}'.")


def _find_owner(owners: list[RegistrationOwnerInput], role: str) -> RegistrationOwnerInput | None:
    for owner in owners:
        if owner.role == role:
            return owner
    return None


def _primary_owner(owners: list[RegistrationOwnerInput]) -> RegistrationOwnerInput | None:
    for owner in owners:
        if owner.is_primary:
            return owner
    return _find_owner(owners, "system_owner") or (owners[0] if owners else None)


def _canonical_framework_ids(frameworks: list) -> list[str]:
    """Validate framework ids against the knowledge registry; return canonical ids."""
    canonical: list[str] = []
    for entry in frameworks:
        knowledge = get_framework_knowledge(entry.framework_id)
        if knowledge is None:
            raise _validation_error(f"Unknown framework id: '{entry.framework_id}'.")
        canonical.append(knowledge.framework_id)
    return canonical


def _compute_completeness(payload: AISystemRegistrationCreate) -> tuple[float, list[str]]:
    system = payload.system
    usage = payload.usage_context
    primary = _primary_owner(payload.owners)
    technical = _find_owner(payload.owners, "technical_owner")
    present: dict[str, bool] = {
        "version": bool(system.version),
        "description": bool(system.description),
        "business_purpose": bool(system.business_purpose),
        "system_type": bool(system.system_type),
        "business_domain": bool(system.business_domain),
        "lifecycle_stage": bool(system.lifecycle_stage),
        "primary_owner": bool(primary and primary.name and primary.email),
        "technical_owner": bool(technical and technical.name and technical.email),
        "intended_users": bool(usage and usage.intended_users),
        "output_usage": bool(usage and usage.output_usage),
        "human_oversight": bool(usage and usage.human_oversight),
        "at_least_one_model": bool(payload.models),
        "at_least_one_endpoint": bool(payload.endpoints),
        "at_least_one_framework": bool(payload.frameworks),
        "risk_screening": bool(payload.risk_screening and payload.risk_screening.answers),
    }
    missing = [field for field in _RECOMMENDED_FIELDS if not present.get(field)]
    filled = len(_RECOMMENDED_FIELDS) - len(missing)
    pct = round(100.0 * filled / len(_RECOMMENDED_FIELDS), 1)
    return pct, missing


def _require_registered_fields(payload: AISystemRegistrationCreate) -> None:
    """Enforce the full required set for a ``registered`` (non-draft) submission."""
    system = payload.system
    usage = payload.usage_context
    primary = _primary_owner(payload.owners)
    technical = _find_owner(payload.owners, "technical_owner")
    checks: dict[str, bool] = {
        "name": bool(system.name),
        "version": bool(system.version),
        "description": bool(system.description),
        "business_purpose": bool(system.business_purpose),
        "system_type": bool(system.system_type),
        "business_domain": bool(system.business_domain),
        "lifecycle_stage": bool(system.lifecycle_stage),
        "deployment_environment": bool(system.deployment_environment),
        "primary_owner_name": bool(primary and primary.name),
        "primary_owner_email": bool(primary and primary.email),
        "technical_owner_name": bool(technical and technical.name),
        "technical_owner_email": bool(technical and technical.email),
        "intended_users": bool(usage and usage.intended_users),
        "output_usage": bool(usage and usage.output_usage),
        "human_oversight": bool(usage and usage.human_oversight),
        "at_least_one_model": bool(payload.models),
        "at_least_one_framework": bool(payload.frameworks),
        "risk_screening": bool(payload.risk_screening and payload.risk_screening.answers),
    }
    missing = [field for field, ok in checks.items() if not ok]
    if missing:
        raise _validation_error(
            "Registration is missing required fields.", missing=missing
        )

    stage = (system.lifecycle_stage or "").lower()
    env = (system.deployment_environment or "").lower()
    if (stage in _ENDPOINT_REQUIRED_STAGES or env == "production") and not payload.endpoints:
        raise _validation_error(
            "At least one target endpoint is required for staging/production systems.",
            missing=["at_least_one_endpoint"],
        )


def _validate_catalogs(payload: AISystemRegistrationCreate) -> None:
    system = payload.system
    _validate_catalog("system_type", system.system_type, field="system_type")
    _validate_catalog("business_domain", system.business_domain, field="business_domain")
    _validate_catalog("lifecycle_stage", system.lifecycle_stage, field="lifecycle_stage")
    _validate_catalog(
        "deployment_environment",
        system.deployment_environment,
        field="deployment_environment",
    )
    _validate_catalog(
        "production_criticality",
        system.production_criticality,
        field="production_criticality",
    )
    if payload.usage_context is not None:
        usage = payload.usage_context
        _validate_catalog(
            "internal_external_use", usage.internal_external_use, field="internal_external_use"
        )
        _validate_catalog("output_usage", usage.output_usage, field="output_usage")
        _validate_catalog("human_oversight", usage.human_oversight, field="human_oversight")
    for owner in payload.owners:
        _validate_catalog("owner_role", owner.role, field="owner role")
    for model in payload.models:
        _validate_catalog("model_provider", model.provider, field="model provider")
        _validate_catalog("model_type", model.model_type, field="model type")
    for endpoint in payload.endpoints:
        _validate_catalog("gateway_type", endpoint.gateway_type, field="gateway type")
        _validate_catalog(
            "authentication_type", endpoint.authentication_type, field="authentication type"
        )
        _validate_catalog("exposure_type", endpoint.exposure_type, field="exposure type")
    for ds in payload.data_sources:
        _validate_catalog("data_source_type", ds.source_type, field="data source type")
        _validate_catalog("data_classification", ds.classification, field="data classification")
        _validate_catalog("data_usage_purpose", ds.usage_purpose, field="data usage purpose")
    for control in payload.security_posture:
        _validate_catalog("security_control", control.control_key, field="security control")
        _validate_catalog(
            "security_status", control.implementation_status, field="security status"
        )
    for dep in payload.dependencies:
        _validate_catalog("dependency_type", dep.dependency_type, field="dependency type")
    for doc in payload.documents:
        _validate_catalog("document_type", doc.document_type, field="document type")
        _validate_catalog(
            "confidentiality_level", doc.confidentiality_level, field="confidentiality level"
        )


def _build_usage_context(
    system_id: UUID, payload: AISystemRegistrationCreate
) -> AISystemUsageContext:
    system = payload.system
    usage = payload.usage_context
    return AISystemUsageContext(
        ai_system_id=system_id,
        primary_use_case=usage.primary_use_case if usage else None,
        intended_users=usage.intended_users if usage else None,
        internal_external_use=usage.internal_external_use if usage else None,
        output_usage=usage.output_usage if usage else None,
        human_oversight=usage.human_oversight if usage else None,
        business_domain=system.business_domain,
        lifecycle_stage=system.lifecycle_stage,
        production_criticality=system.production_criticality,
        input_modalities=list(usage.input_modalities) if usage else [],
        output_types=list(usage.output_types) if usage else [],
        capabilities=list(usage.capabilities) if usage else [],
        metadata_json=dict(usage.metadata_json) if usage else {},
    )


def _prune(section: dict[str, object]) -> dict[str, object]:
    """Drop empty/None/[] values so seeded sections stay readable JSON."""
    return {
        k: v
        for k, v in section.items()
        if v is not None and v != "" and v != [] and v != {}
    }


def _build_context_profile(
    system_id: UUID, payload: AISystemRegistrationCreate
) -> ApplicationContextProfile:
    """Seed the five ApplicationContextProfile sections from registration facts.

    So a newly registered system's business purpose, primary use, intended
    users, model config, and integration details show up on the Context
    Profiles page immediately (editable there), instead of an empty profile.
    """
    system = payload.system
    usage = payload.usage_context
    first_model = payload.models[0] if payload.models else None
    rag = payload.rag_configuration
    endpoints = payload.endpoints or []
    data_sources = payload.data_sources or []

    identity_purpose = _prune({
        "name": system.name,
        "business_purpose": system.business_purpose,
        "description": system.description,
        "system_type": system.system_type,
        "business_domain": system.business_domain,
        "lifecycle_stage": system.lifecycle_stage,
        "product_name": system.product_name,
        "primary_use_case": usage.primary_use_case if usage else None,
        "intended_users": usage.intended_users if usage else None,
        "internal_external_use": usage.internal_external_use if usage else None,
        "capabilities": list(usage.capabilities) if usage else [],
        "_seeded_from": "registration",
    })

    pre_model_controls = _prune({
        "input_modalities": list(usage.input_modalities) if usage else [],
        "data_sources": [
            _prune({
                "name": d.name,
                "type": d.source_type,
                "classification": d.classification,
                "contains_personal_data": d.contains_personal_data,
            })
            for d in data_sources
        ],
    })

    model_configuration = _prune({
        "provider": first_model.provider if first_model else None,
        "model": first_model.name if first_model else None,
        "version": (first_model.version if first_model else None) or system.version,
        "deployment_name": first_model.deployment_name if first_model else None,
        "hosting_platform": first_model.hosting_platform if first_model else None,
        "safety_filters_enabled": first_model.safety_filters_enabled if first_model else None,
        "rag": _prune({
            "knowledge_base": rag.knowledge_base_name if rag else None,
            "vector_database": rag.vector_database if rag else None,
            "embedding_model": rag.embedding_model if rag else None,
            "retrieval_strategy": rag.retrieval_strategy if rag else None,
            "top_k": rag.top_k if rag else None,
        }) if rag else {},
    })

    post_model_controls = _prune({
        "human_oversight": usage.human_oversight if usage else None,
        "output_usage": usage.output_usage if usage else None,
        "output_types": list(usage.output_types) if usage else [],
        "citations_enabled": rag.citations_enabled if rag else None,
    })

    integration_context = _prune({
        "deployment_environment": system.deployment_environment,
        "production_criticality": system.production_criticality,
        "endpoints": [
            _prune({
                "name": e.name,
                "url": e.url,
                "method": e.http_method,
                "authentication_type": e.authentication_type,
            })
            for e in endpoints
        ],
    })

    return ApplicationContextProfile(
        ai_system_id=system_id,
        identity_purpose=identity_purpose,
        pre_model_controls=pre_model_controls,
        model_configuration=model_configuration,
        post_model_controls=post_model_controls,
        integration_context=integration_context,
    )


def _build_capability_for_endpoint(
    system_id: UUID,
    endpoint: RegistrationEndpointInput,
    human_oversight: str | None,
    used_names: set[str],
) -> AISystemCapability:
    """One engine-facing capability per endpoint, so the orchestrator can evaluate it."""
    name = endpoint.name
    if name in used_names:
        suffix = 2
        while f"{name} ({suffix})" in used_names:
            suffix += 1
        name = f"{name} ({suffix})"
    used_names.add(name)
    requires_review = bool(human_oversight) and human_oversight != "no_human_review"
    return AISystemCapability(
        ai_system_id=system_id,
        name=name,
        description="Auto-created from a registered target endpoint.",
        capability_type=CapabilityType.inference,
        endpoint_ref=endpoint.url,
        http_method=endpoint.http_method,
        side_effect_level=SideEffectLevel.none,
        requires_human_review=requires_review,
        enabled=True,
        metadata_json={"source": "registration", "endpoint_name": endpoint.name},
    )


def register_ai_system(
    session: Session, payload: AISystemRegistrationCreate
) -> AISystemRegistrationRead:
    is_draft = payload.status == "draft"

    # 1. Validate everything BEFORE the first add (fail-fast, no partial rows).
    if not payload.system.name:
        raise _validation_error("System name is required.", missing=["name"])
    _validate_catalogs(payload)
    canonical_frameworks = _canonical_framework_ids(payload.frameworks)
    if not is_draft:
        _require_registered_fields(payload)

    screening = screen_risk(payload.risk_screening.answers if payload.risk_screening else None)
    completeness, missing_fields = _compute_completeness(payload)

    system = payload.system
    primary = _primary_owner(payload.owners)
    first_model = payload.models[0] if payload.models else None
    first_endpoint = payload.endpoints[0] if payload.endpoints else None

    ai_system = AISystem(
        name=system.name,
        description=system.description,
        owner=(primary.name if primary and primary.name else "unassigned"),
        system_type=system.system_type or "other",
        risk_tier=clamp_to_risk_tier(screening.preliminary_risk_tier),
        modality=system.modality,
        deployment_environment=system.deployment_environment or "local",
        status=AISystemStatus.registered,
        selected_frameworks=canonical_frameworks,
        model_provider=(first_model.provider if first_model else "azure_foundry"),
        model_name=(first_model.name if first_model else None),
        model_version=system.version,
        target_endpoint_ref=(first_endpoint.url if first_endpoint else None),
        metadata_json={
            "registration_status": "draft" if is_draft else "registered",
            "business_purpose": system.business_purpose,
            "business_unit": system.business_unit,
            "product_name": system.product_name,
            "internal_identifier": system.internal_identifier,
            "version": system.version,
            "notes": system.notes,
        },
    )

    try:
        session.add(ai_system)
        session.flush()  # assigns ai_system.id without committing

        session.add(_build_usage_context(ai_system.id, payload))
        # Seed the Application Context Profile from registration facts so business
        # purpose, primary use, intended users, model config, etc. show up on the
        # Context Profiles page immediately (still editable there).
        session.add(_build_context_profile(ai_system.id, payload))

        session.add_all(
            AISystemOwner(
                ai_system_id=ai_system.id,
                role=o.role,
                name=o.name,
                email=o.email,
                is_primary=o.is_primary,
            )
            for o in payload.owners
        )

        model_rows: dict[str, AISystemModel] = {}
        for m in payload.models:
            row = _model_row(ai_system.id, m)
            session.add(row)
            model_rows[m.name] = row
        session.flush()  # assigns model ids for endpoint wiring

        for e in payload.endpoints:
            model_row = model_rows.get(e.model_ref) if e.model_ref else None
            session.add(_endpoint_row(ai_system.id, e, model_row.id if model_row else None))

        session.add_all(
            AISystemFramework(
                ai_system_id=ai_system.id,
                framework_id=canonical_frameworks[idx],
                applicability_type=entry.applicability_type,
                applicability_note=entry.applicability_note,
            )
            for idx, entry in enumerate(payload.frameworks)
        )

        session.add(
            AISystemRiskScreening(
                ai_system_id=ai_system.id,
                answers=dict(payload.risk_screening.answers) if payload.risk_screening else {},
                preliminary_risk_score=screening.preliminary_risk_score,
                preliminary_risk_tier=screening.preliminary_risk_tier,
                triggered_risk_factors=screening.triggered_risk_factors,
                risk_summary=screening.risk_summary,
            )
        )

        # Phase 2 children (all optional).
        session.add_all(_data_source_row(ai_system.id, d) for d in payload.data_sources)
        if payload.rag_configuration is not None:
            session.add(_rag_row(ai_system.id, payload.rag_configuration))
        if payload.agent_configuration is not None:
            session.add(_agent_row(ai_system.id, payload.agent_configuration))
        session.add_all(
            AISystemSecurityControlStatus(
                ai_system_id=ai_system.id,
                control_key=c.control_key,
                implementation_status=c.implementation_status,
                notes=c.notes,
            )
            for c in payload.security_posture
        )
        session.add_all(_dependency_row(ai_system.id, d) for d in payload.dependencies)
        session.add_all(_document_row(ai_system.id, d) for d in payload.documents)

        if not is_draft:
            human_oversight = (
                payload.usage_context.human_oversight if payload.usage_context else None
            )
            used_names: set[str] = set()
            for e in payload.endpoints:
                session.add(
                    _build_capability_for_endpoint(ai_system.id, e, human_oversight, used_names)
                )

        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise ResourceConflictError("AI system registration", "name", system.name) from exc
    except ApplicationError:
        session.rollback()
        raise

    session.refresh(ai_system)
    return _build_registration_read(
        session,
        ai_system,
        completeness=completeness,
        missing_fields=missing_fields,
        registration_status="draft" if is_draft else "registered",
    )


def _model_row(system_id: UUID, m: RegistrationModelInput) -> AISystemModel:
    return AISystemModel(
        ai_system_id=system_id,
        name=m.name,
        provider=m.provider,
        version=m.version,
        deployment_name=m.deployment_name,
        model_type=m.model_type,
        purpose=m.purpose,
        hosting_platform=m.hosting_platform,
        hosting_region=m.hosting_region,
        base_model=m.base_model,
        is_fine_tuned=m.is_fine_tuned,
        is_open_source=m.is_open_source,
        is_third_party=m.is_third_party,
        input_modalities=list(m.input_modalities),
        output_modalities=list(m.output_modalities),
        safety_filters_enabled=m.safety_filters_enabled,
        fallback_model=m.fallback_model,
        documentation_url=m.documentation_url,
    )


def _endpoint_row(
    system_id: UUID, e: RegistrationEndpointInput, model_id: UUID | None
) -> AISystemEndpoint:
    return AISystemEndpoint(
        ai_system_id=system_id,
        model_id=model_id,
        name=e.name,
        url=e.url,
        purpose=e.purpose,
        http_method=e.http_method,
        environment=e.environment,
        gateway_type=e.gateway_type,
        authentication_type=e.authentication_type,
        exposure_type=e.exposure_type,
        is_public=e.is_public,
        input_format=e.input_format,
        output_format=e.output_format,
        rate_limit=e.rate_limit,
        timeout_seconds=e.timeout_seconds,
        logging_enabled=e.logging_enabled,
        monitoring_enabled=e.monitoring_enabled,
        pii_allowed=e.pii_allowed,
        retention_days=e.retention_days,
        status=e.status,
    )


def _data_source_row(system_id: UUID, d) -> AISystemDataSource:
    return AISystemDataSource(ai_system_id=system_id, **d.model_dump())


def _rag_row(system_id: UUID, r) -> AISystemRAGConfig:
    return AISystemRAGConfig(ai_system_id=system_id, **r.model_dump())


def _agent_row(system_id: UUID, a) -> AISystemAgentConfig:
    return AISystemAgentConfig(ai_system_id=system_id, **a.model_dump())


def _dependency_row(system_id: UUID, d) -> AISystemDependency:
    return AISystemDependency(ai_system_id=system_id, **d.model_dump())


def _document_row(system_id: UUID, d) -> AISystemDocument:
    return AISystemDocument(ai_system_id=system_id, **d.model_dump())


def _build_registration_read(
    session: Session,
    ai_system: AISystem,
    *,
    completeness: float,
    missing_fields: list[str],
    registration_status: str,
) -> AISystemRegistrationRead:
    system_id = ai_system.id
    usage = session.exec(
        select(AISystemUsageContext).where(AISystemUsageContext.ai_system_id == system_id)
    ).first()
    owners = session.exec(
        select(AISystemOwner).where(AISystemOwner.ai_system_id == system_id)
    ).all()
    models = session.exec(
        select(AISystemModel).where(AISystemModel.ai_system_id == system_id)
    ).all()
    endpoints = session.exec(
        select(AISystemEndpoint).where(AISystemEndpoint.ai_system_id == system_id)
    ).all()
    frameworks = session.exec(
        select(AISystemFramework).where(AISystemFramework.ai_system_id == system_id)
    ).all()
    capabilities = session.exec(
        select(AISystemCapability).where(AISystemCapability.ai_system_id == system_id)
    ).all()
    screening = session.exec(
        select(AISystemRiskScreening).where(AISystemRiskScreening.ai_system_id == system_id)
    ).first()
    data_sources = session.exec(
        select(AISystemDataSource).where(AISystemDataSource.ai_system_id == system_id)
    ).all()
    rag = session.exec(
        select(AISystemRAGConfig).where(AISystemRAGConfig.ai_system_id == system_id)
    ).first()
    agent = session.exec(
        select(AISystemAgentConfig).where(AISystemAgentConfig.ai_system_id == system_id)
    ).first()
    security = session.exec(
        select(AISystemSecurityControlStatus).where(
            AISystemSecurityControlStatus.ai_system_id == system_id
        )
    ).all()
    dependencies = session.exec(
        select(AISystemDependency).where(AISystemDependency.ai_system_id == system_id)
    ).all()
    documents = session.exec(
        select(AISystemDocument).where(AISystemDocument.ai_system_id == system_id)
    ).all()

    return AISystemRegistrationRead.model_validate(
        {
            "system": ai_system,
            "usage_context": usage,
            "owners": list(owners),
            "models": list(models),
            "endpoints": list(endpoints),
            "frameworks": list(frameworks),
            "capabilities": list(capabilities),
            "risk_screening": screening,
            "data_sources": list(data_sources),
            "rag_configuration": rag,
            "agent_configuration": agent,
            "security_posture": list(security),
            "dependencies": list(dependencies),
            "documents": list(documents),
            "preliminary_risk_score": screening.preliminary_risk_score if screening else 0,
            "preliminary_risk_tier": screening.preliminary_risk_tier if screening else "unassessed",
            "triggered_risk_factors": screening.triggered_risk_factors if screening else [],
            "profile_completeness": completeness,
            "missing_recommended_fields": missing_fields,
            "registration_status": registration_status,
        }
    )


def get_registration_detail(session: Session, system_id: UUID) -> AISystemRegistrationRead:
    ai_system = session.get(AISystem, system_id)
    if ai_system is None:
        raise ResourceNotFoundError("AI system", str(system_id))
    registration_status = str(
        ai_system.metadata_json.get("registration_status", "registered")
    )
    # Recompute completeness lazily is not needed here; report stored/derived state.
    completeness, missing = _completeness_from_state(session, ai_system)
    return _build_registration_read(
        session,
        ai_system,
        completeness=completeness,
        missing_fields=missing,
        registration_status=registration_status,
    )


def _completeness_from_state(session: Session, ai_system: AISystem) -> tuple[float, list[str]]:
    """Approximate completeness for an already-persisted system (for GET detail)."""
    system_id = ai_system.id
    usage = session.exec(
        select(AISystemUsageContext).where(AISystemUsageContext.ai_system_id == system_id)
    ).first()
    owners = session.exec(
        select(AISystemOwner).where(AISystemOwner.ai_system_id == system_id)
    ).all()
    models = session.exec(
        select(AISystemModel).where(AISystemModel.ai_system_id == system_id)
    ).all()
    endpoints = session.exec(
        select(AISystemEndpoint).where(AISystemEndpoint.ai_system_id == system_id)
    ).all()
    frameworks = session.exec(
        select(AISystemFramework).where(AISystemFramework.ai_system_id == system_id)
    ).all()
    screening = session.exec(
        select(AISystemRiskScreening).where(AISystemRiskScreening.ai_system_id == system_id)
    ).first()
    meta = ai_system.metadata_json or {}
    has_role = {o.role for o in owners}
    present: dict[str, bool] = {
        "version": bool(ai_system.model_version or meta.get("version")),
        "description": bool(ai_system.description),
        "business_purpose": bool(meta.get("business_purpose")),
        "system_type": bool(ai_system.system_type),
        "business_domain": bool(usage and usage.business_domain),
        "lifecycle_stage": bool(usage and usage.lifecycle_stage),
        "primary_owner": bool(owners),
        "technical_owner": "technical_owner" in has_role,
        "intended_users": bool(usage and usage.intended_users),
        "output_usage": bool(usage and usage.output_usage),
        "human_oversight": bool(usage and usage.human_oversight),
        "at_least_one_model": bool(models),
        "at_least_one_endpoint": bool(endpoints),
        "at_least_one_framework": bool(frameworks),
        "risk_screening": bool(screening and screening.answers),
    }
    missing = [field for field in _RECOMMENDED_FIELDS if not present.get(field)]
    filled = len(_RECOMMENDED_FIELDS) - len(missing)
    pct = round(100.0 * filled / len(_RECOMMENDED_FIELDS), 1)
    return pct, missing
