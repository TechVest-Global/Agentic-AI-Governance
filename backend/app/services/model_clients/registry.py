from app.core.config import Settings, get_settings
from app.services.model_clients.base import GovernanceModelClient, TargetModelClient
from app.services.model_clients.mock import (
    MockGovernanceModelClient,
    MockTargetModelClient,
)

TARGET_MODEL_CREDENTIAL_REF = "TARGET_MODEL_API_KEY"
GOVERNANCE_MODEL_CREDENTIAL_REF = "AZURE_AI_FOUNDRY_API_KEY"


def get_target_model_client(settings: Settings | None = None) -> TargetModelClient:
    resolved_settings = settings or get_settings()
    return MockTargetModelClient(
        provider=resolved_settings.target_model_provider,
        credential_ref=TARGET_MODEL_CREDENTIAL_REF,
    )


def get_governance_model_client(settings: Settings | None = None) -> GovernanceModelClient:
    resolved_settings = settings or get_settings()
    return MockGovernanceModelClient(
        provider=resolved_settings.ai_model_provider,
        deployment_name=resolved_settings.azure_ai_foundry_deployment_name,
        credential_ref=GOVERNANCE_MODEL_CREDENTIAL_REF,
    )
