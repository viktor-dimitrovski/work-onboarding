#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------
# Local → VPS database sync (overwrite restore)
# --------------------------------------------
#
# What this script does:
# 1) Loads ops env (SSH + DB URL).
# 2) Creates a local pg_dump (custom format).
# 3) Uploads the dump to the VPS.
# 4) Runs the remote restore script (drops/recreates DB, restores dump).
#
# Safety:
# - You MUST pass --force, otherwise it will refuse to overwrite the VPS DB.
#
# Requirements (local PC):
# - Git Bash
# - pg_dump in PATH (PostgreSQL client tools installed)
# - ssh + scp (OpenSSH, from Git for Windows), OR plink + pscp (PuTTY) when using a .ppk key
#
# Requirements (VPS):
# - sudo access
# - pg_restore + psql installed
# - repo present at OPS_REMOTE_APP_DIR, containing ops/vps/restore-db.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
Usage:
  bash ops/local/db-sync.sh --env ops/ops.env --force

Options:
  --env <file>   Path to ops env file (default: ops/ops.env)
  --force        Required. Confirms destructive overwrite of VPS database.
EOF
}

ENV_FILE="${ROOT_DIR}/ops/ops.env"
FORCE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --force) FORCE="true"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

load_env_file "${ENV_FILE}"

require_cmd pg_dump
require_cmd "${OPS_SSH_CMD:-ssh}"
require_cmd "${OPS_SCP_CMD:-scp}"

[[ "${FORCE}" == "true" ]] || die "Refusing to overwrite VPS database without --force"
[[ -n "${OPS_LOCAL_DATABASE_URL:-}" ]] || die "OPS_LOCAL_DATABASE_URL is required in ${ENV_FILE}"
[[ -n "${OPS_REMOTE_APP_DIR:-}" ]] || die "OPS_REMOTE_APP_DIR is required in ${ENV_FILE}"
[[ -n "${OPS_REMOTE_BACKUP_DIR:-}" ]] || die "OPS_REMOTE_BACKUP_DIR is required in ${ENV_FILE}"

SSH_ARGS=()
while IFS= read -r line; do SSH_ARGS+=("$line"); done < <(ssh_base_args)
UAH="$(user_at_host)"

ts="$(date +%Y%m%d_%H%M%S)"
mkdir -p "${ROOT_DIR}/ops/_backups"

local_dump="${ROOT_DIR}/ops/_backups/solvebox-hub-local-${ts}.dump"
remote_dump="${OPS_REMOTE_BACKUP_DIR}/solvebox-hub-upload-${ts}.dump"

log INFO "Step 1/4: Create local dump -> ${local_dump}"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "${local_dump}" \
  --dbname "$(normalize_pg_url "${OPS_LOCAL_DATABASE_URL}")"

log INFO "Step 2/4: Ensure VPS backup dir -> ${OPS_REMOTE_BACKUP_DIR}"
"${OPS_SSH_CMD:-ssh}" "${SSH_ARGS[@]}" "${UAH}" "sudo mkdir -p '${OPS_REMOTE_BACKUP_DIR}' && sudo chown '${OPS_SSH_USER:-deploy}' '${OPS_REMOTE_BACKUP_DIR}' || true"

log INFO "Step 3/4: Upload dump -> ${UAH}:${remote_dump}"
"${OPS_SCP_CMD:-scp}" "${SSH_ARGS[@]}" "${local_dump}" "${UAH}:${remote_dump}"

log INFO "Step 4/4: Remote restore (OVERWRITE) using ops/vps/restore-db.sh"
if ! "${OPS_SSH_CMD:-ssh}" "${SSH_ARGS[@]}" "${UAH}" "cd '${OPS_REMOTE_APP_DIR}' && sudo bash ops/vps/restore-db.sh --dump '${remote_dump}' --force"; then
  die "Remote restore failed. Check the output above for errors. On the VPS ensure /etc/solvebox-hub/backend.env (or /etc/solvebox/backend.env) exists with DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DBNAME. To run manually: plink -i YOUR_KEY ${UAH} \"cd '${OPS_REMOTE_APP_DIR}' && sudo bash ops/vps/restore-db.sh --dump '${remote_dump}' --force\""
fi

log INFO "DB sync finished."

