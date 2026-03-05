#!/usr/bin/env bash
# Enterprise-safe PostgreSQL restore (drop & recreate DB, restore pg_dump custom format).
# - Designed for a VPS where PostgreSQL runs locally (same host).
# - Uses peer auth by running DB commands as the postgres OS user.
# - Restores objects as the target owner role via pg_restore --role=<owner>.
#
# Usage:
#   sudo bash restore-db.sh --dump /path/to/backup.dump --force
#
set -Eeuo pipefail

log() { printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${1:-INFO}" "${*:2}"; }
die() { log "ERR" "$*"; exit 1; }

usage() {
  cat <<'EOF'
Restore PostgreSQL database from a pg_dump custom-format file (.dump/.backup). OVERWRITES the DB.

Usage:
  sudo bash restore-db.sh --dump /path/to/backup.dump --force [options]

Required:
  --dump <file>           Path to pg_dump custom-format file (.dump/.backup)
  --force                 Confirms destructive overwrite

Options:
  --env <file>            backend.env file that contains DATABASE_URL (default: auto-detect)
  --db-name <name>        Override DB name (otherwise from DATABASE_URL)
  --db-owner <role>       Override DB owner role (otherwise from DATABASE_URL user)
  --stop-services a,b     systemd services to stop/start (default: solvebox-hub-backend,solvebox-hub-frontend)
  --keep-running          Do not stop services (NOT recommended)
  --backup-dir <dir>      Where to write pre-restore safety backups (default: /var/backups/solvebox-hub/db)
  --no-prebackup          Skip safety backup (NOT recommended)
  --no-migrate            Skip alembic migration step
  --app-dir <dir>         App dir containing backend/.venv (default: auto)
  --help                  Show help

Notes:
  - This script assumes PostgreSQL is LOCAL to this machine. If DATABASE_URL points to a remote host,
    run the restore on that DB host or do the restore manually.
EOF
}

require_root() { [[ "${EUID}" -eq 0 ]] || die "Run as root (use sudo)."; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

# Defaults
DUMP_PATH=""
FORCE="false"
ENV_FILE=""
DB_NAME_OVERRIDE=""
DB_OWNER_OVERRIDE=""
KEEP_RUNNING="false"
STOP_SERVICES="solvebox-hub-backend,solvebox-hub-frontend"
BACKUP_DIR="/var/backups/solvebox-hub/db"
DO_PREBACKUP="true"
DO_MIGRATE="true"
APP_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP_PATH="${2:-}"; shift 2 ;;
    --force) FORCE="true"; shift 1 ;;
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --db-name) DB_NAME_OVERRIDE="${2:-}"; shift 2 ;;
    --db-owner) DB_OWNER_OVERRIDE="${2:-}"; shift 2 ;;
    --stop-services) STOP_SERVICES="${2:-}"; shift 2 ;;
    --keep-running) KEEP_RUNNING="true"; shift 1 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --no-prebackup) DO_PREBACKUP="false"; shift 1 ;;
    --no-migrate) DO_MIGRATE="false"; shift 1 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

require_root
[[ -n "${DUMP_PATH}" ]] || { usage; die "--dump is required"; }
[[ -f "${DUMP_PATH}" ]] || die "Dump file not found: ${DUMP_PATH}"
[[ "${FORCE}" == "true" ]] || die "Refusing to overwrite DB without --force"


# ---- Ensure postgres OS user can read the dump file (common issue with /var/backups permissions) ----
if ! sudo -u postgres test -r "${DUMP_PATH}"; then
  log WARN "postgres user cannot read dump: ${DUMP_PATH} (permission denied). Copying to a safe temp file readable by postgres."
  tmp_dump="$(mktemp -p /tmp restore-archive-XXXXXX.dump)"
  # install copies with secure ownership/mode
  install -o postgres -g postgres -m 0600 "${DUMP_PATH}" "${tmp_dump}"
  DUMP_PATH="${tmp_dump}"
  # cleanup temp dump on exit
  trap '[[ -n "${tmp_dump:-}" && -f "${tmp_dump:-}" ]] && rm -f "${tmp_dump}"' EXIT
  log INFO "Using temp dump: ${DUMP_PATH}"
