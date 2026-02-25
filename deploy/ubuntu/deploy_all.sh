#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/01_install_dependencies.sh"
"${SCRIPT_DIR}/02_configure_postgres.sh"
"${SCRIPT_DIR}/03_prepare_app.sh"
"${SCRIPT_DIR}/04_migrate_and_seed.sh"
"${SCRIPT_DIR}/05_install_systemd_services.sh"
"${SCRIPT_DIR}/06_install_nginx_proxy.sh"

printf '\nDeployment completed successfully.\n'
printf 'Backend service:  onboarding-backend\n'
printf 'Frontend service: onboarding-frontend\n'
printf 'Check status with: systemctl status onboarding-backend onboarding-frontend --no-pager\n'
