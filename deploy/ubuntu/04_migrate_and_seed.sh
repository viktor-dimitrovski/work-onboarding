#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_root

log "Applying Alembic migrations."
run_as_app "set -a; source '${BACKEND_ENV_FILE}'; set +a; cd '${APP_DIR}/backend' && '${APP_DIR}/.venv/bin/alembic' upgrade head"

log "Applying SQL scripts for reference data, views, and functions."
if [[ "${SEED_DEMO}" == "true" ]]; then
  run_as_app "set -a; source '${BACKEND_ENV_FILE}'; set +a; cd '${APP_DIR}' && '${APP_DIR}/.venv/bin/python' scripts/seed_backend.py"
else
  run_as_app "set -a; source '${BACKEND_ENV_FILE}'; set +a; cd '${APP_DIR}' && '${APP_DIR}/.venv/bin/python' scripts/seed_backend.py --skip-demo"
fi

log "Database migrations and SQL objects completed."
