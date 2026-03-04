#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
Restore PostgreSQL database from a dump (OVERWRITES existing DB).

Usage:
  sudo bash ops/vps/restore-db.sh --dump /path/to/backup.dump --force

Options:
  --dump <file>           Path to pg_dump custom-format file (.dump)
  --force                 Required. Confirms destructive overwrite.
  --keep-running          Do not stop services before restore (not recommended)
  --no-migrate            Do not run alembic after restore
  --help                  Show help

Notes:
  - Loads DB config from backend.env (DATABASE_URL). Tries in order:
      1) /etc/solvebox-hub/backend.env
      2) /etc/solvebox/backend.env
EOF
}

DUMP_PATH=""
FORCE="false"
KEEP_RUNNING="false"
RUN_MIGRATE="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP_PATH="${2:-}"; shift 2 ;;
    --force) FORCE="true"; shift 1 ;;
    --keep-running) KEEP_RUNNING="true"; shift 1 ;;
    --no-migrate) RUN_MIGRATE="false"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

[[ -n "${DUMP_PATH}" ]] || { usage; die "--dump is required"; }
[[ -f "${DUMP_PATH}" ]] || die "Dump file not found: ${DUMP_PATH}"
[[ "${FORCE}" == "true" ]] || die "Refusing to overwrite DB without --force"

as_root_or_die
require_cmd pg_restore
require_cmd psql
require_cmd pg_dump
require_cmd systemctl

# 1) Load config from backend.env (no deploy.env — use DATABASE_URL)
BACKEND_ENV=""
for candidate in /etc/solvebox-hub/backend.env /etc/solvebox/backend.env; do
  if [[ -f "$candidate" ]]; then
    BACKEND_ENV="$candidate"
    break
  fi
done

if [[ -n "${BACKEND_ENV}" ]]; then
  log INFO "Loading config from ${BACKEND_ENV}"
  load_kv_env_file "${BACKEND_ENV}"
else
  log WARN "No backend.env at /etc/solvebox-hub/backend.env or /etc/solvebox/backend.env"
fi

APP_DIR="${OPS_REMOTE_APP_DIR:-${APP_DIR:-${ROOT_DIR}}}"
BACKEND_SERVICE="${OPS_BACKEND_SERVICE:-solvebox-hub-backend}"
FRONTEND_SERVICE="${OPS_FRONTEND_SERVICE:-solvebox-hub-frontend}"
REMOTE_BACKUP_DIR="${OPS_REMOTE_BACKUP_DIR:-/var/backups/solvebox-hub/db}"

POSTGRES_OS_USER="${POSTGRES_OS_USER:-postgres}"
DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

# Parse DATABASE_URL if we have it (backend.env usually has DATABASE_URL, not DB_NAME/DB_USER/DB_PASSWORD)
if [[ -z "${DB_NAME}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    read -r DB_USER DB_PASSWORD DB_HOST DB_PORT DB_NAME < <(
      python3 - <<'PY'
import os, re, sys
url = os.environ.get("DATABASE_URL","")
url = url.replace("postgresql+psycopg://","postgresql://")
m = re.match(r"^postgresql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)", url)
if not m:
  sys.exit(1)
user, pw, host, port, db = m.group(1), m.group(2), m.group(3), m.group(4) or "5432", m.group(5)
print(user, pw, host, port, db)
PY
    ) || true
  fi
fi

if [[ -z "${DB_NAME}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" ]]; then
  die "DB config not resolved. On the VPS create /etc/solvebox-hub/backend.env (or /etc/solvebox/backend.env) with DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
fi

install -d -m 0755 -o "${POSTGRES_OS_USER}" -g root "${REMOTE_BACKUP_DIR}"
# Make uploaded dump readable by the postgres OS user
chmod 644 "${DUMP_PATH}" 2>/dev/null || true

ts="$(date +%Y%m%d_%H%M%S)"
pre_backup="${REMOTE_BACKUP_DIR}/pre-restore-${DB_NAME}-${ts}.dump"

log INFO "Creating safety backup of current DB -> ${pre_backup}"
sudo -u "${POSTGRES_OS_USER}" env PGPASSWORD="${DB_PASSWORD}" \
  pg_dump -Fc --no-owner --no-acl -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -f "${pre_backup}" "${DB_NAME}" \
  || log WARN "Safety backup failed (continuing due to --force)."

if [[ "${KEEP_RUNNING}" != "true" ]]; then
  log INFO "Stopping services: ${BACKEND_SERVICE} ${FRONTEND_SERVICE}"
  systemctl stop "${BACKEND_SERVICE}" || true
  systemctl stop "${FRONTEND_SERVICE}" || true
fi

log INFO "Terminating connections to ${DB_NAME}"
sudo -u "${POSTGRES_OS_USER}" psql -v ON_ERROR_STOP=1 -d postgres -tAc \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null || true

log INFO "Dropping database (if exists): ${DB_NAME}"
sudo -u "${POSTGRES_OS_USER}" dropdb --if-exists "${DB_NAME}"

log INFO "Ensuring role exists: ${DB_USER}"
sudo -u "${POSTGRES_OS_USER}" psql -v ON_ERROR_STOP=1 -d postgres -tAc \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}'; END IF; END \$\$;" \
  >/dev/null

log INFO "Creating database: ${DB_NAME} (owner: ${DB_USER})"
sudo -u "${POSTGRES_OS_USER}" createdb -O "${DB_USER}" "${DB_NAME}"

log INFO "Restoring dump -> ${DB_NAME}"
sudo -u "${POSTGRES_OS_USER}" env PGPASSWORD="${DB_PASSWORD}" \
  pg_restore --no-owner --no-acl --clean --if-exists -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "${DUMP_PATH}"

if [[ "${RUN_MIGRATE}" == "true" ]]; then
  if [[ -n "${BACKEND_ENV}" && -f "${BACKEND_ENV}" && -d "${APP_DIR}/backend" && -x "${APP_DIR}/.venv/bin/alembic" ]]; then
    log INFO "Running alembic upgrade head (post-restore)"
    # shellcheck disable=SC1091
    set -a; source "${BACKEND_ENV}"; set +a
    sudo -u "${APP_USER:-solvebox}" bash -lc "cd '${APP_DIR}/backend' && '${APP_DIR}/.venv/bin/alembic' upgrade head" || true
  else
    log WARN "Skipping migrations (alembic not found or backend.env missing)."
  fi
fi

if [[ "${KEEP_RUNNING}" != "true" ]]; then
  log INFO "Starting services: ${BACKEND_SERVICE} ${FRONTEND_SERVICE}"
  systemctl start "${BACKEND_SERVICE}" || true
  systemctl start "${FRONTEND_SERVICE}" || true
fi

log INFO "Restore completed."

