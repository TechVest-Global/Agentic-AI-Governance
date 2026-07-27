"""Register the Marketing Campaign Generator as an audited AI system.

Unlike the HR gateway (register_hr_gateway.py), this app has no machine-readable
catalog endpoint — it exposes exactly 3 static content-generation probes under
/api/compliance/probe/*. This script registers the AISystem plus one
AISystemCapability per probe directly, using absolute endpoint_ref URLs so the
GenericHTTPTargetModelClient (backend/app/services/model_clients/generic_http.py)
routes each capability to its own path without any code changes — it only takes
the "endpoint_ref as absolute URL" branch, not the base+relative join, which
does not handle multi-segment relative paths like "probe/image".

All 3 probes accept ``prompt`` as their primary/only required field, so the
generic client's default prompt_field="prompt" and response_field="output"
(matched by _DEFAULT_RESPONSE_FIELDS) work without per-capability overrides.

Usage (from the backend directory, project venv active, Postgres running):

    python -m scripts.register_marketing_gateway

Idempotent: re-running skips the system and capabilities that already exist.
"""

from __future__ import annotations

from app.db.session import engine
from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import CapabilityType, Modality, RiskTier, SideEffectLevel
from app.schemas.governance import AISystemCapabilityCreate, AISystemCreate
from app.services import ai_systems as service
from sqlmodel import Session, select

SYSTEM_NAME = "Marketing Campaign Generator (FLUX+Sora+GPT-4o)"
BASE_URL = "http://localhost:8001"

CAPABILITIES = [
    {
        "name": "probeImage",
        "description": "FLUX.2-pro image generation probe — POST {prompt, size, negative_prompt}",
        "endpoint_ref": f"{BASE_URL}/api/compliance/probe/image",
        "modality": Modality.image,
        "input_schema": {
            "prompt": "string (required, max 2000 chars)",
            "size": "Square | Portrait | Landscape (default Square)",
            "negative_prompt": "string (optional)",
        },
        "model": "FLUX.2-pro",
    },
    {
        "name": "probeVideo",
        "description": "Azure Sora 2 video generation probe — POST {prompt, duration_seconds}",
        "endpoint_ref": f"{BASE_URL}/api/compliance/probe/video",
        "modality": Modality.video,
        "input_schema": {
            "prompt": "string (required, max 2000 chars)",
            "duration_seconds": "'4' | '8' | '12' (default '8')",
        },
        "model": "Sora-2",
    },
    {
        "name": "probeText",
        "description": "GPT-4o copywriter probe — POST {prompt, tone, max_tokens}",
        "endpoint_ref": f"{BASE_URL}/api/compliance/probe/text",
        "modality": Modality.text,
        "input_schema": {
            "prompt": "string (required, max 2000 chars) — campaign brief",
            "tone": "string (default 'professional')",
            "max_tokens": "int (default 400)",
        },
        "model": "gpt-4o",
    },
]

OUTPUT_SCHEMA = {
    "output": "base64 data URL (image) | static mp4 URL (video) | text string",
    "format": "base64_jpeg | static_mp4_url | text",
    "latency_ms": "int",
    "prompt_used": "string — echoes back the (possibly sanitized) prompt",
}


def _get_or_create_system(session: Session) -> tuple[AISystem, bool]:
    existing = session.exec(select(AISystem).where(AISystem.name == SYSTEM_NAME)).first()
    if existing is not None:
        return existing, False

    system = service.create_ai_system(
        session,
        AISystemCreate(
            name=SYSTEM_NAME,
            description=(
                "AI-generated Instagram marketing campaigns — FLUX.2-pro images, "
                "Azure Sora 2 reels, GPT-4o copy. 9-step wizard with brand document "
                "parsing and Instagram publishing. Registered via its 3 standalone "
                "compliance-probe endpoints (image/video/text); internal vision/"
                "analysis steps — Art Director, product/reference image analysis, "
                "generated-image QA, brand-document insight extraction — are not "
                "yet individually exposed and so are not covered by this system's "
                "capabilities."
            ),
            owner="Marketing Team",
            system_type="content_generation",
            risk_tier=RiskTier.medium,
            modality=Modality.image,
            deployment_environment="local",
            selected_frameworks=["eu_ai_act", "iso_42001", "nist_ai_rmf", "owasp_llm_top_10"],
            model_provider="azure_openai",
            model_name="FLUX.2-pro, Sora-2, gpt-4o",
            target_endpoint_ref=BASE_URL,
            metadata_json={
                "prompt_field": "prompt",
                "response_field": "output",
                "probe_base": f"{BASE_URL}/api/compliance/probe",
                "known_limitations": (
                    "Image/video probes return raw base64/URL text as 'output', not "
                    "a structured media array, so the generic HTTP target client "
                    "surfaces them as text rather than as inspectable media."
                ),
            },
        ),
    )
    return system, True


def main() -> None:
    with Session(engine) as session:
        system, created = _get_or_create_system(session)
        status = "created" if created else "already registered"
        print(f"AI system:   {system.name} ({status}) id={system.id}")

        existing_names = {
            capability.name
            for capability in session.exec(
                select(AISystemCapability).where(AISystemCapability.ai_system_id == system.id)
            ).all()
        }

        added = 0
        for entry in CAPABILITIES:
            if entry["name"] in existing_names:
                print(f"  capability: {entry['name']:12s} (already registered)")
                continue
            service.create_capability(
                session,
                system.id,
                AISystemCapabilityCreate(
                    name=entry["name"],
                    description=entry["description"],
                    capability_type=CapabilityType.generation,
                    modality=entry["modality"],
                    endpoint_ref=entry["endpoint_ref"],
                    http_method="POST",
                    input_schema=entry["input_schema"],
                    output_schema=OUTPUT_SCHEMA,
                    side_effect_level=SideEffectLevel.none,
                    requires_human_review=True,
                    metadata_json={"model": entry["model"]},
                ),
            )
            added += 1
            print(f"  capability: {entry['name']:12s} (registered — {entry['endpoint_ref']})")

        print(
            f"\nDone. {added} new capabilities registered, "
            f"{len(existing_names)} already present."
        )


if __name__ == "__main__":
    main()
