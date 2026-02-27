# Testing Multitenancy Locally

How to test tenant subdomains and tenant isolation on your machine.

## 1. Environment variables

### Backend (`backend/.env`)

Set a base domain and optional default tenant so the backend can resolve tenants from the `Host` (or `X-Forwarded-Host`) header:

```env
# Base domain(s) that your app uses (comma-separated). Use a local domain for dev.
BASE_DOMAINS=localtest.me
# Optional: tenant slug when user hits the apex domain (e.g. app.localtest.me)
DEFAULT_TENANT_SLUG=test-tenant
# Reserved subdomains (product app, not tenants)
RESERVED_SUBDOMAINS=admin,billing,docs,status,api
# So the backend trusts X-Forwarded-Host from the frontend/proxy
TRUST_PROXY_HEADERS=true
```

For **hosts file** setup (see below), use your local domain:

```env
BASE_DOMAINS=app.local
DEFAULT_TENANT_SLUG=test-tenant
RESERVED_SUBDOMAINS=admin,billing,docs,status,api
TRUST_PROXY_HEADERS=true
```

### Frontend (`frontend/.env.local`)

Match the same base domain and reserved list so middleware resolves tenants correctly:

```env
# Same as backend BASE_DOMAINS
NEXT_PUBLIC_BASE_DOMAINS=localtest.me
# Optional: redirect apex to this tenant
NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test-tenant
# Optional: override reserved subdomains (defaults in code if not set)
# NEXT_PUBLIC_RESERVED_SUBDOMAINS=admin,billing,docs,status,api
```

For hosts file setup:

```env
NEXT_PUBLIC_BASE_DOMAINS=app.local
NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test-tenant
```

## 2. Tenant resolution from the browser

The backend resolves the tenant from the **Host** (or **X-Forwarded-Host**) header. When you use Next.js rewrites to proxy `/api/v1/*` to the backend, the backend might receive the **backend’s** host (e.g. `127.0.0.1:8001`) instead of the browser host (e.g. `tenant1.localtest.me:3001`). In that case tenant resolution fails unless you do one of the following.

### Option A: Use `x-tenant-slug` fallback (dev)

If the request has no tenant from Host (e.g. proxied and Host is the backend), the backend can use the **`x-tenant-slug`** header set by the frontend middleware. This is enabled only when **no tenant could be resolved from Host** (so it does not override real host-based resolution).

- Backend: ensure `TRUST_PROXY_HEADERS=true` and that the dependency that resolves the tenant uses the `x-tenant-slug` fallback (see code in `backend/app/multitenancy/deps.py`).
- Frontend: middleware already sets `x-tenant-slug` when the host is a tenant subdomain. When the request is rewritten to the backend, that header is forwarded.

So with the fallback in place, opening `http://tenant1.localtest.me:3001` in the browser and calling APIs via the Next rewrite should result in the backend seeing `x-tenant-slug: tenant1` and using it when Host doesn’t match `BASE_DOMAINS`.

### Option B: Reverse proxy that sets `X-Forwarded-Host`

Run a small reverse proxy in front of the app that:

1. Listens on the base domain (e.g. `localtest.me:3001` or `app.local:3001`).
2. Forwards to the Next.js dev server and to the backend (e.g. `/api/v1` → backend).
3. Forwards the **original Host** as `X-Forwarded-Host` to the backend.

Then the backend resolves the tenant from `X-Forwarded-Host` as in production. See [Local subdomains](local-subdomains.md) for domain setup (localtest.me, hosts file).

## 3. Local domain setup

Use one of these so that tenant subdomains resolve to your machine.

### Option 1: localtest.me (no config)

`localtest.me` and all its subdomains resolve to `127.0.0.1`.

- App: `http://tenant1.localtest.me:3001`
- Admin: `http://admin.localtest.me:3001`
- Apex: `http://localtest.me:3001` (redirects to `DEFAULT_TENANT_SLUG` if set)

Set `BASE_DOMAINS=localtest.me` (and same for frontend) as above.

### Option 2: Hosts file

Add to `C:\Windows\System32\drivers\etc\hosts` (Windows) or `/etc/hosts` (macOS/Linux):

```
127.0.0.1   tenant1.app.local
127.0.0.1   tenant2.app.local
127.0.0.1   admin.app.local
127.0.0.1   app.local
```

Then use:

- `http://tenant1.app.local:3001`
- `http://admin.app.local:3001`
- `http://app.local:3001`

Set `BASE_DOMAINS=app.local` in backend and frontend.

## 4. Seed tenants and memberships

Ensure the database has tenants and memberships so the app and tests make sense.

- **Seeding**: Your seed script or SQL should create at least one tenant (e.g. slug `test-tenant`) and assign users to it via `tenant_memberships`.
- **Tests**: `backend/tests/conftest.py` creates a tenant with slug `test-tenant` and uses `tenant_headers(access_token, host='test-tenant.app.com')` so API tests run in a tenant context.

Create a second tenant (e.g. slug `tenant2`) and a user that is only in one tenant to verify isolation.

## 5. Backend-only testing (no browser)

Use pytest with the tenant host header so the backend resolves the tenant from Host:

```python
# In tests, use the fixture that sets Host
response = client.get(
    "/api/v1/tracks",
    headers=tenant_headers(access_token, host="tenant1.localtest.me"),
)
# Or for second tenant
response = client.get(
    "/api/v1/tracks",
    headers=tenant_headers(access_token, host="tenant2.localtest.me"),
)
```

`tenant_headers()` in `backend/tests/conftest.py` sets the `Host` header so `get_tenant_context` resolves the tenant without needing a browser or proxy.

## 6. Checklist

- [ ] Backend and frontend `.env` have the same `BASE_DOMAINS` and (optionally) `DEFAULT_TENANT_SLUG`.
- [ ] `RESERVED_SUBDOMAINS` includes `admin` (and any other product subdomains).
- [ ] Tenants exist in the DB (e.g. `test-tenant`, `tenant2`) with users assigned.
- [ ] You open the app via a tenant subdomain (e.g. `http://test-tenant.localtest.me:3001`) or apex (redirects to default tenant).
- [ ] If the backend gets the wrong Host when using Next rewrites, use the **x-tenant-slug fallback** (Option A) or a **reverse proxy** (Option B).

## See also

- [Local subdomains](local-subdomains.md) — localtest.me, nip.io, hosts file
- [Multitenancy overview](../multitenancy/overview.md) — routing and tenant context
- [Where tenant is set](../multitenancy/tenant-set-reference.md) — code reference
