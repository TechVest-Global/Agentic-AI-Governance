"""Model client registry.

Resolution priority for both governance and target clients:
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


def get_target_model_client(settings: Settings | None = None) -> TargetModelClient:
    resolved = settings or get_settings()

    # Priority 1: LiteLLM proxy
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

    # Priority 2: Azure OpenAI directly
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
