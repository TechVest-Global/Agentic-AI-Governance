"""Security-tool / evaluator adapter inventory.

The frontend Security Tools page used to render a purely hardcoded mock list.
This service reports the *real* state of each evaluator adapter registered in
the backend: whether its Python dependency is importable, whether the config it
needs is present, and therefore whether it can run for real or would skip.

Availability is probed by attempting the same imports/config checks each
evaluator performs at runtime, so the page reflects what a run would actually
do rather than a static guess.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass

from app.core.config import get_settings


@dataclass(frozen=True)
class AdapterStatus:
    key: str
    name: str
    category: str
    description: str
    kind: str  # "real" | "mock" | "deterministic"
    dependency: str | None       # importable python module the adapter needs
    dependency_installed: bool
    configured: bool             # required config/credentials present
    available: bool              # would actually run for real right now
    detail: str


def _module_installed(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def _judge_configured() -> bool:
    s = get_settings()
    return bool(s.judge_endpoint and s.judge_api_key and s.judge_deployment_name)


def target_client_mode() -> dict[str, str | bool]:
    """Describe which target-model adapter a run would use right now."""
    s = get_settings()
    if s.target_endpoint and s.target_api_key:
        return {"mode": "real", "adapter": "TechVest target endpoint", "live": True}
    if s.litellm_proxy_url and s.litellm_master_key:
        return {"mode": "real", "adapter": "LiteLLM proxy", "live": True}
    if s.judge_endpoint and s.judge_api_key and s.judge_deployment_name:
        return {"mode": "real", "adapter": "Azure OpenAI (direct)", "live": True}
    return {"mode": "mock", "adapter": "Mock target client", "live": False}


def list_adapter_status() -> list[AdapterStatus]:
    """Report the live availability of each security/evaluation adapter."""
    judge_ok = _judge_configured()
    target = target_client_mode()
    target_live = bool(target["live"])

    garak_installed = _module_installed("garak")
    presidio_installed = _module_installed("presidio_analyzer")
    ragas_installed = _module_installed("ragas")
    deepeval_installed = _module_installed("deepeval")

    adapters: list[AdapterStatus] = [
        AdapterStatus(
            key="garak",
            name="garak",
            category="Adversarial / Jailbreak",
            description=(
                "LLM vulnerability scanner — DAN jailbreaks, prompt injection, "
                "data leakage, malware generation probes."
            ),
            kind="real",
            dependency="garak",
            dependency_installed=garak_installed,
            configured=target_live,
            available=garak_installed and target_live,
            detail=(
                "Ready — runs real garak probes against the live target."
                if garak_installed and target_live
                else "garak package not installed." if not garak_installed
                else "No live target endpoint configured (running vs mock target)."
            ),
        ),
        AdapterStatus(
            key="presidio",
            name="Microsoft Presidio",
            category="PII / Data Leakage",
            description=(
                "Detects and classifies PII in target responses "
                "(names, emails, credentials, financial identifiers)."
            ),
            kind="real",
            dependency="presidio_analyzer",
            dependency_installed=presidio_installed,
            configured=True,
            available=presidio_installed,
            detail=(
                "Ready — analyzes target output for PII."
                if presidio_installed
                else "presidio-analyzer package not installed."
            ),
        ),
        AdapterStatus(
            key="deepeval",
            name="DeepEval",
            category="Safety / Fairness (LLM-judge)",
            description=(
                "LLM-as-judge metrics — bias, toxicity, role adherence, "
                "custom G-Eval rubrics."
            ),
            kind="real",
            dependency="deepeval",
            dependency_installed=deepeval_installed,
            configured=judge_ok,
            available=deepeval_installed and judge_ok,
            detail=(
                "Ready — judge model configured."
                if deepeval_installed and judge_ok
                else "deepeval package not installed." if not deepeval_installed
                else "No judge LLM configured (set JUDGE_ENDPOINT / JUDGE_API_KEY / JUDGE_DEPLOYMENT_NAME)."  # noqa: E501
            ),
        ),
        AdapterStatus(
            key="ragas",
            name="RAGAS",
            category="RAG Groundedness",
            description=(
                "Retrieval-augmented grounding and faithfulness scoring against "
                "seeded context documents."
            ),
            kind="real",
            dependency="ragas",
            dependency_installed=ragas_installed,
            configured=judge_ok,
            available=ragas_installed and judge_ok,
            detail=(
                "Ready — requires seeded retrieval-context documents per system."
                if ragas_installed and judge_ok
                else "ragas package not installed." if not ragas_installed
                else "No judge LLM configured."
            ),
        ),
        AdapterStatus(
            key="threshold",
            name="Threshold Evaluator",
            category="Deterministic Baseline",
            description=(
                "Deterministic threshold scoring used as the fallback for tools "
                "without a live integration (langfuse, evidently, promptfoo)."
            ),
            kind="deterministic",
            dependency=None,
            dependency_installed=True,
            configured=True,
            available=True,
            detail="Always available — no external dependency.",
        ),
    ]
    return adapters
