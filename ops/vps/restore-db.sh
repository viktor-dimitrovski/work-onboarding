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
  - Tries to load config from (in order):
      1) deploy/ubuntu/deploy.env (if repo exists on server)
      2) OPS_* env vars (if provided)
      3) /etc/onboarding/backend.env (DATABASE_URL)
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

# 1) Load config
DEPLOY_ENV="${ROOT_DIR}/deploy/ubuntu/deploy.env"
BACKEND_ENV="/etc/onboarding/backend.env"

load_kv_env_file "${DEPLOY_ENV}"

APP_DIR="${OPS_REMOTE_APP_DIR:-${APP_DIR:-${ROOT_DIR}}}"
BACKEND_SERVICE="${OPS_BACKEND_SERVICE:-onboarding-backend}"
FRONTEND_SERVICE="${OPS_FRONTEND_SERVICE:-onboarding-frontend}"
REMOTE_BACKUP_DIR="${OPS_REMOTE_BACKUP_DIR:-/var/backups/onboarding/db}"

POSTGRES_OS_USER="${POSTGRES_OS_USER:-postgres}"
DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

if [[ -z "${DB_NAME}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" ]]; then
  if [[ -f "${BACKEND_ENV}" ]]; then
    load_kv_env_file "${BACKEND_ENV}"
  fi
fi

# Fallback: parse DATABASE_URL if deploy.env wasn't used
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

[[ -n "${DB_NAME}" && -n "${DB_USER}" && -n "${DB_PASSWORD}" ]] || die "DB config not resolved. Set DB_NAME/DB_USER/DB_PASSWORD in deploy.env or backend.env."

install -d -m 0750 -o root -g root "${REMOTE_BACKUP_DIR}"

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
  if [[ -f "/etc/onboarding/backend.env" && -d "${APP_DIR}/backend" && -x "${APP_DIR}/.venv/bin/alembic" ]]; then
    log INFO "Running alembic upgrade head (post-restore)"
    # shellcheck disable=SC1091
    set -a; source /etc/onboarding/backend.env; set +a
    sudo -u "${APP_USER:-onboarding}" bash -lc "cd '${APP_DIR}/backend' && '${APP_DIR}/.venv/bin/alembic' upgrade head" || true
  else
    log WARN "Skipping migrations (alembic not found)."
  fi
fi

if [[ "${KEEP_RUNNING}" != "true" ]]; then
  log INFO "Starting services: ${BACKEND_SERVICE} ${FRONTEND_SERVICE}"
  systemctl start "${BACKEND_SERVICE}" || true
  systemctl start "${FRONTEND_SERVICE}" || true
fi

log INFO "Restore completed."

