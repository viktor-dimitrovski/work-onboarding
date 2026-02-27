# Where Tenant Is Set — File Reference

All locations where tenant (or tenant_id / tenant context) is **set** or **assigned**, with file links and line references.

---

## Backend — Core

### [backend/app/db/session.py](../../backend/app/db/session.py)

Sets the request-scoped tenant ID for RLS (PostgreSQL session variable).

| Line | Code |
|------|------|
| 21–22 | `def set_tenant_id(db: Session, tenant_id: str) -> None:`<br>`    db.execute(text("SET LOCAL app.tenant_id = :tenant_id"), {"tenant_id": tenant_id})` |

---

### [backend/app/multitenancy/deps.py](../../backend/app/multitenancy/deps.py)

Resolves tenant from host, sets DB tenant ID and request state, builds `TenantContext`.

| Line | Code |
|------|------|
| 18–21 | `class TenantContext:`<br>`    tenant: Tenant`<br>`    membership: TenantMembership \| None`<br>`    ...` |
| 47–48 | `tenant_slug = resolution.tenant_slug or settings.DEFAULT_TENANT_SLUG` |
| 53–57 | `tenant = db.scalar(select(Tenant).where(...))`<br>`set_tenant_id(db, str(tenant.id))`<br>`request.state.tenant_id = tenant.id` |
| 78 | `return TenantContext(tenant=tenant, membership=membership, roles=roles, enabled_modules=set(modules))` |

---

### [backend/app/multitenancy/tenant_resolution.py](../../backend/app/multitenancy/tenant_resolution.py)

Returns resolution with **tenant_slug** set when subdomain is a valid tenant (not reserved).

| Line | Code |
|------|------|
| 62 | `return HostResolution(kind="tenant", base_domain=base_domain, tenant_slug=slug)` |

---

## Backend — API (set tenant_id / use ctx.tenant)

### [backend/app/api/v1/endpoints/admin.py](../../backend/app/api/v1/endpoints/admin.py)

| Line | Code |
|------|------|
| 71 | `tenant = Tenant(...)` (create) |
| 86 | `tenant_id=tenant.id` |
| 104, 109 | `tenant = db.scalar(...)`; `setattr(tenant, field, value)` |
| 130, 142, 182 | `set_tenant_id(db, str(tenant_id))` |
| 147, 192 | `tenant_id=tenant_id` (in queries / create) |

### [backend/app/api/v1/endpoints/tenants.py](../../backend/app/api/v1/endpoints/tenants.py)

| Line | Code |
|------|------|
| 25 | `tenant_id=ctx.tenant.id` |
| 30 | `tenant=TenantOut.model_validate(ctx.tenant)` |

### [backend/app/api/v1/endpoints/users.py](../../backend/app/api/v1/endpoints/users.py)

| Line | Code |
|------|------|
| 43, 66 | `tenant_id=ctx.tenant.id` |

### [backend/app/api/v1/endpoints/assignments.py](../../backend/app/api/v1/endpoints/assignments.py)

Uses `TenantContext` (ctx); tenant is set via deps, not in this file.

### [backend/app/api/v1/endpoints/progress.py](../../backend/app/api/v1/endpoints/progress.py)

| Line | Code |
|------|------|
| 54, 63, 72 | `tenant_id=ctx.tenant.id` |

### [backend/app/api/v1/endpoints/usage.py](../../backend/app/api/v1/endpoints/usage.py)

| Line | Code |
|------|------|
| 27, 29 | `tenant_id=ctx.tenant.id` |

### [backend/app/api/v1/endpoints/assessments.py](../../backend/app/api/v1/endpoints/assessments.py)

| Line | Code |
|------|------|
| 295, 386, 722 | `tenant_id=ctx.tenant.id` |

---

## Backend — Services

### [backend/app/services/assessment_classification_service.py](../../backend/app/services/assessment_classification_service.py)

| Line | Code |
|------|------|
| 99 | `set_tenant_id(db, str(tenant_id))` |
| 213 | `tenant_id=tenant_id` |

### [backend/app/services/usage_service.py](../../backend/app/services/usage_service.py)

| Line | Code |
|------|------|
| 22, 78 | `tenant_id=tenant_id` |
| 41, 67 | `UsageEvent.tenant_id == tenant_id` (filter) |

### [backend/app/services/user_service.py](../../backend/app/services/user_service.py)

| Line | Code |
|------|------|
| 87 | `TenantMembership.tenant_id == tenant_id` (filter) |

