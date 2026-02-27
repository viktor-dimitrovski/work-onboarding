# Internal Employee Onboarding Platform (MVP)

Production-minded MVP for a modular monolith onboarding platform covering role-based tracks, assignment snapshots, progress submissions, mentor approvals, and dashboard reporting.

## Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn-style UI primitives
- Forms/validation: React Hook Form + Zod
- Backend: FastAPI (Python 3.11+), SQLAlchemy 2.x, Alembic
- Database: PostgreSQL only
- Auth: JWT access + refresh with RBAC
- Tooling: Docker, docker-compose, pytest, Ruff, Black, ESLint, Prettier

## Monorepo Layout

```text
.
├─ frontend/
├─ backend/
├─ database/
│  └─ sql/
├─ docs/
├─ scripts/
├─ docker-compose.yml
├─ Makefile
└─ README.md
```

## Docs

Start at `docs/README.md` for architecture and product documentation.

## Core Modules Implemented

- Identity and access: users, roles, user-role mapping, JWT auth/refresh/logout, `/auth/me`, password reset stub endpoint.
- Tracks: templates, versions, phases, tasks, resources, duplicate, publish.
- Assignments: assign employee to published track and generate immutable assignment snapshot.
- Progress and submissions: task submissions, mentor decisions, quiz attempts, next-task recommendation.
- Reporting: admin/HR, mentor, and employee dashboards.
- Audit logging: login success/failure, track publish, assignment creation, mentor review.

## Environment Variables

### Backend (`backend/.env`)

Required:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `JWT_REFRESH_SECRET_KEY`
- `APP_ENV`
- `CORS_ORIGINS`
- `FIRST_ADMIN_EMAIL`
- `FIRST_ADMIN_PASSWORD`

Optional:

- `ACCESS_TOKEN_EXPIRE_MINUTES` (default `30`)
- `REFRESH_TOKEN_EXPIRE_DAYS` (default `7`)

### Frontend (`frontend/.env.local`)

- `NEXT_PUBLIC_API_BASE_URL` (default `/api/v1`)
- `BACKEND_API_URL` (used by Next rewrite, default `http://localhost:8001`)

Optional, for AI-assisted track drafting (Create track → "Draft with AI"):

