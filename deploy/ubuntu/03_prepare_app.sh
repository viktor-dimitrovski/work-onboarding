#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_root
ensure_app_user
write_local_env_files

log "Preparing Python virtual environment and backend dependencies."
run_as_app "cd '${APP_DIR}' && python3 -m venv .venv"
run_as_app "cd '${APP_DIR}' && .venv/bin/python -m pip install --upgrade pip"
run_as_app "cd '${APP_DIR}' && .venv/bin/pip install -r backend/requirements.txt"

log "Installing frontend dependencies and building Next.js app."
run_as_app "cd '${APP_DIR}/frontend' && npm install"
run_as_app "set -a; source '${FRONTEND_ENV_FILE}'; set +a; cd '${APP_DIR}/frontend' && npm run build"

log "Application dependency installation and build completed."
