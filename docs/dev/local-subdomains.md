# Local Subdomains (Development)

This guide explains how to test tenant subdomains locally without editing your production DNS.

## Option A: localtest.me

`localtest.me` resolves all subdomains to `127.0.0.1`.

Examples:
- `tenant1.localtest.me:3001`
- `admin.localtest.me:3001`
- `app.localtest.me:3001`

## Option B: nip.io

`nip.io` resolves `x.x.x.x.nip.io` to `x.x.x.x`.

Example for localhost:
- `tenant1.127.0.0.1.nip.io:3001`

## Option C: /etc/hosts

Map subdomains to localhost:

```
127.0.0.1 tenant1.app.local
127.0.0.1 admin.app.local
127.0.0.1 app.local
```

Then access:
- `http://tenant1.app.local:3001`
- `http://admin.app.local:3001`
- `http://app.local:3001`

## Notes

- Ensure your reverse proxy forwards **Host** and **X-Forwarded-Host**.
- For TLS locally, prefer HTTP to keep iteration fast unless you need to test strict HTTPS behavior.
