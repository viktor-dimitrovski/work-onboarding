from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_active_user, get_user_role_names
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership


DEFAULT_MODULES = {
    'tracks',
    'assignments',
    'assessments',
    'reports',
    'users',
    'settings',
    'billing',
    'releases',
}

MODULE_PERMISSIONS: dict[str, set[str]] = {
    'tracks': {'tracks:read', 'tracks:write'},
    'assignments': {
        'assignments:read',
        'assignments:write',
        'assignments:submit',
        'assignments:review',
    },
    'releases': {'releases:read', 'releases:write'},
    'assessments': {'assessments:read', 'assessments:write', 'assessments:take'},
    'reports': {'reports:read'},
    'users': {'users:read', 'users:write'},
    'settings': {'settings:manage'},
    'billing': {'billing:read', 'billing:manage'},
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    'member': {'tracks:read', 'assignments:read', 'assignments:submit', 'assessments:take'},
    'manager': {
        'tracks:read',
        'assignments:read',
        'assignments:write',
        'assignments:review',
        'releases:read',
        'releases:write',
        'assessments:read',
        'assessments:take',
        'reports:read',
        'users:read',
    },
    'mentor': {
        'tracks:read',
        'assignments:read',
        'assignments:write',
        'assignments:review',
        'releases:read',
        'assessments:read',
        'assessments:take',
        'reports:read',
    },
    'tenant_admin': {
        'tracks:read',
        'tracks:write',
        'assignments:read',
        'assignments:write',
        'assignments:submit',
        'assignments:review',
        'releases:read',
        'releases:write',
        'assessments:read',
        'assessments:write',
        'assessments:take',
        'reports:read',
        'users:read',
        'users:write',
        'settings:manage',
        'billing:read',
        'billing:manage',
    },
    'parent': {'assignments:read'},
}

ROLE_LABELS: dict[str, dict[str, str]] = {
    'company': {
        'member': 'employee',
        'manager': 'manager',
        'mentor': 'mentor',
        'tenant_admin': 'tenant_admin',
    },
    'education': {
        'member': 'student',
        'manager': 'manager',
        'mentor': 'teacher',
        'tenant_admin': 'tenant_admin',
        'parent': 'parent',
    },
}


def role_label(tenant_type: str, role: str | None) -> str | None:
    if not role:
        return None
    return ROLE_LABELS.get(tenant_type, {}).get(role, role)


def permissions_for_roles(roles: list[str]) -> set[str]:
    permissions: set[str] = set()
    for role in roles:
        permissions |= ROLE_PERMISSIONS.get(role, set())
    return permissions


def enabled_modules(ctx: TenantContext) -> set[str]:
    if not ctx.enabled_modules:
        return set(DEFAULT_MODULES)
    return set(ctx.enabled_modules)


def module_enabled(ctx: TenantContext, module_key: str) -> bool:
    return module_key in enabled_modules(ctx)


def require_module(module_key: str) -> Callable:
    def checker(ctx: TenantContext = Depends(require_tenant_membership)) -> TenantContext:
        if not module_enabled(ctx, module_key):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Module disabled')
        return ctx

    return checker


def require_permission(permission: str) -> Callable:
    def checker(
        ctx: TenantContext = Depends(require_tenant_membership),
        current_user: User = Depends(get_current_active_user),
    ) -> TenantContext:
        if 'super_admin' in get_user_role_names(current_user):
            return ctx
        permissions = permissions_for_roles(ctx.roles)
        if permission not in permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Insufficient permissions')
        return ctx

    return checker


def require_access(module_key: str, permission: str) -> Callable:
    def checker(
        ctx: TenantContext = Depends(require_tenant_membership),
        current_user: User = Depends(get_current_active_user),
    ) -> TenantContext:
        if 'super_admin' in get_user_role_names(current_user):
            return ctx
        if not module_enabled(ctx, module_key):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Module disabled')
        permissions = permissions_for_roles(ctx.roles)
        if permission not in permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Insufficient permissions')
        return ctx

    return checker
