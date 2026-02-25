#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_root

BACKEND_SERVICE_NAME="onboarding-backend"
FRONTEND_SERVICE_NAME="onboarding-frontend"

log "Installing systemd service units."

cat >/etc/systemd/system/${BACKEND_SERVICE_NAME}.service <<EOF
[Unit]
Description=Internal Onboarding Platform Backend (FastAPI)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${BACKEND_ENV_FILE}
Environment=PYTHONUNBUFFERED=1
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT} --workers ${BACKEND_WORKERS}
Restart=always
RestartSec=5
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/${FRONTEND_SERVICE_NAME}.service <<EOF
[Unit]
Description=Internal Onboarding Platform Frontend (Next.js)
After=network.target ${BACKEND_SERVICE_NAME}.service
Requires=${BACKEND_SERVICE_NAME}.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}/frontend
EnvironmentFile=${FRONTEND_ENV_FILE}
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${BACKEND_SERVICE_NAME}.service
systemctl enable --now ${FRONTEND_SERVICE_NAME}.service

log "Systemd services enabled and started."
