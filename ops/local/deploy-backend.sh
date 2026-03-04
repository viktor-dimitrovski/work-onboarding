#!/usr/bin/env bash
set -euo pipefail

# Deploy backend: package locally → upload via scp/pscp → extract + restart on server.
# No git on server. No deploy.env on server needed.
#
# Usage:  bash ops/local/deploy-backend.sh [--env ops/ops.env]
# Or:     run-deploy-backend.bat

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

ENV_FILE="${ROOT_DIR}/ops/ops.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --help|-h) echo "Usage: deploy-backend.sh [--env ops/ops.env]"; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

load_env_file "${ENV_FILE}"
require_cmd "${OPS_SSH_CMD:-ssh}"
require_cmd "${OPS_SCP_CMD:-scp}"

APP_DIR="${OPS_REMOTE_APP_DIR}"
SVC="${OPS_BACKEND_SERVICE:-solvebox-hub-backend}"
APP_USER="${OPS_APP_USER:-solvebox}"
VENV="${APP_DIR}/.venv"

SSH_ARGS=()
while IFS= read -r l; do SSH_ARGS+=("$l"); done < <(ssh_base_args)
UAH="$(user_at_host)"

ts="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="backend-${ts}.tar.gz"
LOCAL="${ROOT_DIR}/ops/_backups/${ARCHIVE}"
mkdir -p "${ROOT_DIR}/ops/_backups"
trap 'rm -f "${LOCAL}"' EXIT

# ── 1. Package ─────────────────────────────────────────────────────────────
log INFO "Packaging backend..."
tar -C "${ROOT_DIR}/backend" \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='*.pyo' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='.env' \
  --exclude='*.egg-info' \
  --exclude='.pytest_cache' \
  -czf "${LOCAL}" .
log INFO "Archive: ${LOCAL} ($(du -sh "${LOCAL}" | cut -f1))"

# ── 2. Upload ──────────────────────────────────────────────────────────────
log INFO "Uploading to ${UAH}:/tmp/${ARCHIVE} ..."
"${OPS_SCP_CMD:-scp}" "${SSH_ARGS[@]}" "${LOCAL}" "${UAH}:/tmp/${ARCHIVE}"

# ── 3. Extract + pip install + restart ────────────────────────────────────
log INFO "Deploying on server..."
"${OPS_SSH_CMD:-ssh}" "${SSH_ARGS[@]}" "${UAH}" "
set -euo pipefail
sudo mkdir -p '${APP_DIR}/backend'
sudo tar -C '${APP_DIR}/backend' -xzf '/tmp/${ARCHIVE}'
sudo rm -f '/tmp/${ARCHIVE}'
sudo chown -R '${APP_USER}:${APP_USER}' '${APP_DIR}/backend'
sudo -u '${APP_USER}' '${VENV}/bin/pip' install -q -r '${APP_DIR}/backend/requirements.txt'
sudo systemctl restart '${SVC}'
sudo systemctl status '${SVC}' --no-pager -l | tail -8
"

log INFO "Backend deploy done."
