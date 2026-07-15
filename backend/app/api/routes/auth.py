from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.core.exceptions import ApplicationError
from app.core.security import (
    AuthUser,
    authenticate_demo_user,
    create_access_token,
    decode_access_token,
    extract_bearer_token,
    provision_self_serve_user,
)
from app.schemas.auth import AuthResponse, AuthUserRead, SignInRequest, SignUpRequest

router = APIRouter(prefix="/auth")

# Paths under the API prefix that must stay reachable without a token —
# there is no identity to check yet at sign-in/sign-up time. Kept next to
# the routes themselves so the auth middleware in main.py and this router
# can't drift apart.
PUBLIC_PATHS = {"/auth/sign-in", "/auth/sign-up"}


def _invalid_credentials() -> ApplicationError:
    return ApplicationError(
        status_code=401,
        code="INVALID_CREDENTIALS",
        message="Invalid email or password.",
    )


@router.post("/sign-in", response_model=AuthResponse)
def sign_in(payload: SignInRequest) -> AuthResponse:
    user = authenticate_demo_user(payload.email, payload.password)
    if user is None:
        raise _invalid_credentials()
    token = create_access_token(user)
    return AuthResponse(user=AuthUserRead(**user.__dict__), token=token)


@router.post("/sign-up", response_model=AuthResponse)
def sign_up(payload: SignUpRequest) -> AuthResponse:
    user = provision_self_serve_user(name=payload.name, email=payload.email, role=payload.role)
    token = create_access_token(user)
    return AuthResponse(user=AuthUserRead(**user.__dict__), token=token)


@router.get("/me", response_model=AuthUserRead)
def read_current_user(authorization: Annotated[str | None, Header()] = None) -> AuthUserRead:
    token = extract_bearer_token(authorization)
    user = decode_access_token(token) if token else None
    if user is None:
        raise ApplicationError(
            status_code=401, code="UNAUTHORIZED", message="Authentication required."
        )
    return AuthUserRead(**user.__dict__)


def get_current_user(request: Request) -> AuthUser | None:
    """Identity attached by the auth middleware, if the request carried one.

    Optional by design: routes that want to bind an action to the caller
    (ledger writes, plan approval) use this to override client-suppliable
    fields with the authenticated identity; routes that don't care simply
    don't depend on it.
    """
    return getattr(request.state, "user", None)
