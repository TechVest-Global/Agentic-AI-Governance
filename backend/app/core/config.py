from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