- `OPENAI_API_KEY` – required for AI drafting. Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). If you only see "Default project" when creating the key, that project may not have access to all models.
- `OPENAI_MODEL` – model to use (e.g. `gpt-4o-mini`, `gpt-3.5-turbo`). If you get a 403 "project does not have access to model", set this to a model your project can use (e.g. `gpt-3.5-turbo`) or add billing/model access for your project under [platform.openai.com/settings/organization](https://platform.openai.com/settings/organization).
- `OPENAI_TEXT_FORMAT` – set to `json_object` if using older models (e.g. `gpt-3.5-turbo`) that do not support Structured Outputs.
- `OPENAI_INCLUDE_TEMPERATURE` – set to `false` for models that don't support it (e.g. `gpt-5.2-pro`) to avoid an extra retry.
- `OPENAI_TEXT_VERBOSITY` – set to `low` to reduce output length (often faster) on GPT‑5 models.
- `OPENAI_MAX_OUTPUT_TOKENS` – optional hard cap for GPT‑5 output tokens (can reduce latency/cost, but too low may truncate output).
- `OPENAI_TIMEOUT_MS` – timeout for the OpenAI call in ms (default `60000`). Increase (e.g. `90000`) if you see timeouts with larger prompts or slower models.

## Replit Setup

1. Create Replit Secrets for backend:
   - `DATABASE_URL` (Replit PostgreSQL URL)
   - `JWT_SECRET_KEY`
   - `JWT_REFRESH_SECRET_KEY`
   - `APP_ENV=development`
   - `CORS_ORIGINS=https://<your-replit-domain>`
   - `FIRST_ADMIN_EMAIL`
   - `FIRST_ADMIN_PASSWORD`
2. Create frontend env file from `frontend/.env.example`.
3. Install dependencies:
   - `pip install -r backend/requirements.txt`
   - `cd frontend && npm install`
4. Run one command from repo root:
   - `python scripts/dev.py`
5. Open frontend on port `3001` (rewrites `/api/v1/*` to backend).

### Replit PostgreSQL Notes

- The app auto-uses `DATABASE_URL` when present.
- If Replit DB is missing, point `DATABASE_URL` to external PostgreSQL (Neon/Supabase/etc.).
- SQLite fallback is intentionally not implemented.

## Local Setup (Non-Docker)

1. Copy env files:
   - `cp backend/.env.example backend/.env`
   - `cp frontend/.env.example frontend/.env.local`
2. Start PostgreSQL and set `DATABASE_URL` to your DB.
3. Install dependencies:
   - `pip install -r backend/requirements.txt`
   - `cd frontend && npm install`
4. Run migrations:
   - `cd backend && alembic upgrade head`
5. Seed data:
   - `python scripts/seed_backend.py`
6. Start full stack:
   - `python scripts/dev.py`

## Windows Quick Start (Root Scripts)

1. Create local Postgres app user + DB (one-time):

```bat
init-db.bat
```

Optional params:

```bat
init-db.bat [superuser] [host] [port]
```

2. Install requirements and start backend + frontend:

```bat
setup-and-start.bat
```

3. Next starts (after setup):

```bat
start-dev.bat
```

### Dedicated PostgreSQL user

- Recommended: yes, use a dedicated DB user for this app.
- Local convenience: you can use `postgres`, but dedicated user is better for parity with production and least privilege.
- This repo scripts create:
  - user: `onboarding_app`
  - database: `onboarding`
  - password: `onboarding_app_dev_password`
- SQL file used: `scripts/create_local_postgres.sql`

## Docker Setup

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:8001`
- Postgres: `localhost:5432`

## Ubuntu VPS Deployment (Systemd Services)

All deployment scripts are in:

- `deploy/ubuntu/`

From app root on Ubuntu:

```bash
cp deploy/ubuntu/deploy.env.example deploy/ubuntu/deploy.env
nano deploy/ubuntu/deploy.env
sudo bash deploy/ubuntu/deploy_all.sh
```

Root wrapper script is also available:

```bash
sudo bash ./deploy-ubuntu.sh
```

What this does:

- installs required packages (Python, PostgreSQL, Node.js, nginx)
- creates dedicated PostgreSQL user/database and privileges
- creates backend/frontend env files
- installs backend/frontend dependencies and builds frontend
- runs Alembic migrations + SQL objects/seeds
- installs and starts services:
  - `onboarding-backend`
  - `onboarding-frontend`
- configures nginx reverse proxy (if enabled in `deploy.env`)

Check service status and logs:

```bash
sudo bash deploy/ubuntu/check_status.sh
```

Or:

```bash
sudo bash ./deploy-ubuntu-status.sh
```

## SQL Assets (`database/sql`)

- `000_extensions.sql`
- `001_local_admin_bootstrap_optional.sql`
- `010_schema.sql`
- `020_seed_reference.sql`
- `030_seed_demo.sql`
- `040_views.sql`
- `050_functions.sql`
- `900_verify.sql`
- `910_drop_dev_only.sql`

Apply manually via `psql` or use:

```bash
python scripts/seed_backend.py
```

## API Docs

- Swagger UI: `http://localhost:8001/api/v1/docs`
- OpenAPI JSON: `http://localhost:8001/api/v1/openapi.json`

## Testing

### Backend

```bash
cd backend
pytest
```

`TEST_DATABASE_URL` is required for backend tests.

### Frontend

```bash
cd frontend
npm run test
```

## Lint and Format

### Backend

```bash
cd backend
ruff check app tests
black app tests
```

### Frontend

```bash
cd frontend
npm run lint
npx prettier --write .
```

## Make Targets

- `make dev`
- `make test`
- `make lint`
- `make format`
- `make migrate`
- `make seed`
- `make reset-dev-db`
- `make docker-up`
- `make docker-down`

## Demo Seed Accounts

`030_seed_demo.sql` provisions demo users. Password for all demo users:

- `ChangeMe123!`

Emails:

- `super.admin@example.com` (super_admin + admin)
- `admin.operations@example.com` (admin)
- `mentor.devops@example.com` (mentor)
- `employee.alex@example.com` (employee)
- `employee.morgan@example.com` (employee)
- `hr.viewer@example.com` (hr_viewer)

## Troubleshooting

- `ModuleNotFoundError: psycopg`:
  - Install backend requirements: `pip install -r backend/requirements.txt`.
- `CORS` issues:
  - Ensure `CORS_ORIGINS` includes the frontend origin.
- 401/403 on frontend:
  - Check role assignment in `user_roles` and token expiration.
- Migration errors:
  - Verify `DATABASE_URL` points to PostgreSQL.
- `500` on `/api/v1/users` with email validation error (reserved domains like `.local` / `.test`):
  - Update existing user emails in Postgres to a real domain (e.g. `example.com` or your company domain).
  - Helper: `python scripts/fix_reserved_emails.py --to-domain example.com --apply`.
- Seed script failure:
  - Confirm `000_extensions.sql` executed or extension privileges allow `pgcrypto`.
- `init-db.bat` fails:
  - Ensure PostgreSQL client tools (`psql`) are installed and in `PATH`.
  - Run with superuser credentials (`postgres`) and correct host/port.

## Checkpoints

Git commits are blocked in this environment, so rollback checkpoints were exported as zip snapshots:

- `checkpoints/milestone-1-backend-v2.zip`
- `checkpoints/milestone-2-frontend-v2.zip`
- `checkpoints/milestone-3-database-tooling-docs-v2.zip`

Zero-byte `.patch` files may exist from a failed diff-based attempt and can be ignored.
