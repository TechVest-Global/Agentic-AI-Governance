"""Model client registry.

Resolution priority for the target client (the system under audit):
  1. Real audited system — when TARGET_ENDPOINT + TARGET_API_KEY are set
  2. LiteLLM Proxy       — when LITELLM_PROXY_URL + LITELLM_MASTER_KEY are set
  3. Azure OpenAI        — when JUDGE_ENDPOINT + JUDGE_API_KEY + JUDGE_DEPLOYMENT_NAME are set
  4. Mock                — fallback for local development / CI without API keys

Resolution priority for the governance (judge) client:
  1. LiteLLM Proxy   — when LITELLM_PROXY_URL + LITELLM_MASTER_KEY are set
  2. Azure OpenAI    — when JUDGE_ENDPOINT + JUDGE_API_KEY + JUDGE_DEPLOYMENT_NAME are set
  3. Mock            — fallback for local development / CI without API keys

All live clients are wrapped in the Gateway layer (retry + audit buffer).
"""

import logging

from app.core.config import Settings, get_settings
from app.services.model_clients.base import GovernanceModelClient, TargetModelClient
from app.services.model_clients.gateway import (
    GatewayGovernanceModelClient,
    GatewayTargetModelClient,
)
from app.services.model_clients.mock import (
    MockGovernanceModelClient,
    MockTargetModelClient,
)

logger = logging.getLogger(__name__)

TARGET_MODEL_CREDENTIAL_REF = "TARGET_MODEL_API_KEY"
GOVERNANCE_MODEL_CREDENTIAL_REF = "AZURE_AI_FOUNDRY_API_KEY"


def _infer_target_kind(ai_system) -> str | None:
    """Infer which client adapter speaks this registered system's API.

    hr_gateway: registered from the HR catalog (metadata carries catalog_url /
    x-api-key auth, or the endpoint is the gateway's /api/v1/ai base).
    techvest: RAG/chat systems fronted by the TechVest chatbot API
    (x-functions-key auth or a rag/chat system_type).
    """
    metadata = getattr(ai_system, "metadata_json", None) or {}
    endpoint = (getattr(ai_system, "target_endpoint_ref", None) or "").lower()
    auth_header = str(metadata.get("auth_header", "")).lower()
    if "catalog_url" in metadata or auth_header == "x-api-key" or "/api/v1/ai" in endpoint:
        return "hr_gateway"
    system_type = (getattr(ai_system, "system_type", None) or "").lower()
    if auth_header == "x-functions-key" or "rag" in system_type or "chat" in system_type:
        return "techvest"
    return None


def get_target_model_client_for_system(
    ai_system,
    settings: Settings | None = None,
) -> TargetModelClient:
    """Resolve the target client for the SPECIFIC system under audit.

    The global TARGET_* pair selects one default target, which sent every
    audit's probes to the same endpoint regardless of the run's system — a RAG
    chatbot audit probed the HR gateway (whose unknown-route fallback is
    parse-resume, so citation probes came back as empty resume JSON). Prefer
    the audited system's own registered endpoint + an adapter inferred from its
    registration; fall back to the global resolution when the system doesn't
    carry enough routing information.
    """
    from urllib.parse import urlsplit

    resolved = settings or get_settings()
    kind = _infer_target_kind(ai_system) if ai_system is not None else None
    registered = (getattr(ai_system, "target_endpoint_ref", None) or "").strip()
    if not registered.lower().startswith(("http://", "https://")):
        registered = ""

    # A system whose endpoint lives on the configured HR gateway host speaks
    # the gateway's API even when its registration metadata doesn't say so
    # (e.g. registered through the UI with a bare base URL).
    if kind is None and registered:
        gateway_base = resolved.hr_gateway_endpoint or (
            resolved.target_endpoint if resolved.target_system_kind == "hr_gateway" else None
        )
        if gateway_base and urlsplit(registered).netloc == urlsplit(gateway_base).netloc:
            kind = "hr_gateway"

    if kind == "hr_gateway":
        endpoint = registered or resolved.hr_gateway_endpoint or resolved.target_endpoint
        api_key = resolved.hr_gateway_api_key or resolved.target_api_key
        if endpoint and api_key:
            from app.services.model_clients.hr_gateway import HRGatewayTargetModelClient

            logger.info(
                "Target client: HR AI gateway for system %s (endpoint=%s)",
                getattr(ai_system, "id", "?"),
                endpoint,
            )
            return GatewayTargetModelClient(
                HRGatewayTargetModelClient(
                    endpoint=endpoint,
                    api_key=api_key,
                    timeout=resolved.llm_call_timeout_seconds,
                )
            )

    if kind == "techvest":
        endpoint = registered or resolved.techvest_endpoint
        api_key = resolved.techvest_api_key
        if endpoint and api_key:
            from app.services.model_clients.techvest import TechVestTargetModelClient

            logger.info(
                "Target client: TechVest chatbot for system %s (endpoint=%s)",
                getattr(ai_system, "id", "?"),
                endpoint,
            )
            return GatewayTargetModelClient(
                TechVestTargetModelClient(endpoint=endpoint, api_key=api_key)
            )
        logger.warning(
            "System %s looks like a TechVest/RAG target but TECHVEST_API_KEY is not "
            "set — falling back to the global target client",
            getattr(ai_system, "id", "?"),
        )

    # Any other system with a registered HTTP endpoint: probe THAT endpoint via
    # the metadata-driven generic adapter instead of silently redirecting the
    # audit to the global default target.
    if registered:
        from app.services.model_clients.generic_http import GenericHTTPTargetModelClient

        logger.info(
            "Target client: generic HTTP adapter for system %s (endpoint=%s)",
            getattr(ai_system, "id", "?"),
            registered,
        )
        return GatewayTargetModelClient(
            GenericHTTPTargetModelClient.for_system(
                ai_system,
                fallback_api_key=resolved.target_api_key,
                timeout=resolved.llm_call_timeout_seconds,
            )
        )

    return get_target_model_client(resolved)


