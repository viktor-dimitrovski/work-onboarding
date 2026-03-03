"""Shared encryption-at-rest helpers.

AES-256-GCM with scrypt-derived keys. Ciphertext format:
  enc:v1:<base64(nonce|ciphertext|tag)>
"""

from __future__ import annotations

import base64
import hashlib
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


PREFIX = "enc:v1:"
NONCE_LEN = 12


@dataclass(frozen=True)
class KdfParams:
    n: int = 2**14
    r: int = 8
    p: int = 1
    length: int = 32

    def as_json(self) -> dict[str, int]:
        return {"n": self.n, "r": self.r, "p": self.p, "length": self.length}


def derive_key(passphrase: str, salt: bytes, params: KdfParams | None = None) -> bytes:
    if params is None:
        params = KdfParams()
    if not passphrase:
        raise ValueError("Passphrase is required")
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=params.n,
        r=params.r,
        p=params.p,
        dklen=params.length,
    )


def fingerprint_key(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()


def is_encrypted_value(value: str | None) -> bool:
    if not value:
        return False
    return value.startswith(PREFIX)


def encrypt_str(plaintext: str, key: bytes, aad: bytes) -> str:
    if plaintext is None:
        raise ValueError("plaintext is required")
    aes = AESGCM(key)
    nonce = os.urandom(NONCE_LEN)
    ciphertext = aes.encrypt(nonce, plaintext.encode("utf-8"), aad)
    payload = nonce + ciphertext
    return PREFIX + base64.b64encode(payload).decode("ascii")


def decrypt_str(ciphertext: str, key: bytes, aad: bytes) -> str:
    if not ciphertext.startswith(PREFIX):
        raise ValueError("ciphertext does not have encryption prefix")
    raw = base64.b64decode(ciphertext[len(PREFIX) :])
    nonce = raw[:NONCE_LEN]
    data = raw[NONCE_LEN:]
    aes = AESGCM(key)
    plaintext = aes.decrypt(nonce, data, aad)
    return plaintext.decode("utf-8")
