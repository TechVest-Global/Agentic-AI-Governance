from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the project-root .env explicitly so settings load identically no matter
# the working directory the process is launched from (repo root, backend/, etc.).
# config.py lives at <root>/backend/app/core/config.py -> parents[3] is the repo root.
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    app_name: str = "Agentic AI Governance Engine"
    app_env: str = "local"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    backend_cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        description="Comma-separated allowed frontend origins.",
    )
    database_url: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/agentic_ai_governance"
    )
    secrets_provider: str = "env"
    azure_key_vault_url: str | None = None
    # Fernet key (urlsafe base64, 32 bytes) used to encrypt per-endpoint target
    # secrets at rest. Generate with: python -c "from cryptography.fernet import
    # Fernet; print(Fernet.generate_key().decode())". Required only when storing
    # target-endpoint secrets in the database; unset means secrets cannot be saved.
    secret_encryption_key: str | None = None
    ai_model_provider: str = "azure_foundry"
    target_model_provider: str = "azure_foundry"
    azure_ai_foundry_endpoint: str | None = None
    azure_ai_foundry_project_name: str | None = None
    azure_ai_foundry_deployment_name: str | None = None

    # Real target application (the audited chatbot). When target_api_key or
    # target_endpoint is set, specialist agents probe the live HTTP endpoint
    # instead of an LLM stand-in. The URL comes from each registered system's
    # target_endpoint_ref unless target_endpoint overrides it globally.
    # Credentials live in the environment only — never on the system record.
    target_endpoint: str | None = None
    target_api_key: str | None = None
    target_auth_header: str = "Authorization"
    target_auth_scheme: str = "Bearer"  # prefix before the key; "" sends the raw key
    target_request_field: str = "message"  # JSON body field the prompt is sent as
    target_response_field: str = "response"  # JSON field the reply is read from
    target_timeout_seconds: int = 60

    # Judge model (Azure OpenAI) — powers the Deliberation Council agents
    judge_endpoint: str | None = None
    judge_api_key: str | None = None
    judge_deployment_name: str | None = None
    judge_api_version: str = "2025-01-01-preview"
    # Optional cheaper deployment for the "cheap" model tier when calling Azure
    # directly (no proxy). Reserved for future lightweight helper tasks; unset
    # means the cheap tier falls back to the premium judge deployment.
    judge_cheap_deployment_name: str | None = None

    # LiteLLM Proxy — when set, all LLM calls route through the proxy instead
    # of hitting Azure OpenAI directly. Enables fallback, caching, cost tracking.
    # Set LITELLM_PROXY_URL=http://localhost:4000 to activate.
    litellm_proxy_url: str | None = None
    litellm_master_key: str | None = None
    litellm_model: str = "judge-model"

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    @field_validator("api_v1_prefix")
    @classmethod
    def api_prefix_must_start_with_slash(cls, value: str) -> str:
        if not value.startswith("/"):
            return f"/{value}"
        return value

    @field_validator("secrets_provider", "ai_model_provider", "target_model_provider")
    @classmethod
    def provider_values_must_be_normalized(cls, value: str) -> str:
        return value.strip().lower().replace("-", "_")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
