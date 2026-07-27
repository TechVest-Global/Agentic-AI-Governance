"""Register the HR Recruitment AI Gateway as an audited AI system.

Fetches the machine-readable endpoint catalog from the HR application
(GET {TARGET_ENDPOINT}/catalog, authenticated with TARGET_API_KEY) and upserts:

  - one ``AISystem`` ("HR Recruitment System (AI Gateway)")
  - one ``AISystemCapability`` per catalog endpoint (13 LLM call sites)

Usage (from the ``backend`` directory, with the project venv active and the
HR server running on TARGET_ENDPOINT):

    python -m scripts.register_hr_gateway

Idempotent: re-running skips the system and capabilities that already exist
and creates only what is missing.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any

from app.core.config import get_settings
from app.db.session import engine
from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import CapabilityType, Modality, RiskTier
from app.schemas.governance import AISystemCapabilityCreate, AISystemCreate
from app.services import ai_systems as service
from sqlmodel import Session, select

SYSTEM_NAME = "HR Recruitment System (AI Gateway)"

_GENERATIVE_PREFIXES = ("generate", "format")


def _capability_type(function_name: str) -> CapabilityType:
    if function_name.lower().startswith(_GENERATIVE_PREFIXES):
        return CapabilityType.generation
    return CapabilityType.inference


def _fetch_catalog(endpoint: str, api_key: str | None) -> dict[str, Any]:
    url = f"{endpoint.rstrip('/')}/catalog"
    request = urllib.request.Request(url, headers={"x-api-key": api_key or ""})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError as exc:
        sys.exit(
            f"Could not fetch the HR gateway catalog from {url}: {exc}\n"
            "Is the HR server running? Start it with: cd hr-application/server && npm run dev"
        )


def _get_or_create_system(
    session: Session, catalog: dict[str, Any], target_endpoint: str
) -> tuple[AISystem, bool]:
    existing = session.exec(
        select(AISystem).where(AISystem.name == SYSTEM_NAME)
    ).first()
    if existing is not None:
        return existing, False

    deployments = {e.get("deployment") for e in catalog.get("endpoints", []) if e.get("deployment")}
    system = service.create_ai_system(
        session,
        AISystemCreate(
            name=SYSTEM_NAME,
            description=(
                "AI-assisted recruitment platform: resume parsing, candidate "
                "ranking, resume formatting, and automated interview screening. "
                "Each LLM call is exposed as a standalone audit endpoint under "
                "/api/v1/ai; responses are self-contained audit envelopes."
            ),
            owner="HR Engineering",
            system_type="hr_recruitment_screening",
            risk_tier=RiskTier.high,  # employment decisions — high risk under EU AI Act
            modality=Modality.text,
            deployment_environment="local",
            selected_frameworks=["eu_ai_act", "iso_42001", "nist_ai_rmf", "owasp_llm_top_10"],
            model_provider="azure_openai",
            model_name=", ".join(sorted(deployments)) or "gpt-4o",
            target_endpoint_ref=target_endpoint,
            metadata_json={
                "catalog_url": f"{target_endpoint.rstrip('/')}/catalog",
                "auth_header": "x-api-key",
                "response_envelope": catalog.get("responseEnvelope", []),
            },
        ),
    )
    return system, True


def main() -> None:
    settings = get_settings()
    if not settings.target_endpoint:
        sys.exit("TARGET_ENDPOINT is not set in .env — expected e.g. http://localhost:5000/api/v1/ai")

    catalog = _fetch_catalog(settings.target_endpoint, settings.target_api_key)
    endpoints = catalog.get("endpoints", [])
    if not endpoints:
        sys.exit("The HR catalog returned no endpoints — nothing to register.")

    with Session(engine) as session:
        system, created = _get_or_create_system(session, catalog, settings.target_endpoint)
        status = "created" if created else "already registered"
        print(f"AI system:   {system.name} ({status}) id={system.id}")

        existing_names = {
            capability.name
            for capability in session.exec(
                select(AISystemCapability).where(AISystemCapability.ai_system_id == system.id)
            ).all()
        }

        added = 0
        for entry in endpoints:
            function_name = entry["function"]
            if function_name in existing_names:
                print(f"  capability: {function_name:32s} (already registered)")
                continue
            # Store the path relative to the gateway base — the HR gateway
            # target client resolves it back to a full URL.
            path = entry["path"].split("/ai/", 1)[-1]
            service.create_capability(
                session,
                system.id,
                AISystemCapabilityCreate(
                    name=function_name,
                    description=entry.get("description"),
                    capability_type=_capability_type(function_name),
                    endpoint_ref=path,
                    http_method=entry.get("method", "POST"),
                    input_schema=entry.get("requestBody", {}),
                    output_schema={"envelope": catalog.get("responseEnvelope", [])},
                    side_effect_level="none",
                    metadata_json={
                        "feature": entry.get("feature"),
                        "deployment": entry.get("deployment"),
                        "full_path": entry["path"],
                    },
                ),
            )
            added += 1
            print(f"  capability: {function_name:32s} (registered — {path})")

        print(
            f"\nDone. {added} new capabilities registered, "
            f"{len(existing_names)} already present."
        )


if __name__ == "__main__":
    main()