fi


# ---- Prefer newest PostgreSQL client binaries available ----
# Reason: pg_restore must be >= the pg_dump major version that created the custom-format dump.
# We pick the newest installed in /usr/lib/postgresql/*/bin and prepend it to PATH.
# IMPORTANT: sudo resets PATH (Ubuntu's env_reset in sudoers), so exporting PATH is not enough
# for commands run via "sudo -u postgres".  We store the directory in PG_BIN and use full paths
# inside every "sudo -u postgres pg_dump / pg_restore" call via the pg_as_postgres() helper below.
PG_BIN=""
for v in 17 16 15 14 13 12; do
  if [[ -x "/usr/lib/postgresql/${v}/bin/pg_restore" ]]; then
    PG_BIN="/usr/lib/postgresql/${v}/bin"
    export PATH="${PG_BIN}:${PATH}"
    log INFO "Using PostgreSQL client bin dir: ${PG_BIN}"
    break
  fi
done

# Run a PostgreSQL client command as the postgres OS user using the resolved binary dir.
pg_as_postgres() {
  local cmd="$1"; shift
  if [[ -n "${PG_BIN}" && -x "${PG_BIN}/${cmd}" ]]; then
    sudo -u postgres "${PG_BIN}/${cmd}" "$@"
  else
    sudo -u postgres "${cmd}" "$@"
  fi
}


need systemctl
need psql
need pg_restore
need pg_dump
need install

# ---- Resolve env file (backend.env) ----
auto_env_candidates=(
  "/etc/solvebox-hub/backend.env"
  "/etc/onboarding/backend.env"
)
if [[ -z "${ENV_FILE}" ]]; then
  for c in "${auto_env_candidates[@]}"; do
    if [[ -f "$c" ]]; then ENV_FILE="$c"; break; fi
  done
fi
if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
  log INFO "Loading env: ${ENV_FILE}"
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
else
  log WARN "No env file found. Provide --env /path/to/backend.env (must contain DATABASE_URL=...)."
fi

# ---- Parse DATABASE_URL safely (URL-decoding included) ----
# BUG FIX: urlparse treats '#' as a fragment delimiter, so passwords like "M#secret@host/db"
# are silently truncated — host, port, and db are lost.  Use a regex-based parser instead
# which captures everything between the last ':' before '@' and the '@' sign as the password,
# regardless of any '#' characters.
# Values are printed one-per-line so spaces in passwords are handled correctly by bash read.
DB_USER="${DB_OWNER_OVERRIDE}"
DB_NAME="${DB_NAME_OVERRIDE}"
DB_HOST=""
DB_PORT=""

if [[ -z "${DB_USER}" || -z "${DB_NAME}" ]]; then
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL not set. Provide --env with DATABASE_URL or pass --db-name and --db-owner."

  _parsed_output="$(python3 - <<'PY'
import os, re, sys
from urllib.parse import unquote

url = os.environ.get("DATABASE_URL", "").strip()
# Normalise SQLAlchemy dialect prefix
url = re.sub(r'^postgresql\+[^:]+://', 'postgresql://', url)

# Regex-based parse: handles '#' and other special chars in the password.
# Pattern: scheme://[user[:pass]@]host[:port]/db[?query]
m = re.match(
    r'^\w+://'
    r'(?:(?P<user>[^:@]*)(?::(?P<pass>[^@]*))?@)?'
    r'(?P<host>[^/:?#]*)(?::(?P<port>\d+))?'
    r'/(?P<db>[^?#]*)',
    url,
)
if not m:
    print("", "", "", "", "", sep='\n')
    sys.exit(0)

