"""Symmetric encryption for secrets stored at rest (target-endpoint API keys).

Uses Fernet (AES-128-CBC + HMAC) keyed by ``settings.secret_encryption_key``.
The key is a urlsafe-base64 32-byte value; generate one with::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Ciphertext is stored in the database; plaintext never is. Callers decrypt only
at the moment a target is probed. When no key is configured, storing a secret
raises ``SecretEncryptionUnavailable`` so we never persist plaintext by accident.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class SecretEncryptionUnavailable(RuntimeError):
    """Raised when a secret must be encrypted/decrypted but no key is configured."""


class SecretDecryptionError(RuntimeError):
    """Raised when stored ciphertext cannot be decrypted with the current key."""


def _get_fernet() -> Fernet | None:
    key = get_settings().secret_encryption_key
    if not key:
        return None
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:  # malformed key
        raise SecretEncryptionUnavailable(
            "SECRET_ENCRYPTION_KEY is set but is not a valid Fernet key. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        ) from exc


def encryption_available() -> bool:
    """True when a usable encryption key is configured."""
    return _get_fernet() is not None


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext secret, returning urlsafe ciphertext.

    Raises SecretEncryptionUnavailable when no key is configured.
    """
    fernet = _get_fernet()
    if fernet is None:
        raise SecretEncryptionUnavailable(
            "Cannot store an endpoint secret: SECRET_ENCRYPTION_KEY is not configured. "
            "Set it in the environment to enable encrypted secret storage."
        )
    return fernet.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt ciphertext produced by encrypt_secret.

    Raises SecretEncryptionUnavailable when no key is configured, or
    SecretDecryptionError when the ciphertext does not match the current key.
    """
    fernet = _get_fernet()
    if fernet is None:
        raise SecretEncryptionUnavailable(
            "Cannot read an endpoint secret: SECRET_ENCRYPTION_KEY is not configured."
        )
    try:
        return fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise SecretDecryptionError(
            "Stored endpoint secret could not be decrypted with the current "
            "SECRET_ENCRYPTION_KEY (key rotated or ciphertext corrupted)."
        ) from exc
