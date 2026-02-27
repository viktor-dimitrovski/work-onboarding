export type HostKind = 'tenant' | 'product' | 'default';

export type HostResolution = {
  kind: HostKind;
  tenantSlug?: string;
  productKey?: string;
  baseDomain?: string;
  host?: string;
  reason?: string;
};

export type ProductSubdomainMap = Record<string, string>;

export type ResolveHostOptions = {
  baseDomains: string[];
  reservedSubdomains: string[];
  productSubdomains: ProductSubdomainMap;
  defaultTenantSlug?: string;
};

export type TrustedProxyOptions = {
  trustProxy: boolean;
};
