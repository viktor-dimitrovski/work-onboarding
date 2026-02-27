import type { NextRequest } from 'next/server';

import type { HostResolution, ResolveHostOptions, TrustedProxyOptions } from '../types';
import { resolveHost } from '../resolveHost';
import { resolveTrustedHost } from '../trustedProxy';

export function resolveHostFromNextRequest(
  req: NextRequest,
  options: ResolveHostOptions,
  proxy: TrustedProxyOptions,
): HostResolution {
  const hostHeader = req.headers.get('host');
  const forwardedHost = req.headers.get('x-forwarded-host');
  const trustedHost = resolveTrustedHost(hostHeader, forwardedHost, proxy);
  if (!trustedHost) {
    return { kind: 'default', reason: 'missing_host' };
  }
  return resolveHost(trustedHost, options);
}
