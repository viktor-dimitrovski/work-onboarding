# RBAC and Module Gating

Tenant access is controlled by roles and module enablement.

## Roles

Canonical roles:

- `owner`
- `admin`
- `manager`
- `member`
- `viewer`
- `super_admin` (product app only)

Each API endpoint declares required permissions. Role-to-permission mappings live in `backend/app/auth/permissions.py`.

## Permissions

Permissions are expressed as `resource:action` (e.g., `assignments:write`).
The permission list is shared between frontend and backend to keep checks consistent.

## Module gating

Tenant modules determine which features are available. Each request resolves a module list in tenant context.
Frontend pages use the module list to show/hide navigation and features. Backend endpoints enforce the module list to prevent access if a module is disabled.

## Tenant context endpoint

The `/api/v1/tenants/me` endpoint returns:

- tenant summary
- membership role
- enabled modules

Use this endpoint to populate the client-side tenant context.
