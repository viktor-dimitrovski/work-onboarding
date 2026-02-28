from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db, set_tenant_id
from app.models.rbac import User
from app.models.tenant import Tenant, TenantMembership
from app.modules.billing.models import TenantModule
from app.multitenancy.tenant_resolution import resolve_host
from app.api.deps import get_current_active_user


@dataclass(frozen=True)
class TenantContext:
    tenant: Tenant
    membership: TenantMembership | None
    roles: list[str]
    enabled_modules: set[str]


def _get_host(request: Request) -> str | None:
    host = request.headers.get('x-forwarded-host') if settings.TRUST_PROXY_HEADERS else None
    if host:
        return host.split(',')[0].strip()
    return request.headers.get('host')


def get_tenant_context(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_active_user),
) -> TenantContext:
    host = _get_host(request)
    if not host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Missing host header')

    base_domains = [item.strip().lower() for item in settings.BASE_DOMAINS.split(',') if item.strip()]
    reserved = {item.strip().lower() for item in settings.RESERVED_SUBDOMAINS.split(',') if item.strip()}
    product_map = {key.strip().lower(): key.strip().lower() for key in reserved}

    resolution = resolve_host(host, base_domains=base_domains, reserved=reserved, product_map=product_map)
    if resolution.kind == 'product':
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Product subdomain is not a tenant')

    # Local-dev helper: when a request is proxied (e.g. Next.js rewrite), Host may be the backend's.
    # In that case, allow the frontend middleware to pass the tenant slug via a header.
    header_tenant_slug = (
        request.headers.get('x-tenant-slug', '').strip().lower() if settings.APP_ENV != 'production' else ''
    )
    # If the request hits the apex domain (no tenant subdomain) and no header was provided,
    # fall back to a default tenant in non-production. Migration 0008 seeds a `default` tenant.
    dev_fallback_slug = 'default' if settings.APP_ENV != 'production' else None
    tenant_slug = resolution.tenant_slug or header_tenant_slug or settings.DEFAULT_TENANT_SLUG or dev_fallback_slug
    if not tenant_slug:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not resolved')

    tenant = db.scalar(select(Tenant).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)))
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tenant not found')

    set_tenant_id(db, str(tenant.id))
    request.state.tenant_id = tenant.id

    membership = None
    roles: list[str] = []
    if current_user:
        membership = db.scalar(
            select(TenantMembership).where(
                TenantMembership.tenant_id == tenant.id,
                TenantMembership.user_id == current_user.id,
                TenantMembership.status == 'active',
            )
        )
        if membership:
            roles = [membership.role]

    modules = db.scalars(
        select(TenantModule.module_key).where(
            TenantModule.tenant_id == tenant.id, TenantModule.enabled.is_(True)
        )
    ).all()
    return TenantContext(tenant=tenant, membership=membership, roles=roles, enabled_modules=set(modules))


def require_tenant_membership(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
    if not ctx.membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not a member of this tenant')
    return ctx


def require_product_admin_host(request: Request) -> None:
    # In local/dev, we allow the admin API to be accessed from the default domain to keep
    # a single-console workflow. In production, enforce the dedicated admin host.
    if settings.APP_ENV != 'production':
        return

    host = _get_host(request)
    if not host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Missing host header')

    base_domains = [item.strip().lower() for item in settings.BASE_DOMAINS.split(',') if item.strip()]
    reserved = {item.strip().lower() for item in settings.RESERVED_SUBDOMAINS.split(',') if item.strip()}
    product_map = {key.strip().lower(): key.strip().lower() for key in reserved}

    resolution = resolve_host(host, base_domains=base_domains, reserved=reserved, product_map=product_map)
    if resolution.kind != 'product' or resolution.product_key != 'admin':
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Not a product admin host')
