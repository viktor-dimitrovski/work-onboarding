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

  # Resolve/convert SSH key early in the parent shell so failures stop the script.
  # (Errors inside process-substitution used by ssh_base_args may not propagate.)
  if [[ -n "${OPS_SSH_KEYFILE:-}" ]]; then
    OPS_SSH_KEYFILE="$(resolve_ssh_keyfile "${OPS_SSH_KEYFILE}")"
    export OPS_SSH_KEYFILE
  fi
}

resolve_ssh_keyfile() {
  local keyfile="$1"
  if [[ -z "${keyfile}" ]]; then
    printf '%s' ""
    return 0
  fi

  # OpenSSH (ssh/scp) cannot read PuTTY .ppk keys and will fail with:
  # "Load key ...: error in libcrypto"
  if [[ "${keyfile}" == *.ppk ]]; then
    if command -v puttygen >/dev/null 2>&1; then
      local cache_dir="${ROOT_DIR}/ops/_keys"
      mkdir -p "${cache_dir}"

      # Make a safe filename even if keyfile is a Windows path like C:\Users\...\key.ppk
      local safe
      safe="$(printf '%s' "${keyfile}" | tr -c 'a-zA-Z0-9._-' '_')"
      safe="${safe%.ppk}"
      local converted="${cache_dir}/${safe}.openssh.key"

      if [[ ! -f "${converted}" || "${keyfile}" -nt "${converted}" ]]; then
        log INFO "Converting PuTTY .ppk to OpenSSH key -> ${converted}" >&2
        local input="${keyfile}"
        if command -v cygpath >/dev/null 2>&1; then
          # If keyfile is a Windows path, convert to a POSIX path so both msys and Windows puttygen can read it.
          input="$(cygpath -u "${keyfile}" 2>/dev/null || printf '%s' "${keyfile}")"
        else
          # Best-effort conversion: C:\Users\me\key.ppk -> /c/Users/me/key.ppk
          if [[ "${keyfile}" =~ ^([A-Za-z]):\\\\ ]]; then
            local drive="${BASH_REMATCH[1],,}"
            input="/${drive}/${keyfile:3}"
            input="${input//\\//}"
          fi
        fi

        # Run puttygen in a way that doesn't crash the script on failure (we validate output afterwards).
        if ! puttygen "${input}" -O private-openssh -o "${converted}" >/dev/null 2>&1; then
          # Some puttygen builds are picky about path formats; retry with cygpath windows output if available.
          if command -v cygpath >/dev/null 2>&1; then
            local converted_win
            converted_win="$(cygpath -w "${converted}" 2>/dev/null || true)"
            if [[ -n "${converted_win}" ]]; then
              puttygen "${input}" -O private-openssh -o "${converted_win}" >/dev/null 2>&1 || true
            fi
          fi
        fi

        [[ -f "${converted}" ]] || die $'Failed to convert PuTTY .ppk key to OpenSSH key.\n\nChecks:\n- OPS_SSH_KEYFILE must point to an existing .ppk file.\n- Ensure puttygen can read it (try using a POSIX path like /c/Users/... in ops.env).\n- If the key is encrypted, re-export it in PuTTYgen with a passphrase you can supply.\n\nExpected output key path:\n'"${converted}"
        chmod 600 "${converted}" >/dev/null 2>&1 || true
      fi

      printf '%s' "${converted}"
      return 0
    fi

    die $'OPS_SSH_KEYFILE points to a PuTTY .ppk key, but these ops scripts use OpenSSH (ssh/scp).\n\nFix:\n- Convert the key to OpenSSH (PuTTYgen: Load key → Conversions → Export OpenSSH key) and set OPS_SSH_KEYFILE to the exported file.\n- OR install PuTTYgen CLI (puttygen) so the scripts can auto-convert .ppk keys.'
  fi

  printf '%s' "${keyfile}"
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

