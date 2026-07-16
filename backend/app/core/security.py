"""Minimal, dependency-free bearer-token auth.

This is a stateless HMAC-signed token (no DB-backed user table, no
password-reset flows) — intentionally lightweight for a local
governance-engine prototype rather than a full auth service. It closes the
concrete gap the platform had: previously every route accepted anonymous
requests with no identity at all, so audit-ledger entries and plan
approvals could be freely forged. Now a caller must present a token minted
by /auth/sign-in or /auth/sign-up, and that token's claims are what the
ledger/approval code trusts — not whatever the request body claims.

Two demo accounts are recognized by sign-in (mirroring the frontend's
DEMO_ACCOUNTS) so the product's demo-credentials UX keeps working end to
end; sign-up mints a token for a self-declared identity, matching today's
"no real user store yet" prototype behavior while still requiring every
subsequent write to carry a valid, expiring, signed token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

from app.core.config import get_settings

TOKEN_TTL_SECONDS = 8 * 60 * 60  # 8 hours


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    name: str
    role: str
    initials: str


DEMO_PASSWORD = "GovernAI2025!"
_DEMO_USERS: dict[str, AuthUser] = {
    "auditor@governai.com": AuthUser(
        id="usr_demo_auditor",
        email="auditor@governai.com",
        name="M. Okafor",
        role="Compliance Lead",
        initials="MO",
    ),
    "dev@governai.com": AuthUser(
        id="usr_demo_dev",
        email="dev@governai.com",
        name="R. Sharma",
        role="ML Engineer",
        initials="RS",
    ),
}


def authenticate_demo_user(email: str, password: str) -> AuthUser | None:
    """Real (if intentionally simple) credential check against the two demo accounts."""
    user = _DEMO_USERS.get(email.strip().lower())
    if user is None:
        return None
    if not hmac.compare_digest(password, DEMO_PASSWORD):
        return None
    return user


def _initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    if parts:
        return parts[0][:2].upper()
    return "U"


def provision_self_serve_user(*, name: str, email: str, role: str) -> AuthUser:
    """Mint an identity for the sign-up flow.

    There is no persisted user table yet — this mirrors the prototype's prior
    fully-client-side sign-up, but now the resulting identity is embedded in a
    real signed token instead of being freely assertable by the client on
    every subsequent request.
    """
    normalized_email = email.strip().lower()
    return AuthUser(
        id=f"usr_{hashlib.sha256(normalized_email.encode()).hexdigest()[:12]}",
        email=normalized_email,
        name=name.strip(),
        role=role,
        initials=_initials(name),
    )


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str) -> str:
    secret = get_settings().secret_key.encode()
    digest = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(digest)


def create_access_token(user: AuthUser, *, ttl_seconds: int = TOKEN_TTL_SECONDS) -> str:
    payload = {
        "sub": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "initials": user.initials,
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = _sign(payload_b64)
    return f"{payload_b64}.{signature}"


def decode_access_token(token: str) -> AuthUser | None:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(_sign(payload_b64), signature):
        return None
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("exp", 0) < time.time():
        return None
    try:
        return AuthUser(
            id=payload["sub"],
            email=payload["email"],
            name=payload["name"],
            role=payload["role"],
            initials=payload["initials"],
        )
    except KeyError:
        return None


def extract_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    scheme, _, token = authorization_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token