print(unquote(m.group("user") or ""))
print(unquote(m.group("pass") or ""))
print(m.group("host") or "")
print(m.group("port") or "5432")
print(m.group("db")   or "")
PY
  )"

  # Read each field from its own line — immune to spaces in passwords
  { IFS= read -r parsed_user
    IFS= read -r parsed_pass
    IFS= read -r parsed_host
    IFS= read -r parsed_port
    IFS= read -r parsed_db
  } <<< "${_parsed_output}" || true

  DB_USER="${DB_USER:-$parsed_user}"
  DB_PASSWORD="${DB_PASSWORD:-$parsed_pass}"
  DB_HOST="${DB_HOST:-$parsed_host}"
  DB_PORT="${DB_PORT:-$parsed_port}"
  DB_NAME="${DB_NAME:-$parsed_db}"
fi

[[ -n "${DB_USER}" ]] || die "DB owner user not resolved (DATABASE_URL username missing?)."
[[ -n "${DB_NAME}" ]] || die "DB name not resolved (DATABASE_URL path missing?)."

# This script intentionally supports ONLY local PostgreSQL for safety/consistency.
case "${DB_HOST:-}" in
  ""|"localhost"|"127.0.0.1"|"::1") : ;;
  *) die "DATABASE_URL host is remote (${DB_HOST}). This script is for local PostgreSQL on the VPS. Restore on the DB host instead." ;;
esac

# ---- Resolve app dir (only if migrations are enabled) ----
if [[ -z "${APP_DIR}" ]]; then
  # Try to infer from common patterns
  if [[ -n "${OPS_REMOTE_APP_DIR:-}" ]]; then
    APP_DIR="${OPS_REMOTE_APP_DIR}"
  elif [[ -d "/opt/apps/solvebox-hub" ]]; then
    APP_DIR="/opt/apps/solvebox-hub"
  elif [[ -d "/opt/apps/onboarding" ]]; then
    APP_DIR="/opt/apps/onboarding"
  else
    APP_DIR=""
  fi
fi

# ---- Pre-backup current DB (safety) ----
install -d -m 0770 -o root -g postgres "${BACKUP_DIR}"
ts="$(date +%Y%m%d_%H%M%S)"
pre_backup="${BACKUP_DIR}/pre-restore-${DB_NAME}-${ts}.dump"

if [[ "${DO_PREBACKUP}" == "true" ]]; then
  log INFO "Creating safety backup of current DB -> ${pre_backup}"
  # Use local socket + peer auth (postgres OS user) to avoid password issues.
  if pg_as_postgres pg_dump -Fc --no-owner --no-acl -f "${pre_backup}" "${DB_NAME}"; then
    log INFO "Safety backup OK"
  else
    log WARN "Safety backup FAILED. Continuing because --force was provided."
  fi
else
  log WARN "Skipping safety backup (--no-prebackup)."
fi

# ---- Stop services (optional but recommended) ----
if [[ "${KEEP_RUNNING}" != "true" ]]; then
  IFS=',' read -r -a services <<<"${STOP_SERVICES}"
  for svc in "${services[@]}"; do
    [[ -n "$svc" ]] || continue
    log INFO "Stopping service: $svc"
    systemctl stop "$svc" || true
  done
else
  log WARN "--keep-running enabled: services will NOT be stopped."
fi

# ---- Block new connections + terminate existing ones ----
log INFO "Blocking new connections & terminating sessions to DB: ${DB_NAME}"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = ${DB_NAME@Q}) THEN
    EXECUTE format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS false', ${DB_NAME@Q});
  END IF;
END
\$\$;

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = ${DB_NAME@Q}
  AND pid <> pg_backend_pid();
SQL

