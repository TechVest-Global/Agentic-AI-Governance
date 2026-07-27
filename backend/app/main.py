from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.api.routes.auth import PUBLIC_PATHS
from app.core.config import get_settings
from app.core.error_handlers import (
    application_exception_handler,
    error_response,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.core.exceptions import ApplicationError
from app.core.security import decode_access_token, extract_bearer_token

# Methods that mutate state must present a valid bearer token. GETs (including
# the SSE progress stream, which can't attach custom headers) stay open so
# read-only access and live progress watching are unaffected — see
# backend/app/core/security.py for why this is a lightweight, stateless
# token rather than a full auth service.
_PROTECTED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


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

    @app.middleware("http")
    async def enforce_auth(request: Request, call_next):
        prefix = settings.api_v1_prefix
        path = request.url.path
        if (
            request.method in _PROTECTED_METHODS
            and path.startswith(prefix)
            and path[len(prefix):] not in PUBLIC_PATHS
        ):
            token = extract_bearer_token(request.headers.get("authorization"))
            user = decode_access_token(token) if token else None
            if user is None:
                return error_response(
                    status_code=401,
                    code="UNAUTHORIZED",
                    message="Authentication required. Sign in and retry with a bearer token.",
                )
            request.state.user = user
        return await call_next(request)

    app.include_router(api_router, prefix=settings.api_v1_prefix)

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
