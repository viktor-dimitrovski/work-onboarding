from datetime import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    PasswordResetRequest,
    RefreshRequest,
    TokenResponse,
    UserSummary,
)
from app.services import audit_service, auth_service, oauth_service
from app.utils.rate_limit import SimpleRateLimiter


router = APIRouter(prefix='/auth', tags=['auth'])
login_rate_limiter = SimpleRateLimiter(max_requests=8, window_seconds=60)


def _to_user_summary(user: User) -> UserSummary:
    roles = [user_role.role.name for user_role in user.user_roles]
    return UserSummary(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=roles,
        last_login_at=user.last_login_at,
    )


@router.post('/login', response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    client_ip = request.client.host if request.client else 'unknown'
    if not login_rate_limiter.hit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail='Too many login attempts. Try again later.',
        )

    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if not user:
        audit_service.log_action(
            db,
            actor_user_id=None,
            action='user_login',
            entity_type='auth',
            status='failure',
            details={'email': payload.email.lower()},
            ip_address=client_ip,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')

    login_rate_limiter.reset(client_ip)
    access_token, refresh_token = auth_service.issue_token_pair(
        db,
        user=user,
        ip_address=client_ip,
        user_agent=request.headers.get('user-agent'),
    )
    audit_service.log_action(
        db,
        actor_user_id=user.id,
        action='user_login',
        entity_type='auth',
        status='success',
        details={'email': user.email, 'timestamp': datetime.utcnow().isoformat()},
        ip_address=client_ip,
    )
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_to_user_summary(user),
    )


@router.get('/oauth/{provider}/start')
def oauth_start(provider: str, request: Request) -> RedirectResponse:
    redirect_uri = str(request.url_for('oauth_callback', provider=provider))
    url = oauth_service.build_authorization_url(provider, redirect_uri)
    return RedirectResponse(url)


@router.get('/oauth/{provider}/callback', name='oauth_callback')
def oauth_callback(
    provider: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    redirect_uri = str(request.url_for('oauth_callback', provider=provider))
    info = oauth_service.handle_oauth_callback(
        db,
        provider=provider,
        code=code,
        state=state,
        redirect_uri=redirect_uri,
    )

    user = oauth_service.upsert_oauth_user(db, info=info, actor_user_id=None)
    access_token, refresh_token = auth_service.issue_token_pair(
        db,
        user=user,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get('user-agent'),
    )
    audit_service.log_action(
        db,
        actor_user_id=user.id,
        action='user_login_oauth',
        entity_type='auth',
        status='success',
        details={'email': user.email, 'provider': provider, 'timestamp': datetime.utcnow().isoformat()},
        ip_address=request.client.host if request.client else 'unknown',
    )
    db.commit()
    db.refresh(user)

    frontend_callback = settings.FRONTEND_BASE_URL.rstrip('/') + '/oauth/callback'
    params = urlencode({'access_token': access_token, 'refresh_token': refresh_token, 'provider': provider})
    return RedirectResponse(f'{frontend_callback}?{params}')


@router.post('/refresh', response_model=TokenResponse)
def refresh(payload: RefreshRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    user, access_token, refresh_token = auth_service.refresh_token_pair(
        db,
        refresh_token=payload.refresh_token,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get('user-agent'),
    )
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_to_user_summary(user),
    )


@router.post('/logout', status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: LogoutRequest, db: Session = Depends(get_db)) -> None:
    auth_service.revoke_refresh_token(db, refresh_token=payload.refresh_token)
    db.commit()


@router.get('/me', response_model=UserSummary)
def me(current_user: User = Depends(get_current_active_user)) -> UserSummary:
    return _to_user_summary(current_user)


@router.post('/password-reset-request')
def password_reset_request(payload: PasswordResetRequest) -> dict[str, str]:
    return {
        'message': 'Password reset request accepted. TODO: integrate email provider and reset token flow.',
        'email': payload.email,
    }
