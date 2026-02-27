# VPS + Cloudflare (Wildcard Subdomains)

This guide documents wildcard DNS and TLS setup for multi-tenant subdomains on a single VPS behind Cloudflare.

## DNS (Cloudflare)

Create an A record for your apex and wildcard:

- `app.com` → VPS public IP
- `*.app.com` → VPS public IP

Enable the Cloudflare proxy (orange cloud) if you want Cloudflare-managed TLS and WAF.

## TLS Options

### Option A (recommended): Cloudflare Origin Certificate

Use a Cloudflare Origin Certificate on the VPS and enable **Full (Strict)** mode in Cloudflare.

1. Cloudflare → SSL/TLS → Origin Server → Create Certificate
2. Choose hostnames: `app.com` and `*.app.com`
3. Install cert + key on the VPS
4. Configure Nginx to use the origin cert
5. Set Cloudflare SSL/TLS mode to **Full (Strict)**

### Option B: Let’s Encrypt wildcard (DNS-01)

Use DNS-01 validation with a Cloudflare API token.

1. Create a Cloudflare API token with DNS edit permissions
2. Use Certbot (or acme.sh) to request a wildcard cert
3. Install the cert in Nginx and automate renewal

## Nginx Reverse Proxy (example)

This snippet extends the existing `deploy/ubuntu/06_install_nginx_proxy.sh` behavior with wildcard hostnames and trusted headers.

```
server {
    listen 80;
    server_name app.com *.app.com;

    client_max_body_size 25m;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:8001/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }

    location / {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Trusted Host Headers

Tenant routing should only trust **Host** or **X-Forwarded-Host** from the reverse proxy. Do not accept arbitrary tenant identifiers from user input.
