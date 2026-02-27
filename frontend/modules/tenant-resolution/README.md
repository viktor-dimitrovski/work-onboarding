# Tenant Resolution Module

Framework-agnostic utilities to resolve tenant/product/default context from a trusted host header.

## API

- `resolveHost(host, options)` → `{kind:'tenant'|'product'|'default', tenantSlug?, productKey?}`
- `validateSlug(slug)` + `normalizeSlug(slug)`
- `resolveTrustedHost(host, xForwardedHost, { trustProxy })`

## Next.js middleware adapter

```
import { resolveHostFromNextRequest } from '@/modules/tenant-resolution/adapters/nextMiddleware';
```

Pass `ResolveHostOptions` and `TrustedProxyOptions` to resolve host kinds inside `middleware.ts`.
