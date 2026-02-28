#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
Deploy backend on VPS (git pull + pip install + alembic + restart).

Usage:
  sudo bash ops/vps/deploy-backend.sh [--branch main] [--skip-install] [--skip-migrate]
EOF
}

BRANCH="${OPS_GIT_BRANCH:-main}"
SKIP_INSTALL="false"
SKIP_MIGRATE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="${2:-main}"; shift 2 ;;
    --skip-install) SKIP_INSTALL="true"; shift 1 ;;
    --skip-migrate) SKIP_MIGRATE="true"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

as_root_or_die
require_cmd git
require_cmd systemctl

DEPLOY_ENV="${ROOT_DIR}/deploy/ubuntu/deploy.env"
load_kv_env_file "${DEPLOY_ENV}"

APP_DIR="${OPS_REMOTE_APP_DIR:-${APP_DIR:-${ROOT_DIR}}}"
BACKEND_SERVICE="${OPS_BACKEND_SERVICE:-onboarding-backend}"

log INFO "Deploy backend in ${APP_DIR} (branch: ${BRANCH})"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  die "Repo not found at APP_DIR=${APP_DIR}. Set OPS_REMOTE_APP_DIR."
fi

log INFO "Pulling latest code"
git -C "${APP_DIR}" fetch --all --prune
git -C "${APP_DIR}" checkout "${BRANCH}"
git -C "${APP_DIR}" pull --ff-only

if [[ "${SKIP_INSTALL}" != "true" ]]; then
  log INFO "Installing backend dependencies"
  if [[ ! -x "${APP_DIR}/.venv/bin/python" ]]; then
    log INFO "Creating venv at ${APP_DIR}/.venv"
    sudo -u "${APP_USER:-onboarding}" bash -lc "cd '${APP_DIR}' && python3 -m venv .venv"
  fi
  sudo -u "${APP_USER:-onboarding}" bash -lc "cd '${APP_DIR}' && .venv/bin/python -m pip install --upgrade pip"
  sudo -u "${APP_USER:-onboarding}" bash -lc "cd '${APP_DIR}' && .venv/bin/pip install -r backend/requirements.txt"
fi

if [[ "${SKIP_MIGRATE}" != "true" ]]; then
  if [[ -f /etc/onboarding/backend.env ]]; then
    log INFO "Running alembic migrations"
    sudo -u "${APP_USER:-onboarding}" bash -lc "set -a; source /etc/onboarding/backend.env; set +a; cd '${APP_DIR}/backend' && '${APP_DIR}/.venv/bin/alembic' upgrade head"
  else
    log WARN "Missing /etc/onboarding/backend.env; skipping migrations."
  fi
fi

log INFO "Restarting ${BACKEND_SERVICE}"
systemctl restart "${BACKEND_SERVICE}"
systemctl status "${BACKEND_SERVICE}" --no-pager -l || true

log INFO "Backend deploy complete."

