# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (not backend/), e.g.:
#   docker build -f backend/Dockerfile -t governance-backend .
#
# The backend depends on THREE separate, mutually-incompatible Python
# environments (see docs/deployment plan, "The 3-venv problem"):
#   .venv         (3.14) — the app itself; pins openai<2.0 for garak/ragas
#   .venv-pyrit   (3.14) — PyRIT needs openai>=2.2, conflicts with the above
#   .venv-ragas   (3.12) — ragas/nest_asyncio don't support 3.14's asyncio
# Each is built in its own stage, then all three are copied into one runtime
# image — the existing subprocess.run(...) bridge between them doesn't care
# it's running in a container, as long as all three interpreters exist on
# the same filesystem.

# ---- Stage: main venv (Python 3.14) ----
FROM python:3.14-slim AS venv-main
WORKDIR /build
COPY pyproject.toml ./
COPY backend ./backend
# Installs both this project's third-party dependencies AND a copy of the
# local `app` package. The latter is NOT what actually runs (see runtime
# stage below) — setuptools' default packaging only bundles .py files, and
# would silently drop the non-.py prompt template YAML assets the app reads
# at runtime (backend/app/configs/templates/valid/*.yaml). Rather than fight
# package_data/MANIFEST config for a copy we don't use, the runtime stage
# runs against a full loose copy of backend/ instead (identical to how this
# app is already run locally, via `--app-dir backend`) and only keeps this
# install for the dependency resolution.
# Plain pip's resolver hits "resolution-too-deep" on this dependency set (no
# lockfile, and fastapi/presidio/ragas/deepeval/garak/inspect-ai/langfuse
# together form a graph too complex for pip's backtracking resolver to solve
# in one shot). uv's resolver handles the same graph in seconds.
RUN pip install --no-cache-dir uv \
 && python -m venv .venv \
 && uv pip install --python .venv/bin/python --no-cache .

# ---- Stage: PyRIT venv (Python 3.14, openai>=2.2) ----
FROM python:3.14-slim AS venv-pyrit
RUN python -m venv /build/.venv-pyrit \
 && /build/.venv-pyrit/bin/pip install --no-cache-dir --upgrade pip \
 && /build/.venv-pyrit/bin/pip install --no-cache-dir "pyrit>=0.14.0"

# ---- Stage: ragas venv (Python 3.12) ----
# Exact pinned combination verified locally to satisfy both ragas and garak's
# langchain/openai requirements at once (see pyproject.toml's own comment).
FROM python:3.12-slim AS venv-ragas
RUN python -m venv /build/.venv-ragas \
 && /build/.venv-ragas/bin/pip install --no-cache-dir --upgrade pip \
 && /build/.venv-ragas/bin/pip install --no-cache-dir \
      "ragas==0.3.2" \
      "langchain-openai==0.3.27" \
      "langchain-community==0.3.27" \
      "langchain-core==0.3.86" \
      "openai<2.0.0"

# ---- Runtime: assemble all three interpreters; the main venv runs the app ----
FROM python:3.14-slim AS runtime

RUN groupadd --system app && useradd --system --gid app --create-home --home-dir /app app

WORKDIR /app

COPY --chown=app:app --from=venv-main  /build/.venv        ./.venv
COPY --chown=app:app --from=venv-pyrit /build/.venv-pyrit  ./.venv-pyrit
COPY --chown=app:app --from=venv-ragas /build/.venv-ragas  ./.venv-ragas

# The real source of truth for the running app (see note in the venv-main
# stage above) — includes the prompt-template YAML assets and Alembic
# migrations, which a pip install of the local package would not carry.
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app backend ./backend

ENV PYRIT_PYTHON=/app/.venv-pyrit/bin/python \
    RAGAS_PYTHON=/app/.venv-ragas/bin/python \
    PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1

# COPY --chown applies ownership during the copy itself instead of a separate
# recursive `chown -R` pass afterward — on a multi-GB, multi-venv tree like
# this one, a trailing chown -R can take 15+ minutes and is a common point of
# BuildKit flakiness; chowning per-COPY avoids that walk entirely.
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3)" || exit 1

# --workers 1 deliberately: the governance pipeline's BackgroundTask state and
# the SSE progress stream both live in a single process's memory. Scale
# REPLICAS in Container Apps instead of workers inside one container.
# --app-dir backend matches how this app is already run locally — it makes
# the loose backend/app copy (not the pip-installed one) the thing Python
# actually imports.
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
