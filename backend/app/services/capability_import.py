"""Import an AI system's callable endpoints from its target gateway catalog.

Multi-endpoint targets (e.g. the HR Recruitment AI Gateway) expose a catalog at
``GET {target_endpoint_ref}/catalog`` listing every function/endpoint. Registering
those by hand is tedious and error-prone (a system can end up with only one
capability). This service fetches the catalog and creates one AISystemCapability
per endpoint, so an auditor can then scope runs to specific functions.

Idempotent: endpoints already present (by endpoint_ref or name) are skipped.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urlparse, urlunparse
from uuid import UUID

from sqlmodel import Session, select

from app.core.exceptions import ApplicationError
from app.models.ai_system import AISystem, AISystemCapability
from app.services.ai_systems import get_ai_system

# Feature -> capability_type mapping for nicer classification in the UI.
_FEATURE_TO_TYPE = {
    "parsing": "inference",
    "ranking": "inference",
    "generation": "generation",
    "evaluation": "inference",
    "retrieval": "retrieval",
}


def _catalog_url(base: str) -> str:
    """Build the catalog URL from the system's target endpoint ref.

    Accepts either a base like ``http://host/api/v1/ai`` (append ``/catalog``)
    or a URL that already ends in ``/catalog``.
    """
    base = (base or "").rstrip("/")
    if base.endswith("/catalog"):
        return base
    return f"{base}/catalog"


def _auth_header_name(system: AISystem) -> str:
    """The header the target expects for the catalog call. Defaults to the HR
    gateway's ``x-api-key``; overridable via metadata_json['catalog_auth_header']
    or ['auth_header']."""
    meta = system.metadata_json or {}
    return str(meta.get("catalog_auth_header") or meta.get("auth_header") or "x-api-key")


def _fetch_catalog(url: str, header_name: str, api_key: str | None) -> dict:
    req = urllib.request.Request(url, method="GET")
    if api_key:
        req.add_header(header_name, api_key)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ApplicationError(
            status_code=502,
            code="CATALOG_FETCH_FAILED",
            message=f"Target catalog returned HTTP {exc.code}. Check the endpoint and API key.",
            details={"url": url, "status": exc.code},
        ) from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise ApplicationError(
            status_code=502,
            code="CATALOG_FETCH_FAILED",
            message=f"Could not reach the target catalog at {url}.",
            details={"url": url, "error": str(exc)},
        ) from exc


def _endpoint_ref_for(base: str, entry: dict) -> str:
    """Prefer the catalog's kebab path (its last segment) as the endpoint_ref, so
    it matches what the gateway target client routes on. Falls back to function."""
    path = str(entry.get("path") or "").strip()
    if path:
        # Use the trailing segment, e.g. "/api/v1/ai/parse-resume" -> "parse-resume".
        return path.rstrip("/").rsplit("/", 1)[-1]
    return str(entry.get("function") or "endpoint")


def import_capabilities_from_catalog(
    session: Session,
    system_id: UUID,
    *,
    api_key: str | None,
) -> dict:
    """Fetch the system's target catalog and create a capability per endpoint.

    Returns a summary: {imported, skipped, total, capabilities:[...]}.
    """
    system = get_ai_system(session, system_id)
    if not system.target_endpoint_ref:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="System has no target endpoint configured; cannot fetch a catalog.",
        )

    catalog = _fetch_catalog(
        _catalog_url(system.target_endpoint_ref),
        _auth_header_name(system),
        api_key,
    )
    endpoints = catalog.get("endpoints") if isinstance(catalog, dict) else None
    if not isinstance(endpoints, list) or not endpoints:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Catalog did not contain an 'endpoints' list.",
        )

    existing = session.exec(
        select(AISystemCapability).where(AISystemCapability.ai_system_id == system_id)
    ).all()
    existing_refs = {c.endpoint_ref for c in existing}
    existing_names = {c.name for c in existing}

    base_origin = _base_origin(system.target_endpoint_ref)
    imported: list[AISystemCapability] = []
    skipped = 0
    for entry in endpoints:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("function") or entry.get("name") or "").strip()
        endpoint_ref = _endpoint_ref_for(system.target_endpoint_ref, entry)
        if not name or not endpoint_ref:
            continue
        if endpoint_ref in existing_refs or name in existing_names:
            skipped += 1
            continue
        feature = str(entry.get("feature") or "").lower()
        cap = AISystemCapability(
            ai_system_id=system_id,
            name=name[:200],
            description=(str(entry.get("description") or "")[:2000] or None),
            capability_type=_FEATURE_TO_TYPE.get(feature, "other"),
            endpoint_ref=endpoint_ref[:500],
            http_method=str(entry.get("method") or "POST").upper(),
            enabled=True,
            metadata_json={
                "feature": feature or None,
                "full_path": entry.get("path"),
                "full_url": f"{base_origin}{entry.get('path')}" if entry.get("path") else None,
                "deployment": entry.get("deployment"),
                "imported_from_catalog": True,
            },
        )
        session.add(cap)
        imported.append(cap)
        existing_refs.add(endpoint_ref)
        existing_names.add(name)

    session.commit()
    for cap in imported:
        session.refresh(cap)

    return {
        "system_id": str(system_id),
        "catalog_name": catalog.get("name") if isinstance(catalog, dict) else None,
        "total": len(endpoints),
        "imported": len(imported),
        "skipped": skipped,
        "capabilities": imported,
    }


def _base_origin(endpoint_ref: str) -> str:
    """Scheme+host from the target endpoint, for building absolute endpoint URLs."""
    parsed = urlparse(endpoint_ref)
    if parsed.scheme and parsed.netloc:
        return urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
    return ""
