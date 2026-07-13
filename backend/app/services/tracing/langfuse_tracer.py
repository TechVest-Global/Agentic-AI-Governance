"""Langfuse tracing integration for the LLM Gateway (optional, defensive).

When ``LANGFUSE_PUBLIC_KEY`` + ``LANGFUSE_SECRET_KEY`` are configured, every LLM
call captured by the gateway is emitted to Langfuse as a generation span. If
langfuse is not installed or not configured, every hook is a silent no-op —
tracing must never break, slow, or fail a governance run, so all interaction
with the Langfuse SDK is guarded.
"""

import importlib.util
import logging
from functools import lru_cache

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def is_installed() -> bool:
    try:
        return importlib.util.find_spec("langfuse") is not None
    except (ImportError, ValueError):
        return False


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


@lru_cache(maxsize=1)
def _client():
    """Construct (once) a Langfuse client if installed and configured, else None."""
    if not is_configured() or not is_installed():
        return None
    try:
        from langfuse import Langfuse

        settings = get_settings()
        return Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Langfuse: client initialization failed: %s", exc)
        return None


def is_active() -> bool:
    """True when a Langfuse client is live (installed + configured + constructed)."""
    return _client() is not None


_METADATA_KEYS = (
    "call_type",
    "model",
    "deployment_name",
    "client_mode",
    "routed_via",
    "latency_ms",
    "status",
    "trace_id",
    "agent_name",
    "estimated_cost_usd",
)


def record_llm_call(entry: dict) -> None:
    """Emit one captured gateway LLM-call log entry as a Langfuse generation.

    Accepts the same dict the gateway buffers for the audit log. No-op unless a
    Langfuse client is active; every SDK error is swallowed.
    """
    client = _client()
    if client is None:
        return
    try:
        observation = client.start_observation(
            name=f"{entry.get('call_type', 'llm')}:{entry.get('task') or 'call'}",
            as_type="generation",
            input=entry.get("prompt_text"),
            metadata={k: entry[k] for k in _METADATA_KEYS if entry.get(k) is not None},
        )
        observation.update(output=entry.get("response_text"))
        observation.end()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Langfuse: span emit failed: %s", exc)


def flush() -> None:
    """Flush buffered spans (call at the end of a run). No-op when inactive."""
    client = _client()
    if client is None:
        return
    try:
        client.flush()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Langfuse: flush failed: %s", exc)
