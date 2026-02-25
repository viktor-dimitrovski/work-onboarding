#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

require_root

if [[ "${INSTALL_NGINX}" != "true" ]]; then
  log "INSTALL_NGINX is not true, skipping nginx setup."
  exit 0
fi

log "Configuring Nginx reverse proxy."
apt-get update
apt-get install -y --no-install-recommends nginx

NGINX_CONF="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"

cat >"${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 25m;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/api/v1/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
    }

    location / {
        proxy_pass http://127.0.0.1:${FRONTEND_PORT}/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sf "${NGINX_CONF}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "Nginx configured and reloaded."
