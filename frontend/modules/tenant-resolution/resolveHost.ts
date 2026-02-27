import type { HostResolution, ResolveHostOptions } from './types';
import { normalizeSlug, validateSlug } from './validateSlug';
import { stripPort } from './trustedProxy';

function matchBaseDomain(host: string, baseDomains: string[]): string | null {
  for (const base of baseDomains) {
    const normalized = base.toLowerCase();
    if (host === normalized) return normalized;
    if (host.endsWith(`.${normalized}`)) return normalized;
  }
  return null;
}

export function resolveHost(rawHost: string, options: ResolveHostOptions): HostResolution {
  const host = stripPort(rawHost);
  const baseDomain = matchBaseDomain(host, options.baseDomains);
  if (!baseDomain) {
    return { kind: 'default', host, reason: 'base_domain_not_allowed' };
  }

  if (host === baseDomain) {
    return { kind: 'default', host, baseDomain };
  }

  const subdomainPart = host.slice(0, host.length - baseDomain.length - 1);
  if (!subdomainPart) {
    return { kind: 'default', host, baseDomain };
  }

  const labels = subdomainPart.split('.');
  if (labels.length !== 1) {
    return { kind: 'default', host, baseDomain, reason: 'multi_label_subdomain' };
  }

  const slug = normalizeSlug(labels[0]);
  if (options.reservedSubdomains.includes(slug)) {
    const productKey = options.productSubdomains[slug] || slug;
    return { kind: 'product', host, baseDomain, productKey };
  }

  if (!validateSlug(slug)) {
    return { kind: 'default', host, baseDomain, reason: 'invalid_slug' };
  }

  return { kind: 'tenant', host, baseDomain, tenantSlug: slug };
}
