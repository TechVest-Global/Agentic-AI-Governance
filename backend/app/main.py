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

    return app


app = create_app()
