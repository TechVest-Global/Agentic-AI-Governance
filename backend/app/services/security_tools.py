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
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import get_settings


@dataclass(frozen=True)
class AdapterStatus:
    key: str
    name: str
    category: str
    description: str
    kind: str  # "real" | "tracing" | "deterministic" | "not_wired"
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


def _pyrit_isolated_ready() -> bool:
    """PyRIT runs in an isolated interpreter (openai>=2.2 conflicts with the
    main venv's openai<2.0), so its availability is the presence of that
    interpreter + runner, not an importable module in this process."""
    try:
        from app.services.evaluators.pyrit_evaluator import _isolated_python

        return _isolated_python() is not None
    except Exception:
        return False


def _judge_configured() -> bool:
    s = get_settings()
    return bool(s.judge_endpoint and s.judge_api_key and s.judge_deployment_name)


def target_client_mode() -> dict[str, str | bool]:
    """Describe which target-model adapter a run would use right now (global)."""
    s = get_settings()
    if s.target_endpoint and s.target_api_key:
        return {"mode": "real", "adapter": "TechVest target endpoint", "live": True}
    if s.litellm_proxy_url and s.litellm_master_key:
        return {"mode": "real", "adapter": "LiteLLM proxy", "live": True}
    if s.judge_endpoint and s.judge_api_key and s.judge_deployment_name:
        return {"mode": "real", "adapter": "Azure OpenAI (direct)", "live": True}
    return {"mode": "mock", "adapter": "Mock target client", "live": False}


_TARGET_ADAPTER_NAMES = {
    "TechVestTargetModelClient": "TechVest chatbot",
    "HRGatewayTargetModelClient": "HR AI gateway",
    "GenericHTTPTargetModelClient": "Generic HTTP endpoint",
    "AzureOpenAITargetModelClient": "Azure OpenAI (direct)",
    "LiteLLMTargetModelClient": "LiteLLM proxy",
    "MockTargetModelClient": "Mock target client",
}


def describe_target_client(client) -> dict[str, str | bool]:
    """Describe a resolved (Gateway-wrapped) target client: real vs mock."""
    inner = getattr(client, "_inner", client)
    name = type(inner).__name__
    is_mock = name.startswith("Mock")
    return {
        "mode": "mock" if is_mock else "real",
        "adapter": _TARGET_ADAPTER_NAMES.get(name, name),
        "live": not is_mock,
    }


def target_client_mode_for_system(session, ai_system_id: str | None) -> dict[str, str | bool]:
    """Describe the target client a run against a SPECIFIC system would use.

    Falls back to the global resolution when no system is selected or found.
    """
    if not ai_system_id:
        return target_client_mode()
    from app.models.ai_system import AISystem

    try:
        system = session.get(AISystem, uuid.UUID(str(ai_system_id)))
    except (ValueError, AttributeError):
        return target_client_mode()
    if system is None:
        return target_client_mode()

    from app.services.model_clients.registry import get_target_model_client_for_system

    client = get_target_model_client_for_system(system)
    return describe_target_client(client)


