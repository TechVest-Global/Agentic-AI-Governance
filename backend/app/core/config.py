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

    # When True (default), the adaptive orchestrator runs an LLM plan-review that
    # narrows the applicable metric set per system. Set False to always evaluate
    # the full applicable catalog (no LLM narrowing).
    adaptive_plan_review_enabled: bool = True

    # LiteLLM Proxy — when set, all LLM calls route through the proxy instead
    # of hitting Azure OpenAI directly. Enables fallback, caching, cost tracking.
    # Set LITELLM_PROXY_URL=http://localhost:4000 to activate.
    litellm_proxy_url: str | None = None
    litellm_master_key: str | None = None
    litellm_model: str = "judge-model"

    # Langfuse tracing (optional) — when the public + secret keys are set, every
    # LLM call flowing through the gateway is emitted to Langfuse as a generation
    # span. Unset -> tracing is a silent no-op (never breaks a run).
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # Per-call timeout for LLM requests (target + governance). Without this a
    # slow-but-not-erroring Azure response has nothing forcing it to fail fast,
    # so the Gateway's retry/backoff never engages and a single call can block
    # the whole council/agent pipeline far longer than the SDK's own default.
    llm_call_timeout_seconds: float = 60.0

    # Signs bearer tokens issued by /auth/sign-in and /auth/sign-up (see
    # app/core/security.py). The default is fine for a local/demo instance;
    # override via env for any shared deployment.
    secret_key: str = "dev-insecure-secret-change-me"

    # --- Pipeline concurrency ------------------------------------------------
    # These live here, rather than as module-level os.getenv() reads in the
    # services that use them, for two reasons. pydantic-settings loads the
    # project .env into *this* object without ever touching os.environ, so an
    # os.getenv() read silently ignored every one of these knobs when set in
    # .env — despite the surrounding comments documenting them as overridable.
    # And a module-level read binds the value at import time, so no test could
    # vary it. Read them via app.services.concurrency_settings, which resolves
    # get_settings() per call.
    #
    # Specialist agents (Layer 3) run concurrently; bounded low because the
    # per-agent probe pools multiply with this number. See agent_execution.py.
    agent_execution_max_workers: int = Field(default=3, ge=1)
    # Wall-clock ceiling on the whole specialist-agent phase, so one hung agent
    # cannot park a run in `agents_running`.
    agent_execution_budget_seconds: float = Field(default=900.0, gt=0)
    # Per-agent probe fan-out width.
    agent_probe_max_workers: int = Field(default=6, ge=1)
    # Process-wide ceiling on concurrent requests into an audited target system,
    # enforced in the gateway so it covers every caller (specialist-agent probes
    # AND metric-execution evaluators). 0 means "same as agent_probe_max_workers",
    # which keeps peak load on the target at its pre-parallelism level.
    agent_target_max_inflight: int = Field(default=0, ge=0)
    # Separate, much tighter ceiling for VIDEO generation requests, which the
    # general cap above cannot express: it counts requests, and a video request
    # is not comparable to a text one. A Sora-class job runs for minutes and the
    # provider limits how many may run AT ONCE (not per minute), answering
    # further creates with "Too many running tasks". With one shared cap of 6,
    # several 10-minute renders overlapped and every video probe in a live
    # Marketing Campaign Generator run failed that way. 1 serialises them, which
    # is what the provider's own limit effectively demands.
    agent_target_max_inflight_video: int = Field(default=1, ge=1)
    # A target asking us to wait longer than this is not throttling a burst, it
    # is out of quota: no backoff inside one audit can outlast the window, so
    # the run stops probing it instead of spending the rest of the allowance on
    # requests that are certain to be refused. Observed on a target answering
    # 429 with retry_after=62625s (a daily quota, resetting at midnight UTC).
    target_quota_exhausted_seconds: float = Field(default=300.0, gt=0)
    # How many image probes the vision evaluator sends per image-safety metric.
    # Each one is a real generation request against the audited system, so this
    # is the dial for trading sample size against the target's cost and rate
    # limit. Capped by the number of distinct prompts available.
    vision_image_probe_count: int = Field(default=4, ge=1)
    # Comparison probes sent alongside the baseline by the drift evaluator
    # (CM-030/031/032). Two is the floor for a rate to mean anything.
    drift_probe_count: int = Field(default=4, ge=2)
    # Garak probes carry their full attack corpus (e.g. HijackHateHumans ships
    # 256 prompts) and each one is a live call to the audited target, so these
    # bound it to a representative sample — see garak_evaluator.py. Previously
    # module-level `os.getenv(...)` reads, exactly the anti-pattern documented
    # at the top of this file: pydantic-settings loads .env without touching
    # os.environ, so setting either in .env silently did nothing.
    garak_max_probe_prompts: int = Field(default=10, ge=1)
    garak_generations: int = Field(default=1, ge=1)
    # Video generation is not an LLM call and cannot share LLM_CALL_TIMEOUT_SECONDS.
    # A Sora-class generation runs for minutes, so the 60s default guaranteed that
    # every video probe raised "target did not return a video: timed out" before
    # the target could answer — CM-033 Temporal Consistency was skipped on every
    # run it was ever planned for, without ever reaching the target. Covers both
    # the generation request and the download of the resulting asset.
    video_generation_timeout_seconds: float = Field(default=600.0, gt=0)
    # Metric evaluation fan-out width and phase budget. See metric_execution.py.
    metric_execution_max_workers: int = Field(default=3, ge=1)
    # FLOOR on the phase budget, not the whole story — the effective budget also
    # scales with how many metrics were planned (below). A flat 600s cannot serve
    # both a 7-metric smoke run and a full 42-metric catalog audit: measured at
    # ~6s per model call and ~3.5 calls per metric, 42 metrics need ~880s, so the
    # tail was recorded as "evaluation exceeded the metric-execution time budget"
    # — a clock expiring, presented as if the tools had failed.
    metric_execution_budget_seconds: float = Field(default=600.0, gt=0)
    # Per-metric allowance, applied as `max(floor, per_metric * metric_count)` —
    # so it only raises the budget above the floor once a run plans more than
    # (floor / this) metrics. The measured baseline is ~6s per model call and
    # 2-4 calls per metric against a live target with AGENT_TARGET_MAX_INFLIGHT=1
    # (the setting that keeps a rate-limited target from refusing everything),
    # i.e. ~25s for a typical metric. 120s leaves headroom for metrics that make
    # more calls than that, or targets slower than the measured one, at the cost
    # of a much longer worst-case phase: a 42-metric catalog audit now allows
    # 5040s (~84 min) rather than 1050s. Set to 0 to restore a purely flat budget.
    metric_execution_seconds_per_metric: float = Field(default=120.0, ge=0)

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
