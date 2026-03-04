# Ops scripts (local backup + VPS deploy)

**Полн водич на македонски:** [docs/deployment/DEPLOYMENT-MK.md](../docs/deployment/DEPLOYMENT-MK.md) — три скрипти (база, backend, frontend), редослед, Pageant, што копираш на сервер.

This folder contains **operator scripts** for:

- **Local DB backup → upload → VPS restore (overwrite)**.
- **Deploy backend** (pull/build/migrate/restart).
- **Deploy frontend** (pull/build/restart).

These scripts are designed to work with the existing Ubuntu setup in `deploy/ubuntu/`:

- Backend env file: `/etc/solvebox-hub/backend.env`
- Frontend env file: `/etc/solvebox-hub/frontend.env`
- Services: `solvebox-hub-backend`, `solvebox-hub-frontend`

---

## What goes where (local vs server)

**On your PC (in `ops/ops.env`):**

| Variable | Purpose |
|----------|--------|
| `OPS_LOCAL_DATABASE_URL` | **Local** DB connection string — used only for `pg_dump` (source of the backup). |
| `OPS_SSH_HOST`, `OPS_SSH_USER`, `OPS_SSH_KEYFILE` | How to connect to the VPS (SSH). |
| `OPS_REMOTE_APP_DIR` | Path to the app on the VPS (e.g. `/opt/apps/solvebox-hub`). |
| `OPS_REMOTE_BACKUP_DIR` | Where dumps are uploaded on the VPS (e.g. `/var/backups/solvebox-hub/db`). |

You do **not** put the remote (VPS) database connection string in local `ops.env`. The restore script on the server gets the **target** DB from config **on the server** (see below).

**On the VPS (server):**

| What | Where | Purpose |
|------|--------|--------|
| Scripts | `ops/vps/` inside the repo (e.g. `/opt/apps/solvebox-hub/ops/vps/`) | `restore-db.sh` and `common.sh` — must be present (they come with the repo). |
| DB config | `/etc/solvebox-hub/backend.env` with `DATABASE_URL=postgresql://...` | Tells the restore script **which database on the VPS** to drop and restore into. |

So: local env = local DB (for dump) + SSH + paths. Server = scripts (in repo) + **one** config file on the server that describes the VPS database.

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

## PuTTY .ppk key: avoid typing passphrase 3–4 times

If you use a passphrase-protected `.ppk` key, plink/pscp will prompt once per step (mkdir, upload, restore). To type the passphrase only once:

1. Start **Pageant** (PuTTY SSH agent) from the Start menu or `C:\Program Files\PuTTY\pageant.exe`.
2. Right‑click the Pageant icon in the system tray → **Add Key** → select your `.ppk` and enter the passphrase once.
3. Leave Pageant running. After that, `run-db-sync.bat` (and deploy scripts) will use the loaded key and won’t prompt again.

---

## VPS: DB restore needs config on the server

For **Step 4 (remote restore)** to work, the VPS must have DB settings in one of these places:

- **Preferred:** `OPS_REMOTE_APP_DIR/deploy/ubuntu/deploy.env` with `DB_NAME`, `DB_USER`, `DB_PASSWORD` (e.g. copy from `deploy/ubuntu/deploy.env.example` and fill in).
- **Fallback:** `/etc/solvebox/backend.env` with `DATABASE_URL=postgresql://user:password@host:5432/dbname`.

If neither exists or is incomplete, the restore script will fail with “DB config not resolved”. Fix by creating `deploy.env` on the VPS (in the repo) or ensuring `backend.env` has a valid `DATABASE_URL`. Then run the sync again, or run the restore manually over SSH to see the script output:

```bash
plink -i YOUR_KEY deploy@YOUR_VPS "cd /opt/apps/solvebox-hub && sudo bash ops/vps/restore-db.sh --dump /var/backups/solvebox-hub/db/solvebox-hub-upload-....dump --force"
```

---

## Notes / assumptions

- Your VPS is Ubuntu and has:
  - `postgresql-client` tools (`pg_dump`, `pg_restore`) installed
  - systemd services installed by `deploy/ubuntu/05_install_systemd_services.sh`
- Your repo exists on the VPS at `OPS_REMOTE_APP_DIR` (e.g. `/opt/apps/solvebox-hub`).
- For DB restore, the script reads `/etc/solvebox-hub/backend.env` (or `/etc/solvebox/backend.env`) for `DATABASE_URL`.