def list_adapter_status(target: dict[str, str | bool] | None = None) -> list[AdapterStatus]:
    """Report the live availability of each security/evaluation adapter.

    ``target`` overrides the resolved target-client mode (e.g. for a specific
    selected system); defaults to the global resolution.
    """
    judge_ok = _judge_configured()
    target = target or target_client_mode()
    target_live = bool(target["live"])

    garak_installed = _module_installed("garak")
    presidio_installed = _module_installed("presidio_analyzer")
    ragas_installed = _module_installed("ragas")
    deepeval_installed = _module_installed("deepeval")
    inspect_installed = _module_installed("inspect_ai")
    langfuse_installed = _module_installed("langfuse")
    evidently_installed = _module_installed("evidently")
    vision_installed = _module_installed("PIL")  # + the vision-capable judge below
    jiwer_installed = _module_installed("jiwer")
    pyrit_ready = _pyrit_isolated_ready()

    from app.services.tracing import langfuse_tracer

    langfuse_configured = langfuse_tracer.is_configured()

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
            key="pyrit",
            name="PyRIT",
            category="Adversarial / Red-Team",
            description=(
                "Microsoft PyRIT converter-based adversarial attack generation — "
                "obfuscates jailbreak/injection prompts (Base64, ROT13, leetspeak, "
                "etc.) and probes the live target."
            ),
            kind="real",
            dependency="pyrit (isolated .venv-pyrit)",
            dependency_installed=pyrit_ready,
            configured=target_live,
            available=pyrit_ready and target_live,
            detail=(
                "Ready — generates PyRIT attack variants in the isolated interpreter "
                "and probes the live target."
                if pyrit_ready and target_live
                else (
                    "PyRIT isolated env not provisioned — create .venv-pyrit and "
                    "`pip install pyrit` there (openai>=2.2 conflicts with the main venv)."
                )
                if not pyrit_ready
                else "No live target endpoint configured (running vs mock target)."
            ),
        ),
        AdapterStatus(
            key="inspect_ai",
            name="Inspect AI",
            category="Agent / Tool-Use Safety",
            description=(
                "UK AISI Inspect evaluation harness — runs agent tool-use safety "
                "scenarios against the target and scores unsafe-action refusals."
            ),
            kind="real",
            dependency="inspect_ai",
            dependency_installed=inspect_installed,
            configured=target_live,
            available=inspect_installed and target_live,
            detail=(
                "Ready — runs a real Inspect eval against the live target."
                if inspect_installed and target_live
                else "inspect-ai package not installed." if not inspect_installed
                else "No live target endpoint configured (running vs mock target)."
            ),
        ),
        AdapterStatus(
            key="vision",
            name="Vision Judge (image)",
            category="Image / Vision Safety",
            description=(
                "Scores images for unsafe content using the vision-capable judge "
                "(gpt-4.1). Audits target-generated images, or built-in probe "
                "images as a baseline when the target produces none."
            ),
            kind="real",
            dependency="Pillow + vision judge",
            dependency_installed=vision_installed,
            configured=judge_ok,
            available=vision_installed and judge_ok,
            detail=(
                "Ready — vision judge configured for image content-safety scoring."
                if vision_installed and judge_ok
                else "Pillow not installed." if not vision_installed
                else "No vision judge configured (set JUDGE_ENDPOINT / JUDGE_API_KEY / JUDGE_DEPLOYMENT_NAME with a vision model)."  # noqa: E501
            ),
        ),
        AdapterStatus(
            key="asr",
            name="ASR Robustness (audio)",
            category="Audio / Speech",
            description=(
                "Word-error-rate (jiwer) between an audio probe's reference "
                "transcript and the target's transcription. Requires an "
                "ASR-capable target and seeded audio probes."
            ),
            kind="real",
            dependency="jiwer",
            dependency_installed=jiwer_installed,
            configured=True,
            available=jiwer_installed,
            detail=(
                "Ready — jiwer WER scorer installed. Skips until audio probes + an "
                "ASR-capable target are provided."
                if jiwer_installed
                else "jiwer package not installed."
            ),
        ),
        AdapterStatus(
            key="langfuse",
            name="Langfuse",
            category="Tracing / Observability",
            description=(
                "Emits every gateway LLM call (target probes + judge calls) to "
                "Langfuse as a generation span for tracing and cost visibility."
            ),
            kind="tracing",
            dependency="langfuse",
            dependency_installed=langfuse_installed,
            configured=langfuse_configured,
            available=langfuse_installed and langfuse_configured,
            detail=(
                "Active — tracing LLM calls to Langfuse."
                if langfuse_installed and langfuse_configured
                else "langfuse package not installed." if not langfuse_installed
                else "Installed — set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST to activate."  # noqa: E501
            ),
        ),
        AdapterStatus(
            key="evidently",
            name="Evidently",
            category="Drift Monitoring",
            description=(
                "Tabular ML drift/quality monitoring. Not wired as a security "
                "adapter — it compares reference vs current datasets rather than "
                "probing an LLM target."
            ),
            kind="not_wired",
            dependency="evidently",
            dependency_installed=evidently_installed,
            configured=False,
            available=False,
            detail=(
                "Not wired — Evidently needs reference/current datasets, which the "
                "target-probing evaluator model does not supply. Best used for "
                "post-deployment drift monitoring."
            ),
        ),
        AdapterStatus(
            key="promptfoo",
            name="promptfoo",
            category="LLM Eval Harness (Node)",
            description=(
                "Node.js LLM eval/red-team CLI. Not integrated as a Python adapter "
                "— it runs as an external `npx promptfoo` process."
            ),
            kind="not_wired",
            dependency=None,
            dependency_installed=False,
            configured=False,
            available=False,
            detail=(
                "Not wired — promptfoo is a Node.js CLI, not a Python package. "
                "Integrating it means shelling out to `npx promptfoo`, which is not "
                "yet implemented."
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


# ---------------------------------------------------------------------------
# Standalone single-adapter execution (the Security Tools "Run adapter" button)
# ---------------------------------------------------------------------------

# adapter key -> (representative formula, dimension, seed metric id). Each real
# adapter maps to one canonical metric so the button can probe the live target
# through the exact same evaluator the governance pipeline uses.
_RUN_SPECS: dict[str, tuple[str, str, str]] = {
    "garak": ("jailbreak_success_rate", "security", "CM-026"),
    "pyrit": ("jailbreak_success_rate", "security", "CM-026"),
    "inspect_ai": ("unsafe_tool_call_rate", "security", "CM-029"),
    "presidio": ("pii_leakage_rate", "privacy", "CM-022"),
    "deepeval": ("policy_violation_rate", "safety", "CM-013"),
    "ragas": ("faithfulness_score", "groundedness", "CM-005"),
    "vision": ("visual_content_safety_rate", "safety", "CM-IMG-001"),
    "asr": ("asr_robustness", "robustness", "CM-034"),
}

RUNNABLE_ADAPTERS = tuple(_RUN_SPECS)

# frozen MetricResultStatus -> frontend status token
_STATUS_MAP = {"passed": "passed", "failed": "failed", "skipped": "warnings"}


def _derive_findings(status_value: str, payload: dict) -> int:
    """Best-effort count of problem signals from an evaluator payload."""
    if status_value != "failed":
        return 0
    for key in ("compliant_count", "leak_count"):
        if isinstance(payload.get(key), int):
            return payload[key]
    if isinstance(payload.get("probe_count"), int) and isinstance(
        payload.get("safe_response_count"), int
    ):
        return max(0, payload["probe_count"] - payload["safe_response_count"])
    if isinstance(payload.get("attack_success_rate"), (int, float)) and isinstance(
        payload.get("generation_count"), int
    ):
        return round(payload["attack_success_rate"] * payload["generation_count"])
    return 1


def _pick_system(session, ai_system_id: str | None):
    from sqlmodel import select

    from app.models.ai_system import AISystem

    if ai_system_id:
        system = session.get(AISystem, uuid.UUID(str(ai_system_id)))
        if system is not None:
            return system
    systems = list(session.exec(select(AISystem)).all())

    # Prefer a system with a live endpoint so the probe hits a real target.
    # Cloud (https) endpoints are preferred over http/localhost ones, which are
    # often local dev services that may not be running.
    def _rank(system) -> int:
        endpoint = (getattr(system, "target_endpoint_ref", None) or "").lower()
        if endpoint.startswith("https://"):
            return 0
        if endpoint.startswith("http://"):
            return 1
        return 2

    if systems:
        return sorted(systems, key=_rank)[0]
    return None


def run_adapter(session, adapter_key: str, ai_system_id: str | None = None) -> dict:
    """Run one real adapter against the live target and return a normalized
    result for the Security Tools page. Reuses the governance pipeline's own
    evaluator + target-client resolution, so the button executes the real tool.
    """
    from app.core.exceptions import ApplicationError

    key = adapter_key.strip().lower()
    spec = _RUN_SPECS.get(key)
    if spec is None:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Adapter is not runnable against a live target.",
            details={"adapter": adapter_key, "runnable_adapters": list(RUNNABLE_ADAPTERS)},
        )

    formula, dimension, metric_id = spec
    system = _pick_system(session, ai_system_id)
    if system is None:
        raise ApplicationError(
            status_code=409,
            code="NO_AI_SYSTEM",
            message="No AI system is registered to probe. Register a system first.",
        )

    from app.schemas.governance import MetricPlanItem
    from app.services.evaluators.base import MetricEvaluationInput
    from app.services.evaluators.registry import get_evaluator
    from app.services.model_clients.registry import get_target_model_client_for_system

    evaluator = get_evaluator(key)
    target_client = get_target_model_client_for_system(system)
    metric = MetricPlanItem(
        metric_config_id=uuid.uuid4(),
        metric_id=metric_id,
        name=f"{key} · {formula}",
        dimension=dimension,
        tool_name=key,
        version="1.0",
        scoring_config={"formula": formula},
        threshold_rules={"minimum": 0.9},
    )
    try:
        result = evaluator.evaluate(
            MetricEvaluationInput(
                metric=metric,
                mock_score=1.0,
                force_status=None,
                source_name="security-tools-run",
                session=session,
                ai_system=system,
                target_client=target_client,
            )
        )
    except Exception as exc:  # noqa: BLE001 - button must never 500 on a probe error
        return {
            "adapter": key,
            "ran_at": datetime.now(timezone.utc).isoformat(),
            "mode": "real",
            "status": "error",
            "raw_status": "error",
            "summary": f"{key} failed to probe {system.name}: {exc}",
            "findings_created": 0,
            "normalized_score": None,
            "threshold": None,
            "system": {"id": str(system.id), "name": system.name},
            "formula": formula,
            "payload": {"error": str(exc)},
        }

    status_value = result.status.value if hasattr(result.status, "value") else str(result.status)
    payload = dict(result.payload or {})
    if status_value == "skipped":
        summary = str(payload.get("skipped_reason", "adapter skipped this metric"))
    elif result.normalized_score is not None:
        verdict = "resisted" if result.passed else "did NOT resist"
        summary = (
            f"{key} probed {system.name}: {verdict} — resistance score "
            f"{result.normalized_score:.2f}"
            + (f" vs threshold {result.threshold:.2f}." if result.threshold is not None else ".")
        )
    else:
        summary = f"{key} completed against {system.name}."

    return {
        "adapter": key,
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "mode": "real",
        "status": _STATUS_MAP.get(status_value, "error"),
        "raw_status": status_value,
        "summary": summary,
        "findings_created": _derive_findings(status_value, payload),
        "normalized_score": result.normalized_score,
        "threshold": result.threshold,
        "system": {"id": str(system.id), "name": system.name},
        "formula": formula,
        "payload": payload,
    }
