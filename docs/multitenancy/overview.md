# Multitenancy Overview

This project implements strict tenant isolation on a single VPS using subdomain routing, per-request tenant context, and PostgreSQL Row Level Security (RLS).

## Routing model

- **Tenant subdomains**: `{tenant}.app.com` map to a single tenant.
- **Apex domain**: `app.com` redirects to a configured default tenant slug.
- **Product subdomains**: reserved subdomains such as `admin.app.com` are never treated as tenant slugs.

## Host resolution

Tenant identification is derived from the trusted `Host` or `X-Forwarded-Host` header only. User input is never accepted as a tenant identifier.

Frontend host resolution lives in `frontend/modules/tenant-resolution/`. The backend applies a Python equivalent in `backend/app/multitenancy/tenant_resolution.py`.

## Tenant context

For tenant routes, each request resolves a `TenantContext`:

- tenant record (slug, type, status)
- membership role for the current user
- enabled modules

The tenant context is used to:

- apply RLS (`SET LOCAL app.tenant_id`)
- enforce module gating
- enforce permission checks

## Reserved subdomains

Reserved product subdomains are validated and blocked from being treated as tenant slugs. See `RESERVED_SUBDOMAINS` in environment config.

## Admin product app

The superadmin portal is served from `admin.app.com` and uses `/admin` routes in the Next.js app.
Backend admin endpoints are protected by `super_admin` role and by product-host checks.
