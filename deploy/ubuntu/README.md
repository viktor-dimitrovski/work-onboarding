# Ubuntu VPS Deployment Scripts

This folder contains production-oriented scripts to deploy the app from repository root on Ubuntu.

## Files

- `deploy_all.sh` - runs all deployment steps in order.
- `01_install_dependencies.sh` - installs system dependencies.
- `02_configure_postgres.sh` - creates DB user/database and privileges.
- `03_prepare_app.sh` - creates venv, installs backend/frontend dependencies, builds frontend.
- `04_migrate_and_seed.sh` - applies Alembic migrations and SQL objects.
- `05_install_systemd_services.sh` - installs and starts backend/frontend systemd services.
- `06_install_nginx_proxy.sh` - configures nginx reverse proxy (optional via config).
- `check_status.sh` - prints service status and recent logs.
- `deploy.env.example` - copy to `deploy.env` and customize.

## Usage

From project root:

```bash
cp deploy/ubuntu/deploy.env.example deploy/ubuntu/deploy.env
nano deploy/ubuntu/deploy.env
sudo bash deploy/ubuntu/deploy_all.sh
```

## Notes

- Scripts are idempotent for repeated runs.
- Database role/user creation is handled in `02_configure_postgres.sh`.
- Migrations run via Alembic, then SQL scripts are applied via `scripts/seed_backend.py`.
- Services installed:
  - `onboarding-backend`
  - `onboarding-frontend`

## Verify

```bash
sudo bash deploy/ubuntu/check_status.sh
```

If nginx is enabled and `DOMAIN` is configured, app is served on port 80.
