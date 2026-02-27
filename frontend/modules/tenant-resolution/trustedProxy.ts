import type { TrustedProxyOptions } from './types';

export function resolveTrustedHost(
  hostHeader: string | null,
  forwardedHostHeader: string | null,
  options: TrustedProxyOptions,
): string | null {
  if (options.trustProxy && forwardedHostHeader) {
    const first = forwardedHostHeader.split(',')[0]?.trim();
    return first || hostHeader;
  }
  return hostHeader;
}

export function stripPort(host: string): string {
  return host.replace(/:\d+$/, '').toLowerCase();
}
