from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.error_handlers import (
    application_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.core.exceptions import ApplicationError


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    )

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(ApplicationError, application_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.on_event("startup")
    def _migrate_llm_call_log_columns() -> None:
        """Add probe transcript columns if they don't exist yet (safe no-op if present)."""
        from sqlalchemy import inspect, text
        from app.db.session import engine as _engine
        with _engine.connect() as conn:
            cols = {c["name"] for c in inspect(_engine).get_columns("llm_call_logs")}
            if "prompt_text" not in cols:
                conn.execute(text("ALTER TABLE llm_call_logs ADD COLUMN prompt_text TEXT"))
            if "response_text" not in cols:
                conn.execute(text("ALTER TABLE llm_call_logs ADD COLUMN response_text TEXT"))
            conn.commit()

    @app.on_event("startup")
    def _migrate_runphase_enum() -> None:
        """Ensure the runphase enum includes 'completed'.

        Python's RunPhase has `completed` but early migrations created the DB
        enum without it, so the pipeline's finalize step (current_phase ->
        completed) threw on commit and left runs stuck at council_running. Add
        the value if missing. ALTER TYPE ... ADD VALUE must run outside a
        transaction, hence AUTOCOMMIT. Runs before reconciliation, which relies
        on this value.
        """
        from sqlalchemy import text
        from app.db.session import engine as _engine

        with _engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("ALTER TYPE runphase ADD VALUE IF NOT EXISTS 'completed'"))

    @app.on_event("startup")
    def _reconcile_interrupted_runs() -> None:
        """Finalize runs orphaned by a prior worker restart.

        The governance pipeline runs as a FastAPI BackgroundTask and does not
        survive a process restart, so any run mid-pipeline when the server
        stopped is left non-terminal with no task to finish it. Reconcile them
        on startup so watchers stop hanging and the auditor/developer views show
        the true final state.
        """
        import logging

        from sqlmodel import Session

        from app.db.session import engine as _engine
        from app.services.orchestration import reconcile_interrupted_runs

        try:
            with Session(_engine) as session:
                reconcile_interrupted_runs(session)
        except Exception:  # noqa: BLE001 — never block startup on reconciliation
            logging.getLogger(__name__).exception("Startup run reconciliation failed")

    return app


app = create_app()
