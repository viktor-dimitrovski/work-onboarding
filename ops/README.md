# Ops scripts (local backup + VPS deploy)

This folder contains **operator scripts** for:

- **Local DB backup → upload → VPS restore (overwrite)**.
- **Deploy backend** (pull/build/migrate/restart).
- **Deploy frontend** (pull/build/restart).

These scripts are designed to work with the existing Ubuntu setup in `deploy/ubuntu/`:

- Backend env file: `/etc/onboarding/backend.env`
- Frontend env file: `/etc/onboarding/frontend.env`
- Services: `onboarding-backend`, `onboarding-frontend`

---

## Quick start

### 1) Create your local ops env

Copy:

- `ops/ops.env.example` → `ops/ops.env` (do **not** commit this file)

Fill in SSH + app directory + DB names.

### 2) DB: backup locally and overwrite on VPS

Run (double-click or from cmd):

- `ops/local/run-db-sync.bat --force`

What it does:

- creates a timestamped `pg_dump` (custom format) locally into `ops/_backups/`
- uploads it to the VPS
- runs `ops/vps/restore-db.sh` remotely with **--force** (drops/recreates DB then restores)

### 3) Deploy backend only

- `ops/local/run-deploy-backend.bat`

### 4) Deploy frontend only

- `ops/local/run-deploy-frontend.bat`

---

## Using Git Bash directly (optional)

If you prefer to run bash scripts manually:

```bash
bash ops/local/db-sync.sh --env ops/ops.env --force
bash ops/local/deploy-backend.sh --env ops/ops.env
bash ops/local/deploy-frontend.sh --env ops/ops.env
```

---

## Notes / assumptions

- Your VPS is Ubuntu and has:
  - `postgresql-client` tools (`pg_dump`, `pg_restore`) installed
  - systemd services installed by `deploy/ubuntu/05_install_systemd_services.sh`
- Your repo exists on the VPS at `OPS_REMOTE_APP_DIR` (default `/opt/my-onboarding`).
- For DB restore, the script uses `deploy/ubuntu/deploy.env` if present; otherwise it falls back to `/etc/onboarding/backend.env` (`DATABASE_URL`).

