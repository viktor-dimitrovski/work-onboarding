#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------
# Trigger backend deploy on VPS
# --------------------------------------------
#
# This is a thin wrapper that calls:
#   ops/vps/deploy-backend.sh
#
# Requirements:
# - Git Bash
# - ssh (Git for Windows)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
Usage:
  bash ops/local/deploy-backend.sh --env ops/ops.env [--branch main] [--skip-install] [--skip-migrate]
EOF
}

ENV_FILE="${ROOT_DIR}/ops/ops.env"
BRANCH=""
SKIP_INSTALL="false"
SKIP_MIGRATE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --skip-install) SKIP_INSTALL="true"; shift 1 ;;
    --skip-migrate) SKIP_MIGRATE="true"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

load_env_file "${ENV_FILE}"
require_cmd ssh

SSH_ARGS=()
while IFS= read -r line; do SSH_ARGS+=("$line"); done < <(ssh_base_args)
UAH="$(user_at_host)"

branch="${BRANCH:-${OPS_GIT_BRANCH:-main}}"

remote_cmd="cd '${OPS_REMOTE_APP_DIR}' && sudo bash ops/vps/deploy-backend.sh --branch '${branch}'"
if [[ "${SKIP_INSTALL}" == "true" ]]; then remote_cmd+=" --skip-install"; fi
if [[ "${SKIP_MIGRATE}" == "true" ]]; then remote_cmd+=" --skip-migrate"; fi

log INFO "Deploying backend on VPS (branch=${branch})"
ssh "${SSH_ARGS[@]}" "${UAH}" "${remote_cmd}"
log INFO "Backend deploy finished."

