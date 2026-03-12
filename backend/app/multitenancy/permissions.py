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
    'compliance',
    'users',
    'settings',
    'billing',
    'releases',
    'integration_registry'
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
    'compliance': {'compliance:read', 'compliance:write', 'compliance:admin'},
    'users': {'users:read', 'users:write'},
    'settings': {'settings:manage'},
    'billing': {'billing:read', 'billing:manage'},
    'integration_registry': {'ir:read', 'ir:write', 'ir:approve', 'ir:admin'},
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    # Cross-module oversight role — replaces legacy 'manager'
    'supervisor': {
        'tracks:read',
        'assignments:read',
        'assignments:write',
        'assignments:review',
        'assessments:read',
        'assessments:write',
        'assessments:take',
        'reports:read',
        'users:read',
    },
    'tenant_admin': {
        'users:read',
        'users:write',
    },
    'compliance_viewer': {'compliance:read'},
    'compliance_editor': {'compliance:read', 'compliance:write'},
    'compliance_admin': {'compliance:read', 'compliance:write', 'compliance:admin'},
    'ir_viewer': {'ir:read'},
    'ir_editor': {'ir:read', 'ir:write'},
    'ir_approver': {'ir:read', 'ir:write', 'ir:approve'},
    'ir_admin': {'ir:read', 'ir:write', 'ir:approve', 'ir:admin'},
    'billing_viewer': {'billing:read'},
    'billing_manager': {'billing:read', 'billing:manage'},
    'release_viewer': {'releases:read'},
    'release_editor': {'releases:read', 'releases:write'},
    'tracks_editor': {'tracks:read', 'tracks:write'},
    'assessments_editor': {'assessments:read', 'assessments:write', 'assessments:take'},
    'reports_viewer': {'reports:read'},
    'settings_manager': {'settings:manage'},
}

ROLE_MODULE_REQUIREMENTS: dict[str, str] = {
    'compliance_viewer': 'compliance',
    'compliance_editor': 'compliance',
    'compliance_admin': 'compliance',
    'ir_viewer': 'integration_registry',
    'ir_editor': 'integration_registry',
    'ir_approver': 'integration_registry',
    'ir_admin': 'integration_registry',
    'billing_viewer': 'billing',
    'billing_manager': 'billing',
    'release_viewer': 'releases',
    'release_editor': 'releases',
    'tracks_editor': 'tracks',
    'assessments_editor': 'assessments',
    'reports_viewer': 'reports',
    'settings_manager': 'settings',
}


def validate_roles_for_tenant(roles: list[str], tenant_enabled_modules: set[str]) -> list[str]:
    """Return role names that require a module not enabled for the tenant."""
    invalid: list[str] = []
    for role in roles:
        required_module = ROLE_MODULE_REQUIREMENTS.get(role)
        if required_module and required_module not in tenant_enabled_modules:
            invalid.append(role)
    return invalid


ROLE_LABELS: dict[str, dict[str, str]] = {
    'company': {
        'supervisor': 'supervisor',
        'tenant_admin': 'tenant_admin',
        'billing_viewer': 'billing_viewer',
        'billing_manager': 'billing_manager',
        'release_viewer': 'release_viewer',
        'release_editor': 'release_editor',
        'tracks_editor': 'tracks_editor',
        'assessments_editor': 'assessments_editor',
        'reports_viewer': 'reports_viewer',
        'settings_manager': 'settings_manager',
    },
    'education': {
        'supervisor': 'supervisor',
        'tenant_admin': 'tenant_admin',
        'billing_viewer': 'billing_viewer',
        'billing_manager': 'billing_manager',
        'release_viewer': 'release_viewer',
        'release_editor': 'release_editor',
        'tracks_editor': 'tracks_editor',
        'assessments_editor': 'assessments_editor',
        'reports_viewer': 'reports_viewer',
        'settings_manager': 'settings_manager',
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
    # None means the module query was skipped (e.g. super_admin bypass) — fall back to all modules.
    # An explicit empty set means the tenant has no module rows → return empty (no access).
    if ctx.enabled_modules is None:
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
