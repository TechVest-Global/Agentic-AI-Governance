"""LLM client boundary — live boundary test + client mode.

Runs a real prompt through the exact target->sanitize->fence pipeline the audit
engine uses, so the LLM Client Boundary page can demonstrate the trust boundary
against the actual target model (or the mock target when no credentials are set)
instead of a client-side simulation.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.services.model_clients.base import TargetModelRequest
from app.services.model_clients.registry import (
    GOVERNANCE_MODEL_CREDENTIAL_REF,
    TARGET_MODEL_CREDENTIAL_REF,
    get_target_model_client,
)
from app.services.model_clients.sanitization import (
    fence_untrusted_target_output,
    sanitize_target_output,
)


def client_boundary_status() -> dict:
    """Report the live mode + provider/credential of both boundary clients."""
    s = get_settings()

    if s.target_endpoint and s.target_api_key:
        target_mode, target_provider = "real", "Target system endpoint"
    elif s.litellm_proxy_url and s.litellm_master_key:
        target_mode, target_provider = "real", "LiteLLM proxy"
    elif s.judge_endpoint and s.judge_api_key and s.judge_deployment_name:
        target_mode, target_provider = "real", "Azure OpenAI (direct)"
    else:
        target_mode, target_provider = "mock", "Mock target client"

    judge_ok = bool(s.judge_endpoint and s.judge_api_key and s.judge_deployment_name)
    litellm_ok = bool(s.litellm_proxy_url and s.litellm_master_key)
    governance_mode = "real" if (judge_ok or litellm_ok) else "mock"
    governance_provider = (
        "Azure OpenAI (judge deployment)"
        if judge_ok
        else "LiteLLM proxy" if litellm_ok else "Mock governance client"
    )

    return {
        "governance": {
            "mode": governance_mode,
            "provider": governance_provider,
            "credential_ref": f"env:{GOVERNANCE_MODEL_CREDENTIAL_REF}",
        },
        "target": {
            "mode": target_mode,
            "provider": target_provider,
            "credential_ref": f"env:{TARGET_MODEL_CREDENTIAL_REF}",
        },
    }


def run_boundary_test(prompt: str, *, endpoint_ref: str | None = None) -> dict:
    """Probe the real target model with ``prompt``, then sanitize + fence the
    response exactly as the audit engine does. Returns the raw output, sanitized
    output, warnings/redactions, the fenced evidence block, and whether anything
    was caught — all from live behavior, not a simulation.
    """
    text = (prompt or "").strip() or "Summarize the latest customer support transcript."
    settings = get_settings()
    client = get_target_model_client()
    endpoint = endpoint_ref or settings.target_endpoint or "boundary-test"

    response = client.invoke(
        TargetModelRequest(
            endpoint_ref=endpoint,
            prompt=text,
            capability_name="boundary_test",
        )
    )
    raw = response.raw_output
    sanitized = sanitize_target_output(raw)
    fenced = fence_untrusted_target_output(sanitized)

    return {
        "prompt": text,
        "target_mode": client_boundary_status()["target"]["mode"],
        "provider": response.provider,
        "trace_id": response.trace_id,
        "latency_ms": response.latency_ms,
        "raw": raw,
        "sanitized": sanitized.text,
        "redaction_count": sanitized.redaction_count,
        "warnings": sanitized.warnings,
        "warning_count": sanitized.warning_count,
        "fenced": fenced,
        # The boundary "held" if it produced a fenced evidence block. Redactions
        # or injection warnings mean it actively neutralized something.
        "caught_something": sanitized.redaction_count > 0 or sanitized.warning_count > 0,
    }
