"""AES-256-GCM symmetric encryption for tenant secrets stored in settings_json.

Usage:
    from app.core.crypto import encrypt_secret, decrypt_secret

    ciphertext = encrypt_secret("ghp_...")       # → "enc:v1:<base64>"
    plaintext  = decrypt_secret("enc:v1:<base64>") # → "ghp_..."

The encryption key is taken from settings.CREDENTIALS_ENCRYPTION_KEY.
It must be a 32-byte hex string (64 hex characters), e.g.:
    CREDENTIALS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

To generate one:
    python -c "import secrets; print(secrets.token_hex(32))"

If the key is not configured the functions raise RuntimeError to prevent
silently storing or returning plaintext.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_PREFIX = "enc:v1:"
_NONCE_BYTES = 12  # 96-bit nonce recommended for AES-GCM


def _get_key() -> bytes:
    from app.core.config import settings  # avoid circular import at module level

    raw = (settings.CREDENTIALS_ENCRYPTION_KEY or "").strip()
    if not raw:
        raise RuntimeError(
            "CREDENTIALS_ENCRYPTION_KEY is not set. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    try:
        key = bytes.fromhex(raw)
    except ValueError as exc:
        raise RuntimeError("CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).") from exc
    if len(key) != 32:
        raise RuntimeError(f"CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got {len(key)}.")
    return key


def encrypt_secret(plaintext: str) -> str:
    """Encrypt *plaintext* and return an opaque ``enc:v1:<base64>`` token."""
    if not plaintext:
        return ""
    key = _get_key()
    nonce = os.urandom(_NONCE_BYTES)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    blob = base64.urlsafe_b64encode(nonce + ciphertext).decode()
    return f"{_PREFIX}{blob}"


def decrypt_secret(token: str) -> str:
    """Decrypt a token produced by :func:`encrypt_secret`. Returns plaintext."""
    if not token:
        return ""
    if not token.startswith(_PREFIX):
        # Already plaintext (migration path) — return as-is but do not re-encrypt here.
        return token
    key = _get_key()
    blob = base64.urlsafe_b64decode(token[len(_PREFIX):])
    nonce = blob[:_NONCE_BYTES]
    ciphertext = blob[_NONCE_BYTES:]
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, None).decode()
    except Exception as exc:
        raise ValueError("Failed to decrypt secret — key mismatch or data corruption.") from exc


def is_encrypted(token: str) -> bool:
    """Return True if *token* looks like an encrypted secret."""
    return bool(token) and token.startswith(_PREFIX)
