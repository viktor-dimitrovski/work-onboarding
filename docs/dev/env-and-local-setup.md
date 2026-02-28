# Environment Variables & Local PC Setup

Which env vars to set, in which files, and how to run the app on your local PC.

---

## 1. Backend — `backend/.env`

Create `backend/.env` (copy from below or from `backend/.env.example` if present).

### Required (must set)

| Variable | Description | Example (local dev) |
|----------|-------------|---------------------|
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://onboarding_app:onboarding_app_dev_password@127.0.0.1:5432/onboarding` |
| `JWT_SECRET_KEY` | Signing secret for access tokens (min 32 chars) | e.g. a long random string |
| `JWT_REFRESH_SECRET_KEY` | Signing secret for refresh tokens (min 32 chars) | e.g. another long random string |
| `FIRST_ADMIN_EMAIL` | Email of the first admin user (created on bootstrap) | `admin@example.com` |
| `FIRST_ADMIN_PASSWORD` | Password for that user (min 8 chars) | `YourSecurePassword123!` |

### Optional (have defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_ENV` | `development` | Set to `production` in production. |
| `CORS_ORIGINS` | `http://localhost:3001` | Comma-separated origins for CORS. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token TTL. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token TTL. |
| `FRONTEND_BASE_URL` | `http://localhost:3001` | Used for OAuth redirects etc. |

### Multitenancy (optional for local dev)

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_DOMAINS` | `app.com` | Comma-separated base domains for tenant resolution. For local subdomain testing use `localtest.me` or `app.local`. |
| `RESERVED_SUBDOMAINS` | `admin,billing,docs,status,api` | Subdomains that are product apps, not tenants. |
| `DEFAULT_TENANT_SLUG` | — | Slug used when user hits apex domain (e.g. redirects to `{slug}.{base_domain}`). |
| `TRUST_PROXY_HEADERS` | `true` | Use `X-Forwarded-Host` for tenant resolution. Keep `true` when behind Next.js or a proxy. |

### OAuth (optional)

| Variable | Description |
|----------|-------------|
| `MICROSOFT_TENANT` | Azure AD tenant (default `common`). |
| `MICROSOFT_CLIENT_ID` | Azure app client ID. |
| `MICROSOFT_CLIENT_SECRET` | Azure app secret. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret. |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID. |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret. |

### GitHub automation (optional)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Bot PAT used to create branches/commits/PRs for WO/REL files. |
| `GITHUB_REPO_OWNER` | GitHub repo owner/org. |
| `GITHUB_REPO_NAME` | GitHub repo name. |
| `GITHUB_BASE_BRANCH` | Base branch for PRs (default `main`). |

---

## 2. Frontend — `frontend/.env.local`

Create `frontend/.env.local`. No `.env.example` is committed; use the table below.

### Required for API and proxy

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` | API path used by the browser (Next rewrites this to the backend). |
| `BACKEND_API_URL` | `http://127.0.0.1:8001` | Backend URL used by Next.js rewrites. Must match where the backend runs. |

### Multitenancy (optional for local dev)

Only needed if you test tenant subdomains (e.g. `tenant1.localtest.me:3001`). Match backend values.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_BASE_DOMAINS` or `BASE_DOMAINS` | Same as backend `BASE_DOMAINS` (e.g. `localtest.me` or `app.local`). |
| `NEXT_PUBLIC_RESERVED_SUBDOMAINS` or `RESERVED_SUBDOMAINS` | Same as backend (e.g. `admin,billing,docs,status,api`). |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` or `DEFAULT_TENANT_SLUG` | Same as backend (e.g. `test-tenant`). |

### AI draft track (optional)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for “Draft with AI” when creating a track. |
| `OPENAI_MODEL` | e.g. `gpt-4o-mini`, `gpt-3.5-turbo`. |
| `OPENAI_API_BASE` | Default `https://api.openai.com/v1`. |
| `OPENAI_PROJECT_ID` | If using a project-scoped key. |
| `OPENAI_TIMEOUT_MS` | Timeout in ms. |
| Others | See README “Optional, for AI-assisted track drafting”. |

---

## 3. Local PC dev — minimal setup

### One-time

1. **PostgreSQL**  
   Ensure PostgreSQL is installed and running. Create a DB and user (e.g. via `scripts/create_local_postgres.sql` or your `init-db.bat` if on Windows).

