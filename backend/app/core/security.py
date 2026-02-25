from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings


# Use bcrypt_sha256 for new hashes so long passwords are handled safely.
# Keep plain bcrypt for backward compatibility with existing seeded hashes.
pwd_context = CryptContext(schemes=['bcrypt_sha256', 'bcrypt'], deprecated='auto')


class TokenDecodeError(Exception):
    pass


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def _create_token(payload: dict[str, Any], secret: str, expires_delta: timedelta) -> str:
    data = payload.copy()
    expire = datetime.now(UTC) + expires_delta
    data.update({'exp': expire})
    return jwt.encode(data, secret, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str) -> str:
    return _create_token(
        payload={'sub': subject, 'token_type': 'access'},
        secret=settings.JWT_SECRET_KEY,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(subject: str) -> str:
    return _create_token(
        payload={'sub': subject, 'token_type': 'refresh'},
        secret=settings.JWT_REFRESH_SECRET_KEY,
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise TokenDecodeError('Invalid access token') from exc

    if payload.get('token_type') != 'access':
        raise TokenDecodeError('Unexpected token type for access token')
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.JWT_REFRESH_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise TokenDecodeError('Invalid refresh token') from exc

    if payload.get('token_type') != 'refresh':
        raise TokenDecodeError('Unexpected token type for refresh token')
    return payload


def hash_token(token: str) -> str:
    return sha256(token.encode('utf-8')).hexdigest()
