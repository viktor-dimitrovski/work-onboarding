import { NextRequest, NextResponse } from 'next/server';

import { DEFAULT_PRODUCT_SUBDOMAINS, DEFAULT_RESERVED_SUBDOMAINS } from '@/modules/tenant-resolution';
import { resolveHostFromNextRequest } from '@/modules/tenant-resolution/adapters/nextMiddleware';

const BASE_DOMAINS = (process.env.NEXT_PUBLIC_BASE_DOMAINS || process.env.BASE_DOMAINS || 'app.com')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const RESERVED = (process.env.NEXT_PUBLIC_RESERVED_SUBDOMAINS || process.env.RESERVED_SUBDOMAINS)
  ? (process.env.NEXT_PUBLIC_RESERVED_SUBDOMAINS || process.env.RESERVED_SUBDOMAINS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  : DEFAULT_RESERVED_SUBDOMAINS;
const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG;

export function middleware(req: NextRequest) {
  const resolution = resolveHostFromNextRequest(
    req,
    {
      baseDomains: BASE_DOMAINS,
      reservedSubdomains: RESERVED,
      productSubdomains: DEFAULT_PRODUCT_SUBDOMAINS,
      defaultTenantSlug: DEFAULT_TENANT || undefined,
    },
    { trustProxy: true },
  );

  if (resolution.kind === 'default' && resolution.baseDomain && DEFAULT_TENANT) {
    const redirectUrl = new URL(req.url);
    redirectUrl.hostname = `${DEFAULT_TENANT}.${resolution.baseDomain}`;
    return NextResponse.redirect(redirectUrl);
  }

  if (resolution.kind === 'product' && resolution.productKey === 'admin') {
    const adminUrl = req.nextUrl.clone();
    // Serve the admin console under /admin regardless of the requested path.
    // This avoids 404s for paths like /dashboard on admin.<baseDomain>.
    if (adminUrl.pathname !== '/admin') {
      adminUrl.pathname = '/admin';
      return NextResponse.rewrite(adminUrl);
    }
  }

  // In production, keep tenant apps from hitting /admin routes.
  // In local/dev, allow it so you can manage everything from one console.
  if (resolution.kind === 'tenant' && req.nextUrl.pathname.startsWith('/admin')) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  const requestHeaders = new Headers(req.headers);
  if (resolution.kind === 'tenant' && resolution.tenantSlug) {
    requestHeaders.set('x-tenant-slug', resolution.tenantSlug);
  }
  if (resolution.kind === 'product' && resolution.productKey) {
    requestHeaders.set('x-product-key', resolution.productKey);
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
