import { describe, expect, it } from 'vitest';

import { resolveHost } from '../resolveHost';

const options = {
  baseDomains: ['app.com', 'localtest.me'],
  reservedSubdomains: ['admin', 'api', 'billing'],
  productSubdomains: { admin: 'admin', api: 'api', billing: 'billing' },
};

describe('resolveHost', () => {
  it('returns default for apex domain', () => {
    const result = resolveHost('app.com', options);
    expect(result.kind).toBe('default');
  });

  it('returns tenant for valid slug', () => {
    const result = resolveHost('acme.app.com', options);
    expect(result.kind).toBe('tenant');
    expect(result.tenantSlug).toBe('acme');
  });

  it('returns product for reserved subdomain', () => {
    const result = resolveHost('admin.app.com', options);
    expect(result.kind).toBe('product');
    expect(result.productKey).toBe('admin');
  });

  it('returns default for invalid slug', () => {
    const result = resolveHost('bad_slug.app.com', options);
    expect(result.kind).toBe('default');
  });

  it('supports localtest.me for dev', () => {
    const result = resolveHost('tenant1.localtest.me', options);
    expect(result.kind).toBe('tenant');
    expect(result.tenantSlug).toBe('tenant1');
  });
});