2. **Backend env**  
   In `backend/`, create `.env` with at least:
   ```env
   DATABASE_URL=postgresql://onboarding_app:onboarding_app_dev_password@127.0.0.1:5432/onboarding
   JWT_SECRET_KEY=your-long-secret-at-least-32-characters-long
   JWT_REFRESH_SECRET_KEY=another-long-secret-at-least-32-characters
   APP_ENV=development
   CORS_ORIGINS=http://localhost:3001
   FIRST_ADMIN_EMAIL=admin@example.com
   FIRST_ADMIN_PASSWORD=YourSecurePassword123!
   ```
   Optionally for multitenancy (e.g. localtest.me):
   ```env
   BASE_DOMAINS=localtest.me
   DEFAULT_TENANT_SLUG=test-tenant
   RESERVED_SUBDOMAINS=admin,billing,docs,status,api
   TRUST_PROXY_HEADERS=true
   ```

3. **Frontend env**  
   In `frontend/`, create `.env.local` with at least:
   ```env
   NEXT_PUBLIC_API_BASE_URL=/api/v1
   BACKEND_API_URL=http://127.0.0.1:8001
   ```
   If you use multitenancy with subdomains, add (match backend):
   ```env
   NEXT_PUBLIC_BASE_DOMAINS=localtest.me
   NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test-tenant
   ```

4. **Migrations and seed**  
   From repo root:
   ```bash
   cd backend && alembic upgrade head && python -c "from app.db.session import SessionLocal; from app.services.bootstrap_service import ensure_reference_data; db=SessionLocal(); ensure_reference_data(db); db.commit(); db.close()"
   ```
   Or use your existing seed script (e.g. `scripts/seed_backend.py`).

### Every time you develop

- Start backend (e.g. `uvicorn app.main:app --reload --host 0.0.0.0 --port 8001` from `backend/`).
- Start frontend (e.g. `npm run dev` from `frontend/`).
- Or use your single script (e.g. `scripts/dev.py`, `setup-and-start.bat` / `start-dev.bat` on Windows).

- Frontend: `http://localhost:3001`  
- Backend API: `http://localhost:8001`  
- API docs: `http://localhost:8001/api/v1/docs`

- Log in with `FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD`. If you use multitenancy and a default tenant, ensure that tenant exists and the user has a membership (seed or admin UI).

---

## 4. Summary — “new” variables for multitenancy

If you’re adding env vars specifically for the multitenancy / tenant-resolution work, these are the ones to add:

| File | Variables |
|------|-----------|
| `backend/.env` | `BASE_DOMAINS`, `RESERVED_SUBDOMAINS`, `DEFAULT_TENANT_SLUG`, `TRUST_PROXY_HEADERS` |
| `frontend/.env.local` | `NEXT_PUBLIC_BASE_DOMAINS` (or `BASE_DOMAINS`), `NEXT_PUBLIC_RESERVED_SUBDOMAINS` (optional), `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` (or `DEFAULT_TENANT_SLUG`) |

For local PC dev you can leave multitenancy vars at defaults (or set `BASE_DOMAINS=localtest.me` and `DEFAULT_TENANT_SLUG=test-tenant` if you test subdomains). See [Testing multitenancy locally](local-multitenancy-testing.md) for details.

---

## 5. Blocked POST when using `localtest.me:3001`

If you open the app at **`http://localtest.me:3001/login`** and the login request shows as **blocked** in the Network tab (e.g. `(blocked:other)`) with Request URL `http://127.0.0.1:8001/api/v1/auth/login`, the browser is doing a **cross-origin** request (origin `http://localtest.me:3001` → backend `http://127.0.0.1:8001`) and CORS or mixed context blocks it.

**Fix (recommended):** Use a **relative** API base URL so the browser always talks to the same origin; Next.js will proxy to the backend.

- In **`frontend/.env.local`** set:
  ```env
  NEXT_PUBLIC_API_BASE_URL=/api/v1
  ```
  Do **not** set it to `http://127.0.0.1:8001/api/v1` (or any absolute backend URL).  
  Then the login request goes to `http://localtest.me:3001/api/v1/auth/login`, Next.js rewrites it to the backend, and there is no cross-origin request from the browser.

**If you must use an absolute backend URL** in the frontend (e.g. for a separate SPA), the backend must allow the frontend origin in CORS:

- In **`backend/.env`** add the origin you use in the browser to `CORS_ORIGINS`:
  ```env
  CORS_ORIGINS=http://localhost:3001,http://localtest.me:3001
  ```
  Restart the backend after changing.