# ---- Drop & recreate database ----
log INFO "Dropping database (if exists): ${DB_NAME}"
# dropdb --force exists on newer versions; we already terminated sessions, so it's fine either way.
if dropdb --help 2>/dev/null | grep -q -- '--force'; then
  sudo -u postgres dropdb --if-exists --force "${DB_NAME}" || true
else
  sudo -u postgres dropdb --if-exists "${DB_NAME}" || true
fi

# Ensure role exists (safe quoting)

log INFO "Ensuring role exists: ${DB_USER}"

# Safe SQL quoting in pure bash (no Python subprocess needed).
# Double-quote identifier:  "name" with any embedded " doubled.
# Single-quote literal:     'value' with any embedded ' doubled.
ROLE_IDENT="\"${DB_USER//\"/\"\"}\""
ROLE_LIT="'${DB_USER//\'/\'\'}'"
if [[ -n "${DB_PASSWORD:-}" ]]; then
  PASS_LIT="'${DB_PASSWORD//\'/\'\'}'"
else
  PASS_LIT=""
fi

ROLE_EXISTS="$(sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_LIT};" | tr -d '[:space:]' || true)"
if [[ "${ROLE_EXISTS}" != "1" ]]; then
  if [[ -z "${DB_PASSWORD:-}" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE ${ROLE_IDENT} LOGIN;"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE ${ROLE_IDENT} LOGIN PASSWORD ${PASS_LIT};"
  fi
fi

log INFO "Creating database: ${DB_NAME} (owner: ${DB_USER})"
sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

# Re-allow connections after create (restore will connect)
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -tAc \
  "ALTER DATABASE \"${DB_NAME}\" WITH ALLOW_CONNECTIONS true;" >/dev/null

# ---- Restore ----
log INFO "Restoring dump into ${DB_NAME}"
# Stream: pg_restore → strip unknown GUCs → psql.
# grep -v removes SET statements for parameters unknown to older server versions
# (e.g. transaction_timeout added in PG17). Safe on all versions — if the server
# already knows the parameter, not sending SET just keeps the default, which is fine.
{
  echo "SET ROLE ${ROLE_IDENT};"
  pg_as_postgres pg_restore --no-owner --no-acl -f - "${DUMP_PATH}"
} | grep -v "^SET transaction_timeout" \
  | sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "${DB_NAME}"

# ---- Post-restore ownership hardening ----

log INFO "Post-restore: ensuring schema ownership and connect privileges"
# public schema ownership helps migrations and CREATE objects; ignore if public schema doesn't exist.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "ALTER SCHEMA public OWNER TO ${ROLE_IDENT};" >/dev/null 2>&1 || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE \"${DB_NAME//\"/\"\"}\" TO ${ROLE_IDENT};" >/dev/null

# ---- Optional migrations ----
if [[ "${DO_MIGRATE}" == "true" ]]; then
  if [[ -n "${APP_DIR}" && -d "${APP_DIR}/backend" && -x "${APP_DIR}/.venv/bin/alembic" && -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
    log INFO "Running alembic upgrade head (post-restore) in ${APP_DIR}/backend"
    # shellcheck disable=SC1090
    set -a; source "${ENV_FILE}"; set +a
    app_user="${APP_USER:-solvebox}"
    sudo -u "${app_user}" bash -lc "set -a; source '${ENV_FILE}'; set +a; cd '${APP_DIR}/backend' && '${APP_DIR}/.venv/bin/alembic' upgrade head" || true
  else
    log WARN "Skipping migrations (APP_DIR/.venv/alembic or env file not found)."
  fi
else
  log INFO "Skipping migrations (--no-migrate)."
fi

# ---- Start services ----
if [[ "${KEEP_RUNNING}" != "true" ]]; then
  IFS=',' read -r -a services <<<"${STOP_SERVICES}"
  for svc in "${services[@]}"; do
    [[ -n "$svc" ]] || continue
    log INFO "Starting service: $svc"
    systemctl start "$svc" || true
  done
fi

log INFO "Restore completed successfully."