### [backend/app/services/oauth_service.py](../../backend/app/services/oauth_service.py)

| Line | Code |
|------|------|
| 58 | `tenant = settings.MICROSOFT_TENANT or "common"` (Azure AD tenant, not app tenant) |

---

## Backend — Models (server_default for tenant_id)

These set the **default** value for `tenant_id` from the session variable (RLS).

- **[backend/app/models/assignment.py](../../backend/app/models/assignment.py)** — lines 55, 109, 150, 202, 237, 268: `server_default=text("current_setting('app.tenant_id')::uuid")`
- **[backend/app/models/assessment.py](../../backend/app/models/assessment.py)** — lines 39, 70, 104, 128, 151, 185, 227, 267, 311, 352: same
- **[backend/app/models/audit.py](../../backend/app/models/audit.py)** — line 21: same
- **[backend/app/models/comment.py](../../backend/app/models/comment.py)** — line 36: same
- **[backend/app/models/track.py](../../backend/app/models/track.py)** — lines 33, 65, 100, 134, 174: same

---

## Backend — Migrations & tests

### [backend/alembic/versions/0008_tenant_id_rls.py](../../backend/alembic/versions/0008_tenant_id_rls.py)

| Line | Code |
|------|------|
| 63 | `tenant_id = conn.execute(...).scalar()` |
| 82 | `default_tenant_id = _ensure_default_tenant(conn)` |
| 319 | `server_default=sa.text("current_setting('app.tenant_id')::uuid")` |
| 328–329 | RLS: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` |

### [backend/tests/conftest.py](../../backend/tests/conftest.py)

| Line | Code |
|------|------|
| 21 | `os.environ.setdefault('DEFAULT_TENANT_SLUG', 'test-tenant')` |
| 119 | `tenant = Tenant(name='Test Tenant', slug='test-tenant', ...)` |
| 140 | `tenant_id=tenant.id` |

### [backend/tests/test_rls.py](../../backend/tests/test_rls.py)

| Line | Code |
|------|------|
| 10–11 | `def _set_tenant(db, tenant_id):`<br>`    db.execute(text("SET LOCAL app.tenant_id = :tenant_id"), ...)` |
| 37, 42, 46 | `_set_tenant(db_session, tenant_a.id)` / `tenant_b.id` |
| 53 | `tenant_id=tenant_a.id` |

---

## Frontend

### [frontend/middleware.ts](../../frontend/middleware.ts)

Sets header used by backend for tenant resolution (slug comes from host resolution).

| Line | Code |
|------|------|
| 50 | `requestHeaders.set('x-tenant-slug', resolution.tenantSlug);` |

### [frontend/modules/tenant-resolution/resolveHost.ts](../../frontend/modules/tenant-resolution/resolveHost.ts)

Returns resolution with **tenantSlug** set when subdomain is a valid tenant.

| Line | Code |
|------|------|
| 45 | `return { kind: 'tenant', host, baseDomain, tenantSlug: slug };` |

### [frontend/lib/tenant-context.tsx](../../frontend/lib/tenant-context.tsx)

Sets React tenant context from API.

| Line | Code |
|------|------|
| 20 | `const [context, setContext] = useState<TenantContextPayload \| null>(null);` |
| 37 | `setContext(data as TenantContextPayload);` |

### [frontend/app/admin/page.tsx](../../frontend/app/admin/page.tsx)

| Line | Code |
|------|------|
| 76 | `setTenants(tenantResponse.items);` |
| 256 | `onClick={() => setSelectedTenantId(tenant.id)}` |

---

## Summary

| Area | Main “set” location |
|------|----------------------|
| **DB session (RLS)** | [backend/app/db/session.py](../../backend/app/db/session.py) — `set_tenant_id()` |
| **Request tenant context** | [backend/app/multitenancy/deps.py](../../backend/app/multitenancy/deps.py) — `get_tenant_context()` sets `app.tenant_id` and `request.state.tenant_id`, returns `TenantContext` |
| **Host → tenant slug** | Backend: [tenant_resolution.py](../../backend/app/multitenancy/tenant_resolution.py) (line 62). Frontend: [resolveHost.ts](../../frontend/modules/tenant-resolution/resolveHost.ts) (line 45) |
| **Request header** | [frontend/middleware.ts](../../frontend/middleware.ts) — `x-tenant-slug` (line 50) |
| **React context** | [frontend/lib/tenant-context.tsx](../../frontend/lib/tenant-context.tsx) — `setContext` (lines 20, 37) |
