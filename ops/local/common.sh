#!/usr/bin/env bash
set -euo pipefail

log() {
  local level="${1:-INFO}"
  shift || true
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${level}" "$*"
}

die() {
  log "ERR" "$*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || die "Env file not found: $file"
  # shellcheck disable=SC1090
  set -a; source "$file"; set +a
}

ssh_base_args() {
  local port="${OPS_SSH_PORT:-22}"
  local keyfile="${OPS_SSH_KEYFILE:-}"
  local args=(-p "$port")
  if [[ -n "${keyfile}" ]]; then
    args+=(-i "${keyfile}")
  fi
  printf '%s\n' "${args[@]}"
}

user_at_host() {
  local host="${OPS_SSH_HOST:-}"
  local user="${OPS_SSH_USER:-deploy}"
  [[ -n "${host}" ]] || die "OPS_SSH_HOST is required"
  printf '%s@%s\n' "${user}" "${host}"
}

normalize_pg_url() {
  # pg_dump/pg_restore want plain postgresql://... (not SQLAlchemy postgresql+psycopg://)
  local url="$1"
  printf '%s\n' "${url/postgresql+psycopg:\/\//postgresql:\/\/}"
}