def get_target_model_client(settings: Settings | None = None) -> TargetModelClient:
    resolved = settings or get_settings()

    # Priority 1: the real audited system (TechVest chatbot or HR AI gateway,
    # selected via TARGET_SYSTEM_KIND)
    if resolved.target_endpoint and resolved.target_api_key:
        if resolved.target_system_kind == "hr_gateway":
            from app.services.model_clients.hr_gateway import HRGatewayTargetModelClient

            logger.info(
                "Target client: HR AI gateway (endpoint=%s)", resolved.target_endpoint
            )
            inner: TargetModelClient = HRGatewayTargetModelClient(
                endpoint=resolved.target_endpoint,
                api_key=resolved.target_api_key,
                timeout=resolved.llm_call_timeout_seconds,
            )
        else:
            from app.services.model_clients.techvest import TechVestTargetModelClient

            logger.info(
                "Target client: real audited system (endpoint=%s)", resolved.target_endpoint
            )
            inner = TechVestTargetModelClient(
                endpoint=resolved.target_endpoint,
                api_key=resolved.target_api_key,
                timeout=resolved.llm_call_timeout_seconds,
            )
        return GatewayTargetModelClient(inner)

    # Priority 2: LiteLLM proxy
    if resolved.litellm_proxy_url and resolved.litellm_master_key:
        from app.services.model_clients.litellm_proxy import LiteLLMTargetModelClient

        logger.info(
            "Target client: LiteLLM proxy (url=%s model=%s)",
            resolved.litellm_proxy_url,
            resolved.litellm_model,
        )
        inner = LiteLLMTargetModelClient(
            proxy_url=resolved.litellm_proxy_url,
            master_key=resolved.litellm_master_key,
            model=resolved.litellm_model,
        )
        return GatewayTargetModelClient(inner)

    # Priority 3: Azure OpenAI directly
    if (
        resolved.judge_endpoint
        and resolved.judge_api_key
        and resolved.judge_deployment_name
    ):
        from app.services.model_clients.azure_openai import AzureOpenAITargetModelClient

        logger.info(
            "Target client: live Azure OpenAI (deployment=%s)",
            resolved.judge_deployment_name,
        )
        inner = AzureOpenAITargetModelClient(
            endpoint=resolved.judge_endpoint,
            api_key=resolved.judge_api_key,
            deployment_name=resolved.judge_deployment_name,
            api_version=resolved.judge_api_version,
            timeout=resolved.llm_call_timeout_seconds,
        )
        return GatewayTargetModelClient(inner)

    # Fallback: mock
    logger.warning("Target client: mock (no live credentials configured)")
    inner = MockTargetModelClient(
        provider=resolved.target_model_provider,
        credential_ref=TARGET_MODEL_CREDENTIAL_REF,
    )
    return GatewayTargetModelClient(inner)


def get_governance_model_client(settings: Settings | None = None) -> GovernanceModelClient:
    resolved = settings or get_settings()

    # Priority 1: LiteLLM proxy
    if resolved.litellm_proxy_url and resolved.litellm_master_key:
        from app.services.model_clients.litellm_proxy import LiteLLMGovernanceModelClient

        logger.info(
            "Judge client: LiteLLM proxy (url=%s model=%s)",
            resolved.litellm_proxy_url,
            resolved.litellm_model,
        )
        inner = LiteLLMGovernanceModelClient(
            proxy_url=resolved.litellm_proxy_url,
            master_key=resolved.litellm_master_key,
            model=resolved.litellm_model,
        )
        return GatewayGovernanceModelClient(inner)

    # Priority 2: Azure OpenAI directly
    if (
        resolved.judge_endpoint
        and resolved.judge_api_key
        and resolved.judge_deployment_name
    ):
        from app.services.model_clients.azure_openai import AzureOpenAIGovernanceModelClient

        logger.info(
            "Judge client: live Azure OpenAI (deployment=%s)",
            resolved.judge_deployment_name,
        )
        inner = AzureOpenAIGovernanceModelClient(
            endpoint=resolved.judge_endpoint,
            api_key=resolved.judge_api_key,
            deployment_name=resolved.judge_deployment_name,
            api_version=resolved.judge_api_version,
            timeout=resolved.llm_call_timeout_seconds,
        )
        return GatewayGovernanceModelClient(inner)

    # Fallback: mock
    logger.warning(
        "Judge client: mock (no live credentials configured — "
        "set LITELLM_PROXY_URL or JUDGE_ENDPOINT)"
    )
    inner = MockGovernanceModelClient(
        provider=resolved.ai_model_provider,
        deployment_name=resolved.azure_ai_foundry_deployment_name,
        credential_ref=GOVERNANCE_MODEL_CREDENTIAL_REF,
    )
    return GatewayGovernanceModelClient(inner)
