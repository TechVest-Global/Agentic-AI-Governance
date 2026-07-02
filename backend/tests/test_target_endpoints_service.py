from collections.abc import Generator

import app.models  # noqa: F401 — register all tables
import pytest
from app.core.crypto import decrypt_secret, encrypt_secret, encryption_available
from app.models.ai_system import AISystem
from app.schemas.governance import TargetEndpointCreate
from app.services.target_endpoints import (
    create_target_endpoint,
    resolve_target_endpoint,
)
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    SQLModel.metadata.drop_all(engine)


def _make_system(session: Session, *, endpoint_ref: str | None = None) -> AISystem:
    system = AISystem(
        name="Resolver System",
        owner="Gov",
        system_type="chatbot",
        target_endpoint_ref=endpoint_ref,
    )
    session.add(system)
    session.commit()
    session.refresh(system)
    return system


# ── Crypto ────────────────────────────────────────────────────────────────────

def test_encryption_key_is_configured_for_tests() -> None:
    # The developer .env carries SECRET_ENCRYPTION_KEY; conftest does not clear it.
    assert encryption_available() is True


def test_encrypt_decrypt_round_trip() -> None:
    ciphertext = encrypt_secret("hunter2")
    assert ciphertext != "hunter2"
    assert decrypt_secret(ciphertext) == "hunter2"


# ── Resolution ──────────────────────────────────────────────────────────────--

def test_resolve_prefers_default_and_decrypts_secret(session: Session) -> None:
    system = _make_system(session)
    create_target_endpoint(
        session,
        system.id,
        TargetEndpointCreate(name="prod", url="https://prod.example.com", secret="key-1"),
    )

    resolved = resolve_target_endpoint(session, system.id)
    assert resolved is not None
    assert resolved.source == "endpoint"
    assert resolved.url == "https://prod.example.com"
    assert resolved.api_key == "key-1"  # decrypted from ciphertext


def test_resolve_honours_explicit_override(session: Session) -> None:
    system = _make_system(session)
    create_target_endpoint(
        session,
        system.id,
        TargetEndpointCreate(name="prod", url="https://prod.example.com"),
    )
    staging = create_target_endpoint(
        session,
        system.id,
        TargetEndpointCreate(
            name="staging", url="https://staging.example.com", is_default=False
        ),
    )

    resolved = resolve_target_endpoint(session, system.id, endpoint_id=staging.id)
    assert resolved is not None
    assert resolved.url == "https://staging.example.com"


def test_resolve_falls_back_to_legacy_ref(session: Session) -> None:
    system = _make_system(session, endpoint_ref="https://legacy.example.com/chat")

    resolved = resolve_target_endpoint(session, system.id)
    assert resolved is not None
    assert resolved.source == "legacy"
    assert resolved.url == "https://legacy.example.com/chat"


def test_resolve_returns_none_without_target(session: Session) -> None:
    system = _make_system(session, endpoint_ref="config://not-a-url")
    assert resolve_target_endpoint(session, system.id) is None


def test_first_endpoint_is_default_second_is_not(session: Session) -> None:
    system = _make_system(session)
    first = create_target_endpoint(
        session, system.id, TargetEndpointCreate(name="a", url="https://a.example.com")
    )
    second = create_target_endpoint(
        session, system.id, TargetEndpointCreate(name="b", url="https://b.example.com")
    )
    assert first.is_default is True
    assert second.is_default is False
