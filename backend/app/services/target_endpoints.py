"""Target endpoint management + resolution.

An application (AISystem) can register several HTTP target endpoints (prod,
staging, regional instances). A run probes exactly one — the explicit per-run
override if given, otherwise the application's default endpoint. Secrets are
encrypted at rest and only decrypted here, at resolution time.

Backward compatibility: when a system has no registered endpoints we fall back
to its legacy ``target_endpoint_ref`` string plus environment credentials, so
existing systems keep working unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.exceptions import ResourceConflictError, ResourceNotFoundError
from app.models.ai_system import AISystem, TargetEndpoint
from app.models.base import utc_now
from app.schemas.governance import (
    TargetEndpointCreate,
    TargetEndpointRead,
    TargetEndpointUpdate,
)
from app.services.ai_systems import get_ai_system


@dataclass(frozen=True)
class ResolvedTargetEndpoint:
    """A fully-resolved endpoint ready to probe (secret decrypted in memory)."""

    id: UUID | None
    name: str
    url: str
    http_method: str
    auth_header: str
    auth_scheme: str
    request_field: str
    response_field: str
    timeout_seconds: int
    api_key: str | None
    source: str  # "endpoint" (DB row) | "legacy" (target_endpoint_ref)


def to_read(endpoint: TargetEndpoint) -> TargetEndpointRead:
    """Serialize an endpoint without ever exposing the stored secret."""
    return TargetEndpointRead(
        id=endpoint.id,
        ai_system_id=endpoint.ai_system_id,
        name=endpoint.name,
        description=endpoint.description,
        environment=endpoint.environment,
        url=endpoint.url,
        http_method=endpoint.http_method,
        auth_header=endpoint.auth_header,
        auth_scheme=endpoint.auth_scheme,
        request_field=endpoint.request_field,
        response_field=endpoint.response_field,
        timeout_seconds=endpoint.timeout_seconds,
        enabled=endpoint.enabled,
        is_default=endpoint.is_default,
        metadata_json=endpoint.metadata_json,
        has_secret=bool(endpoint.secret_ciphertext),
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )


def _clear_other_defaults(session: Session, system_id: UUID, keep_id: UUID | None) -> None:
    others = session.exec(
        select(TargetEndpoint).where(
            TargetEndpoint.ai_system_id == system_id,
            TargetEndpoint.is_default == True,  # noqa: E712 — SQL boolean comparison
        )
    ).all()
    for other in others:
        if other.id != keep_id:
            other.is_default = False
            other.updated_at = utc_now()
            session.add(other)


def _count_endpoints(session: Session, system_id: UUID) -> int:
    return len(
        session.exec(
            select(TargetEndpoint).where(TargetEndpoint.ai_system_id == system_id)
        ).all()
    )


def create_target_endpoint(
    session: Session,
    system_id: UUID,
    payload: TargetEndpointCreate,
) -> TargetEndpoint:
    get_ai_system(session, system_id)

    duplicate = session.exec(
        select(TargetEndpoint).where(
            TargetEndpoint.ai_system_id == system_id,
            TargetEndpoint.name == payload.name,
        )
    ).first()
    if duplicate is not None:
        raise ResourceConflictError("target endpoint", "name", payload.name)

    values = payload.model_dump(exclude={"secret"})
    # First endpoint for a system is the default automatically.
    is_first = _count_endpoints(session, system_id) == 0
    make_default = payload.is_default or is_first
    values["is_default"] = make_default

    endpoint = TargetEndpoint(ai_system_id=system_id, **values)
    if payload.secret:
        endpoint.secret_ciphertext = encrypt_secret(payload.secret)

    if make_default:
        _clear_other_defaults(session, system_id, keep_id=None)

    session.add(endpoint)
    session.commit()
    session.refresh(endpoint)
    return endpoint


def list_target_endpoints(
    session: Session,
    system_id: UUID,
    *,
    enabled: bool | None = None,
) -> list[TargetEndpoint]:
    get_ai_system(session, system_id)
    statement = select(TargetEndpoint).where(TargetEndpoint.ai_system_id == system_id)
    if enabled is not None:
        statement = statement.where(TargetEndpoint.enabled == enabled)
    statement = statement.order_by(
        TargetEndpoint.is_default.desc(), TargetEndpoint.created_at.asc()
    )
    return list(session.exec(statement).all())


def get_target_endpoint(
    session: Session,
    system_id: UUID,
    endpoint_id: UUID,
) -> TargetEndpoint:
    get_ai_system(session, system_id)
    endpoint = session.exec(
        select(TargetEndpoint).where(
            TargetEndpoint.id == endpoint_id,
            TargetEndpoint.ai_system_id == system_id,
        )
    ).one_or_none()
    if endpoint is None:
        raise ResourceNotFoundError("target endpoint", str(endpoint_id))
    return endpoint


def update_target_endpoint(
    session: Session,
    system_id: UUID,
    endpoint_id: UUID,
    payload: TargetEndpointUpdate,
) -> TargetEndpoint:
    endpoint = get_target_endpoint(session, system_id, endpoint_id)
    values = payload.model_dump(exclude_unset=True)

    if "name" in values and values["name"] != endpoint.name:
        duplicate = session.exec(
            select(TargetEndpoint).where(
                TargetEndpoint.ai_system_id == system_id,
                TargetEndpoint.name == values["name"],
                TargetEndpoint.id != endpoint_id,
            )
        ).first()
        if duplicate is not None:
            raise ResourceConflictError("target endpoint", "name", values["name"])

    # Secret handling: omitted -> unchanged; "" -> clear; value -> re-encrypt.
    if "secret" in values:
        secret = values.pop("secret")
        if secret:
            endpoint.secret_ciphertext = encrypt_secret(secret)
        else:
            endpoint.secret_ciphertext = None

    for field, value in values.items():
        setattr(endpoint, field, value)

    if values.get("is_default"):
        _clear_other_defaults(session, system_id, keep_id=endpoint_id)

    endpoint.updated_at = utc_now()
    session.add(endpoint)
    session.commit()
    session.refresh(endpoint)
    return endpoint


def delete_target_endpoint(
    session: Session,
    system_id: UUID,
    endpoint_id: UUID,
) -> None:
    endpoint = get_target_endpoint(session, system_id, endpoint_id)
    was_default = endpoint.is_default
    session.delete(endpoint)
    session.flush()

    # Promote another endpoint to default so the system keeps a usable default.
    if was_default:
        replacement = session.exec(
            select(TargetEndpoint)
            .where(
                TargetEndpoint.ai_system_id == system_id,
                TargetEndpoint.enabled == True,  # noqa: E712
            )
            .order_by(TargetEndpoint.created_at.asc())
        ).first()
        if replacement is not None:
            replacement.is_default = True
            replacement.updated_at = utc_now()
            session.add(replacement)

    session.commit()


def resolve_target_endpoint(
    session: Session,
    system_id: UUID,
    *,
    endpoint_id: UUID | None = None,
    settings: Settings | None = None,
) -> ResolvedTargetEndpoint | None:
    """Resolve the endpoint a run should probe, with its decrypted credentials.

    Priority: explicit endpoint_id -> the system default -> any enabled endpoint
    -> legacy target_endpoint_ref (with environment credentials) -> None.
    """
    resolved_settings = settings or get_settings()

    if endpoint_id is not None:
        endpoint = get_target_endpoint(session, system_id, endpoint_id)
        return _from_endpoint(endpoint, resolved_settings)

    endpoints = list_target_endpoints(session, system_id, enabled=True)
    if endpoints:
        # list is ordered default-first, then oldest-first.
        return _from_endpoint(endpoints[0], resolved_settings)

    # Legacy fallback: the single string endpoint on the system record.
    system = get_ai_system(session, system_id)
    return _from_legacy(system, resolved_settings)


def _from_endpoint(
    endpoint: TargetEndpoint, settings: Settings
) -> ResolvedTargetEndpoint:
    if endpoint.secret_ciphertext:
        api_key: str | None = decrypt_secret(endpoint.secret_ciphertext)
    else:
        # No stored secret — fall back to the environment credential.
        api_key = settings.target_api_key or None
    return ResolvedTargetEndpoint(
        id=endpoint.id,
        name=endpoint.name,
        url=endpoint.url,
        http_method=endpoint.http_method,
        auth_header=endpoint.auth_header,
        auth_scheme=endpoint.auth_scheme,
        request_field=endpoint.request_field,
        response_field=endpoint.response_field,
        timeout_seconds=endpoint.timeout_seconds,
        api_key=api_key,
        source="endpoint",
    )


def _from_legacy(
    system: AISystem, settings: Settings
) -> ResolvedTargetEndpoint | None:
    ref = system.target_endpoint_ref
    if not ref or not str(ref).lower().startswith(("http://", "https://")):
        return None
    return ResolvedTargetEndpoint(
        id=None,
        name=system.name,
        url=ref,
        http_method="POST",
        auth_header=settings.target_auth_header,
        auth_scheme=settings.target_auth_scheme,
        request_field=settings.target_request_field,
        response_field=settings.target_response_field,
        timeout_seconds=settings.target_timeout_seconds,
        api_key=settings.target_api_key or None,
        source="legacy",
    )
