#!/usr/bin/env bash
set -euo pipefail

# Run Alembic migrations on the server.
# Use this after deploying a new backend version that includes new migrations.
#
# Usage:  bash ops/local/migrate.sh [--env ops/ops.env]
# Or:     run-migrate.bat

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

ENV_FILE="${ROOT_DIR}/ops/ops.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --help|-h) echo "Usage: migrate.sh [--env ops/ops.env]"; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

load_env_file "${ENV_FILE}"
require_cmd "${OPS_SSH_CMD:-ssh}"

APP_DIR="${OPS_REMOTE_APP_DIR}"
BACKEND_ENV="${OPS_REMOTE_BACKEND_ENV:-/etc/solvebox-hub/backend.env}"
VENV="${APP_DIR}/.venv"

SSH_ARGS=()
while IFS= read -r l; do SSH_ARGS+=("$l"); done < <(ssh_base_args)
UAH="$(user_at_host)"

log INFO "Running Alembic migrations on ${UAH}..."
"${OPS_SSH_CMD:-ssh}" "${SSH_ARGS[@]}" "${UAH}" "
set -euo pipefail
sudo bash -c \"set -a; source '${BACKEND_ENV}'; set +a; cd '${APP_DIR}/backend' && '${VENV}/bin/alembic' upgrade head\"
"
log INFO "Migrations done."
