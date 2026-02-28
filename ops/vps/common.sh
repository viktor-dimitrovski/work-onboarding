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

as_root_or_die() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "This script must run as root (use sudo)."
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

load_kv_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # shellcheck disable=SC1090
  set -a; source "$file"; set +a
}

