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
    ai_model_provider: str = "azure_foundry"
    target_model_provider: str = "azure_foundry"
    azure_ai_foundry_endpoint: str | None = None
    azure_ai_foundry_project_name: str | None = None
    azure_ai_foundry_deployment_name: str | None = None

    # Real audited-system endpoint (e.g. the TechVest RAG chatbot). Highest
    # priority target client — probes the actual system under audit rather
    # than a stand-in model.
    target_endpoint: str | None = None
    target_api_key: str | None = None
    # Which client adapter speaks the target system's API:
    #   "techvest"   — TechVest RAG chatbot (POST /api/chat, {"message": ...})
    #   "hr_gateway" — HR Recruitment AI Gateway (13 endpoints under /api/v1/ai)
    target_system_kind: str = "techvest"

    # Per-kind target credentials so runs against DIFFERENT registered systems
    # route to their own endpoints simultaneously (the single TARGET_* pair sent
    # every audit — whatever the run's system — to one global endpoint). The
    # endpoint itself is normally taken from the audited system's registered
    # target_endpoint_ref; these are the matching API keys plus optional
    # endpoint overrides. Both fall back to TARGET_ENDPOINT/TARGET_API_KEY.
    hr_gateway_endpoint: str | None = None
    hr_gateway_api_key: str | None = None
    techvest_endpoint: str | None = None
    techvest_api_key: str | None = None

    # Judge model (Azure OpenAI) — powers the Deliberation Council agents
    judge_endpoint: str | None = None
    judge_api_key: str | None = None
    judge_deployment_name: str | None = None
    judge_api_version: str = "2025-01-01-preview"

    # LiteLLM Proxy — when set, all LLM calls route through the proxy instead
    # of hitting Azure OpenAI directly. Enables fallback, caching, cost tracking.
    # Set LITELLM_PROXY_URL=http://localhost:4000 to activate.
    litellm_proxy_url: str | None = None
    litellm_master_key: str | None = None
    litellm_model: str = "judge-model"

    # Per-call timeout for LLM requests (target + governance). Without this a
    # slow-but-not-erroring Azure response has nothing forcing it to fail fast,
    # so the Gateway's retry/backoff never engages and a single call can block
    # the whole council/agent pipeline far longer than the SDK's own default.
    llm_call_timeout_seconds: float = 60.0

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    @field_validator("api_v1_prefix")
    @classmethod
    def api_prefix_must_start_with_slash(cls, value: str) -> str:
        if not value.startswith("/"):
            return f"/{value}"
        return value

    @field_validator(
        "secrets_provider", "ai_model_provider", "target_model_provider", "target_system_kind"
    )
    @classmethod
    def provider_values_must_be_normalized(cls, value: str) -> str:
        return value.strip().lower().replace("-", "_")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
