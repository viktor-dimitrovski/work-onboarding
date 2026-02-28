#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
Deploy frontend on VPS (git pull + npm ci + build + restart).

Usage:
  sudo bash ops/vps/deploy-frontend.sh [--branch main] [--skip-install] [--skip-build]
EOF
}

BRANCH="${OPS_GIT_BRANCH:-main}"
SKIP_INSTALL="false"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:-main}"; shift 2 ;;
    --skip-install) SKIP_INSTALL="true"; shift 1 ;;
    --skip-build) SKIP_BUILD="true"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

as_root_or_die
require_cmd git
require_cmd npm
require_cmd systemctl

DEPLOY_ENV="${ROOT_DIR}/deploy/ubuntu/deploy.env"
load_kv_env_file "${DEPLOY_ENV}"

APP_DIR="${OPS_REMOTE_APP_DIR:-${APP_DIR:-${ROOT_DIR}}}"
FRONTEND_SERVICE="${OPS_FRONTEND_SERVICE:-onboarding-frontend}"
APP_USER="${APP_USER:-onboarding}"

log INFO "Deploy frontend in ${APP_DIR} (branch: ${BRANCH})"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  die "Repo not found at APP_DIR=${APP_DIR}. Set OPS_REMOTE_APP_DIR."
fi

log INFO "Pulling latest code"
git -C "${APP_DIR}" fetch --all --prune
git -C "${APP_DIR}" checkout "${BRANCH}"
git -C "${APP_DIR}" pull --ff-only

if [[ "${SKIP_INSTALL}" != "true" ]]; then
  log INFO "Installing frontend dependencies (npm ci)"
  sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}/frontend' && npm ci"
fi

if [[ "${SKIP_BUILD}" != "true" ]]; then
  if [[ -f /etc/onboarding/frontend.env ]]; then
    log INFO "Building Next.js (npm run build)"
    sudo -u "${APP_USER}" bash -lc "set -a; source /etc/onboarding/frontend.env; set +a; cd '${APP_DIR}/frontend' && npm run build"
  else
    log WARN "Missing /etc/onboarding/frontend.env; building with default env."
    sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}/frontend' && npm run build"
  fi
fi

log INFO "Restarting ${FRONTEND_SERVICE}"
systemctl restart "${FRONTEND_SERVICE}"
systemctl status "${FRONTEND_SERVICE}" --no-pager -l || true

log INFO "Frontend deploy complete."

