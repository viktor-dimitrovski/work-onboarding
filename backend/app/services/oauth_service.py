from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.rbac import Role, User, UserRole


@dataclass(frozen=True)
class OAuthUserInfo:
    provider: str
    provider_id: str
    email: str
    full_name: str | None
    email_verified: bool


def _create_state(provider: str) -> str:
    payload = {
        "provider": provider,
        "nonce": secrets.token_urlsafe(12),
        "exp": datetime.now(UTC) + timedelta(minutes=settings.OAUTH_STATE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _verify_state(state: str, provider: str) -> None:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc
    if payload.get("provider") != provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth state mismatch")


def _provider_config(provider: str) -> dict[str, Any]:
    if provider == "google":
        return {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
            "scopes": ["openid", "email", "profile"],
        }
    if provider == "microsoft":
        tenant = settings.MICROSOFT_TENANT or "common"
        return {
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "auth_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            "token_url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "userinfo_url": "https://graph.microsoft.com/v1.0/me",
            "scopes": ["openid", "email", "profile", "User.Read"],
        }
    if provider == "github":
        return {
            "client_id": settings.GITHUB_CLIENT_ID,
            "client_secret": settings.GITHUB_CLIENT_SECRET,
            "auth_url": "https://github.com/login/oauth/authorize",
            "token_url": "https://github.com/login/oauth/access_token",
            "userinfo_url": "https://api.github.com/user",
            "scopes": ["read:user", "user:email"],
        }
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported OAuth provider")


def build_authorization_url(provider: str, redirect_uri: str) -> str:
    config = _provider_config(provider)
    if not config.get("client_id"):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="OAuth provider not configured")

    state = _create_state(provider)
    params = {
        "client_id": config["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(config["scopes"]),
        "state": state,
    }
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
    if provider == "microsoft":
        params["prompt"] = "select_account"

    return f"{config['auth_url']}?{urlencode(params)}"


def _exchange_code(provider: str, code: str, redirect_uri: str) -> dict[str, Any]:
    config = _provider_config(provider)
    if not config.get("client_id") or not config.get("client_secret"):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="OAuth provider not configured")
    data = {
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "code": code,
        "redirect_uri": redirect_uri,
    }
    if provider in ("google", "microsoft"):
        data["grant_type"] = "authorization_code"

    headers = {"Accept": "application/json"}
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(config["token_url"], data=data, headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OAuth token exchange failed: {resp.text[:2000]}",
        )
    return resp.json()


def _fetch_user_info(provider: str, access_token: str) -> OAuthUserInfo:
    config = _provider_config(provider)
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    with httpx.Client(timeout=15.0) as client:
        profile = client.get(config["userinfo_url"], headers=headers)
        profile.raise_for_status()
        profile_json = profile.json()

        if provider == "github":
            emails = client.get("https://api.github.com/user/emails", headers=headers)
            emails.raise_for_status()
            emails_json = emails.json()
        else:
            emails_json = []

    if provider == "google":
        email = profile_json.get("email")
        provider_id = profile_json.get("sub")
        full_name = profile_json.get("name")
        email_verified = bool(profile_json.get("email_verified"))
    elif provider == "microsoft":
        provider_id = profile_json.get("id")
        email = profile_json.get("mail") or profile_json.get("userPrincipalName")
        full_name = profile_json.get("displayName")
        email_verified = True
    else:  # github
        provider_id = str(profile_json.get("id"))
        full_name = profile_json.get("name") or profile_json.get("login")
        email = profile_json.get("email")
        email_verified = False
        if isinstance(emails_json, list):
            primary = next((e for e in emails_json if e.get("primary") and e.get("verified")), None)
            fallback = next((e for e in emails_json if e.get("verified")), None)
            picked = primary or fallback
            if picked:
                email = picked.get("email")
                email_verified = True

    if not provider_id or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth profile missing email")

    return OAuthUserInfo(
        provider=provider,
        provider_id=str(provider_id),
        email=email.lower(),
        full_name=full_name,
        email_verified=email_verified,
    )


def handle_oauth_callback(
    db: Session,
    *,
    provider: str,
    code: str,
    state: str,
    redirect_uri: str,
) -> OAuthUserInfo:
    _verify_state(state, provider)
    tokens = _exchange_code(provider, code, redirect_uri)
    access_token = tokens.get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth access token missing")
    return _fetch_user_info(provider, access_token)


def upsert_oauth_user(db: Session, *, info: OAuthUserInfo, actor_user_id: UUID | None) -> User:
    user = db.scalar(
        select(User)
        .where(User.oauth_provider == info.provider, User.oauth_provider_id == info.provider_id)
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )
    if user:
        return user

    existing = db.scalar(select(User).where(User.email == info.email))
    if existing:
        if existing.oauth_provider and existing.oauth_provider != info.provider:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already linked to a different provider",
            )
        existing.oauth_provider = info.provider
        existing.oauth_provider_id = info.provider_id
        existing.updated_by = actor_user_id
        db.flush()
        return db.scalar(
            select(User)
            .where(User.id == existing.id)
            .options(joinedload(User.user_roles).joinedload(UserRole.role))
        )

    user = User(
        email=info.email,
        full_name=info.full_name or info.email,
        hashed_password=None,
        is_active=True,
        oauth_provider=info.provider,
        oauth_provider_id=info.provider_id,
    )
    db.add(user)
    db.flush()

    role = db.scalar(select(Role).where(Role.name == "employee"))
    if not role:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Default role missing")
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.flush()

    return db.scalar(
        select(User)
        .where(User.id == user.id)
        .options(joinedload(User.user_roles).joinedload(UserRole.role))
    )
