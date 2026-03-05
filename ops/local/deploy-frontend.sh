#!/usr/bin/env bash
set -euo pipefail

# Deploy frontend: build locally (Next.js standalone) → upload → extract + restart on server.
# No git on server. No node_modules upload (standalone build is self-contained).
#
# Usage:  bash ops/local/deploy-frontend.sh [--env ops/ops.env]
# Or:     run-deploy-frontend.bat

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

ENV_FILE="${ROOT_DIR}/ops/ops.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --help|-h) echo "Usage: deploy-frontend.sh [--env ops/ops.env]"; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

load_env_file "${ENV_FILE}"
require_cmd "${OPS_SSH_CMD:-ssh}"
require_cmd "${OPS_SCP_CMD:-scp}"
require_cmd node
require_cmd npm

APP_DIR="${OPS_REMOTE_APP_DIR}"
SVC="${OPS_FRONTEND_SERVICE:-solvebox-hub-frontend}"
APP_USER="${OPS_APP_USER:-solvebox}"

SSH_ARGS=()
while IFS= read -r l; do SSH_ARGS+=("$l"); done < <(ssh_base_args)
UAH="$(user_at_host)"

FRONTEND_DIR="${ROOT_DIR}/frontend"

# ── 1. Check deps ─────────────────────────────────────────────────────────
cd "${FRONTEND_DIR}"
if [[ ! -d node_modules ]]; then
  die "node_modules not found. Run 'npm install' in the frontend folder first, then re-run this script."
fi
log INFO "Step 1/5: node_modules present, skipping install."

# ── 2. Build ───────────────────────────────────────────────────────────────
# Stash .env.local so it cannot override production API base (Next.js gives .env.local
# higher priority than .env.production; a local dev value can produce wrong inlined URLs).
ENV_LOCAL_STASH=""
if [[ -f "${FRONTEND_DIR}/.env.local" ]]; then
  ENV_LOCAL_STASH="${FRONTEND_DIR}/.env.local.deploy-stash"
  mv "${FRONTEND_DIR}/.env.local" "${ENV_LOCAL_STASH}"
  log INFO "Stashed .env.local for build (will restore after)."
fi
trap '[[ -n "${ENV_LOCAL_STASH}" && -f "${ENV_LOCAL_STASH}" ]] && mv "${ENV_LOCAL_STASH}" "${FRONTEND_DIR}/.env.local" && log INFO "Restored .env.local"; trap - EXIT' EXIT

log INFO "Step 2/5: Building Next.js standalone (this takes 2-5 minutes, please wait)..."
MSYS_NO_PATHCONV=1 \
MSYS2_ARG_CONV_EXCL="*" \
NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_API_BASE_URL="${OPS_NEXT_PUBLIC_API_BASE_URL:-/api/v1}" \
BACKEND_API_URL="${OPS_BACKEND_API_URL:-http://127.0.0.1:8001}" \
npm run build
log INFO "Step 2/5: Build complete."

# Restore .env.local immediately so later steps don't see stashed state
if [[ -n "${ENV_LOCAL_STASH}" && -f "${ENV_LOCAL_STASH}" ]]; then
  mv "${ENV_LOCAL_STASH}" "${FRONTEND_DIR}/.env.local"
  ENV_LOCAL_STASH=""
  log INFO "Restored .env.local."
fi
trap - EXIT

# ── 3. Prepare standalone bundle ──────────────────────────────────────────
# Next.js standalone output lives in .next/standalone but needs static assets copied in.
log INFO "Step 3/5: Preparing standalone bundle..."
cp -r "${FRONTEND_DIR}/.next/static"  "${FRONTEND_DIR}/.next/standalone/.next/static"
if [[ -d "${FRONTEND_DIR}/public" ]]; then
  cp -r "${FRONTEND_DIR}/public" "${FRONTEND_DIR}/.next/standalone/public"
fi

ts="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="frontend-${ts}.tar.gz"
LOCAL="${ROOT_DIR}/ops/_backups/${ARCHIVE}"
mkdir -p "${ROOT_DIR}/ops/_backups"
trap 'rm -f "${LOCAL}"' EXIT

tar -C "${FRONTEND_DIR}/.next/standalone" -czf "${LOCAL}" .
log INFO "Step 3/5: Bundle ready — $(du -sh "${LOCAL}" | cut -f1)"

# ── 4. Upload ──────────────────────────────────────────────────────────────
log INFO "Step 4/5: Uploading to ${UAH}:/tmp/${ARCHIVE} ..."
"${OPS_SCP_CMD:-scp}" "${SSH_ARGS[@]}" "${LOCAL}" "${UAH}:/tmp/${ARCHIVE}"
log INFO "Step 4/5: Upload complete."

# ── 5. Extract + restart ───────────────────────────────────────────────────
log INFO "Step 5/5: Deploying on server (extract + restart)..."
"${OPS_SSH_CMD:-ssh}" "${SSH_ARGS[@]}" "${UAH}" "
set -euo pipefail
sudo mkdir -p '${APP_DIR}/frontend'
sudo tar -C '${APP_DIR}/frontend' -xzf '/tmp/${ARCHIVE}'
sudo rm -f '/tmp/${ARCHIVE}'
sudo chown -R '${APP_USER}:${APP_USER}' '${APP_DIR}/frontend'
sudo systemctl restart '${SVC}'
sudo systemctl status '${SVC}' --no-pager -l | tail -8
"

log INFO "Step 5/5: Server restarted."
log INFO "Frontend deploy done."
