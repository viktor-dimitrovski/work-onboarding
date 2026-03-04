#!/usr/bin/env bash
set -euo pipefail

log() {
  local level="${1:-INFO}"
  shift || true
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${level}" "$*"
}

die() {
  log "ERR" "$*" >&2
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

  # Resolve SSH key (and optionally convert .ppk -> OpenSSH) so failures stop the script.
  if [[ -n "${OPS_SSH_KEYFILE:-}" ]]; then
    OPS_SSH_KEYFILE="$(resolve_ssh_keyfile "${OPS_SSH_KEYFILE}")"
    export OPS_SSH_KEYFILE
  fi
  # When using a .ppk key we use PuTTY's plink/pscp (no conversion). Otherwise ssh/scp.
  if [[ "${OPS_SSH_KEYFILE:-}" == *.ppk ]]; then
    export OPS_SSH_CMD=plink
    export OPS_SCP_CMD=pscp
  else
    export OPS_SSH_CMD=ssh
    export OPS_SCP_CMD=scp
  fi
}

resolve_ssh_keyfile() {
  local keyfile="$1"
  if [[ -z "${keyfile}" ]]; then
    printf '%s' ""
    return 0
  fi

  # .ppk keys: use PuTTY plink/pscp natively (no conversion), or fall back to puttygen conversion.
  if [[ "${keyfile}" == *.ppk ]]; then
    if command -v plink >/dev/null 2>&1 && command -v pscp >/dev/null 2>&1; then
      # Use .ppk directly with plink/pscp — no conversion.
      log INFO "Using PuTTY .ppk key with plink/pscp (no conversion)" >&2
      printf '%s' "${keyfile}"
      return 0
    fi
    # Fall back: convert .ppk to OpenSSH for use with ssh/scp.
    if command -v puttygen >/dev/null 2>&1; then
      local cache_dir="${ROOT_DIR}/ops/_keys"
      mkdir -p "${cache_dir}"

      local safe
      safe="$(printf '%s' "${keyfile}" | tr -c 'a-zA-Z0-9._-' '_')"
      safe="${safe%.ppk}"
      local converted="${cache_dir}/${safe}.openssh.key"

      if [[ ! -f "${converted}" || "${keyfile}" -nt "${converted}" ]]; then
        log INFO "Converting PuTTY .ppk to OpenSSH key -> ${converted}" >&2
        if command -v cygpath >/dev/null 2>&1; then
          local input_win converted_win
          input_win="$(cygpath -w "${keyfile}" 2>/dev/null || printf '%s' "${keyfile}")"
          converted_win="$(cygpath -w "${converted}" 2>/dev/null || printf '%s' "${converted}")"
          puttygen "${input_win}" -O private-openssh -o "${converted_win}" 2>/dev/null || true
        else
          local input="${keyfile}"
          if [[ "${keyfile}" =~ ^([A-Za-z]):\\\\ ]]; then
            local drive="${BASH_REMATCH[1],,}"
            input="/${drive}/${keyfile:3}"
            input="${input//\\//}"
          fi
          puttygen "${input}" -O private-openssh -o "${converted}" 2>/dev/null || true
        fi
        [[ -f "${converted}" ]] || die $'Failed to convert .ppk to OpenSSH.\n\nUse PuTTY plink/pscp (install full PuTTY suite) to use .ppk directly, or fix puttygen conversion.'
        chmod 600 "${converted}" 2>/dev/null || true
      fi
      printf '%s' "${converted}"
      return 0
    fi
    die $'OPS_SSH_KEYFILE is a .ppk key. Install PuTTY (plink + pscp) to use it directly, or install puttygen to auto-convert to OpenSSH.'
  fi

  printf '%s' "${keyfile}"
}

ssh_base_args() {
  local port="${OPS_SSH_PORT:-22}"
  local keyfile="${OPS_SSH_KEYFILE:-}"
  local args=()
  if [[ "${keyfile}" == *.ppk ]]; then
    # No -batch: first connection to a new host will prompt to accept the host key (then it's cached).
    args=(-P "$port")
  else
    args=(-p "$port")
  fi
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

