from datetime import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_user_role_names
from app.core.config import settings
from app.db.session import get_db, set_tenant_id
from app.models.rbac import User
from app.models.tenant import Tenant, TenantMembership
from app.multitenancy.tenant_resolution import resolve_host
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    PasswordResetRequest,
    RefreshRequest,
    SetPasswordRequest,
    TokenResponse,
    UserSummary,
)
from app.services import audit_service, auth_service, email_service, oauth_service
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
        must_change_password=bool(user.password_change_required),
    )


def _resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    """If the request originates from a tenant subdomain, return the Tenant. Otherwise None."""
    tenant_slug: str | None = None

    # 1. Try the explicit header set by Next.js middleware (works through the proxy rewrite).
    header_slug = (request.headers.get('x-tenant-slug') or '').strip().lower()
    if header_slug:
        tenant_slug = header_slug

    # 2. Fall back to host resolution (works when Nginx forwards directly to the backend).
    if not tenant_slug:
        host = (request.headers.get('x-forwarded-host') or request.headers.get('host') or '').strip()
        if host:
            base_domains = [d.strip().lower() for d in settings.BASE_DOMAINS.split(',') if d.strip()]
            reserved = {s.strip().lower() for s in settings.RESERVED_SUBDOMAINS.split(',') if s.strip()}
            product_map = {k: k for k in reserved}
            resolution = resolve_host(host, base_domains=base_domains, reserved=reserved, product_map=product_map)
            if resolution.kind == 'tenant' and resolution.tenant_slug:
                tenant_slug = resolution.tenant_slug

    if not tenant_slug:
        return None
    return db.scalar(select(Tenant).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)))


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

    tenant = _resolve_tenant_from_request(request, db)
    if tenant:
        is_super = 'super_admin' in get_user_role_names(user)
        if not is_super:
            set_tenant_id(db, str(tenant.id))
            membership = db.scalar(
                select(TenantMembership).where(
                    TenantMembership.tenant_id == tenant.id,
                    TenantMembership.user_id == user.id,
                    TenantMembership.status == 'active',
                )
            )
            if not membership:
                audit_service.log_action(
                    db,
                    actor_user_id=user.id,
                    action='user_login',
                    entity_type='auth',
                    status='failure',
                    details={'email': user.email, 'reason': 'not_tenant_member', 'tenant': tenant.slug},
                    ip_address=client_ip,
                )
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail='You do not have access to this organization. Contact your administrator.',
                )

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


@router.post('/change-password', status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    client_ip = request.client.host if request.client else 'unknown'
    ok = auth_service.change_password(
        db,
        user=current_user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='user_password_change',
        entity_type='auth',
        entity_id=current_user.id,
        status='success' if ok else 'failure',
        details={},
        ip_address=client_ip,
    )
    db.commit()
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Current password is invalid')


@router.post('/password-reset-request', status_code=status.HTTP_204_NO_CONTENT)
def password_reset_request(payload: PasswordResetRequest, db: Session = Depends(get_db)) -> None:
    """Generate a password-reset token and send a reset email.

    Always returns 204 regardless of whether the email exists (prevents enumeration).
    """
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active == True))  # noqa: E712
    if user:
        raw_token = auth_service.create_password_set_token(db, user=user, purpose='password_reset', expires_hours=24)
        db.commit()
        reset_url = f'{settings.FRONTEND_BASE_URL.rstrip("/")}/reset-password?token={raw_token}'
        email_service.send_password_reset(
            to_email=user.email,
            to_name=user.full_name or '',
            reset_url=reset_url,
        )


@router.post('/set-password', status_code=status.HTTP_204_NO_CONTENT)
def set_password(payload: SetPasswordRequest, db: Session = Depends(get_db)) -> None:
    """Consume an invitation or password-reset token and set the new password."""
    auth_service.consume_password_set_token(db, raw_token=payload.token, new_password=payload.new_password)
    db.commit()
