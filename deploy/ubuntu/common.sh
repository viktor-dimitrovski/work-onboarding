#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/deploy.env"

if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

APP_DIR="${APP_DIR:-${ROOT_DIR}}"
APP_USER="${APP_USER:-onboarding}"
APP_GROUP="${APP_GROUP:-${APP_USER}}"
POSTGRES_OS_USER="${POSTGRES_OS_USER:-postgres}"
DB_NAME="${DB_NAME:-onboarding}"
DB_USER="${DB_USER:-onboarding_app}"
DB_PASSWORD="${DB_PASSWORD:-onboarding_app_dev_password}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_WORKERS="${BACKEND_WORKERS:-3}"
DOMAIN="${DOMAIN:-_}"
SEED_DEMO="${SEED_DEMO:-false}"
INSTALL_NGINX="${INSTALL_NGINX:-true}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-onboarding}"
NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-/api/v1}"
BACKEND_API_URL="${BACKEND_API_URL:-http://127.0.0.1:${BACKEND_PORT}}"
FIRST_ADMIN_EMAIL="${FIRST_ADMIN_EMAIL:-super.admin@example.com}"
FIRST_ADMIN_PASSWORD="${FIRST_ADMIN_PASSWORD:-ChangeMe123!}"
APP_ENV="${APP_ENV:-production}"
CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:${FRONTEND_PORT}}"

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/onboarding/backend.env}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-/etc/onboarding/frontend.env}"

JWT_SECRET_KEY="${JWT_SECRET_KEY:-}"
JWT_REFRESH_SECRET_KEY="${JWT_REFRESH_SECRET_KEY:-}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This script must run as root (use sudo)."
    exit 1
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

ensure_secrets() {
  if [[ -z "${JWT_SECRET_KEY}" ]]; then
    JWT_SECRET_KEY="$(generate_secret)"
  fi

  if [[ -z "${JWT_REFRESH_SECRET_KEY}" ]]; then
    JWT_REFRESH_SECRET_KEY="$(generate_secret)"
  fi
}

ensure_app_user() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${APP_GROUP}" --create-home --shell /bin/bash "${APP_USER}"
  fi
}

ensure_onboarding_etc_dir() {
  install -d -m 0750 -o root -g "${APP_GROUP}" /etc/onboarding
}

run_as_app() {
  local command="$1"
  su -s /bin/bash - "${APP_USER}" -c "${command}"
}

write_backend_env_file() {
  ensure_onboarding_etc_dir
  ensure_secrets

  cat >"${BACKEND_ENV_FILE}" <<EOF
DATABASE_URL=postgresql+psycopg://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET_KEY=${JWT_SECRET_KEY}
JWT_REFRESH_SECRET_KEY=${JWT_REFRESH_SECRET_KEY}
APP_ENV=${APP_ENV}
CORS_ORIGINS=${CORS_ORIGINS}
FIRST_ADMIN_EMAIL=${FIRST_ADMIN_EMAIL}
FIRST_ADMIN_PASSWORD=${FIRST_ADMIN_PASSWORD}
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
EOF

  chown root:"${APP_GROUP}" "${BACKEND_ENV_FILE}"
  chmod 0640 "${BACKEND_ENV_FILE}"
}

write_frontend_env_file() {
  ensure_onboarding_etc_dir

  cat >"${FRONTEND_ENV_FILE}" <<EOF
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
BACKEND_API_URL=${BACKEND_API_URL}
PORT=${FRONTEND_PORT}
EOF

  chown root:"${APP_GROUP}" "${FRONTEND_ENV_FILE}"
  chmod 0640 "${FRONTEND_ENV_FILE}"
}

write_local_env_files() {
  write_backend_env_file
  write_frontend_env_file

  cat >"${APP_DIR}/backend/.env" <<EOF
DATABASE_URL=postgresql+psycopg://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET_KEY=${JWT_SECRET_KEY}
JWT_REFRESH_SECRET_KEY=${JWT_REFRESH_SECRET_KEY}
APP_ENV=${APP_ENV}
CORS_ORIGINS=${CORS_ORIGINS}
FIRST_ADMIN_EMAIL=${FIRST_ADMIN_EMAIL}
FIRST_ADMIN_PASSWORD=${FIRST_ADMIN_PASSWORD}
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
EOF

  cat >"${APP_DIR}/frontend/.env.local" <<EOF
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
BACKEND_API_URL=${BACKEND_API_URL}
EOF

  chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/backend/.env" "${APP_DIR}/frontend/.env.local"
  chmod 0640 "${APP_DIR}/backend/.env" "${APP_DIR}/frontend/.env.local"
}
