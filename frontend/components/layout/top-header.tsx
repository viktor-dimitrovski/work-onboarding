'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

function resolveBaseDomain(hostname: string): string {
  const raw = process.env.NEXT_PUBLIC_BASE_DOMAINS || process.env.BASE_DOMAINS || '';
  const baseDomains = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const host = (hostname || '').trim().toLowerCase();
  for (const base of baseDomains) {
    if (host === base || host.endsWith(`.${base}`)) {
      return base;
    }
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return host;
}

function buildAdminUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname, port } = window.location;
  const baseDomain = resolveBaseDomain(hostname);
  if (!baseDomain) return null;
  const host = `admin.${baseDomain}`;
  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//${host}${portSuffix}/admin`;
}

export function TopHeader() {
  const router = useRouter();
  const { user, logout, hasRole } = useAuth();
  const { context } = useTenant();

  const adminUrl = useMemo(() => {
    if (!hasRole('super_admin')) return null;
    return buildAdminUrl();
  }, [hasRole]);

  const tenantLabel = context?.tenant?.name || context?.tenant?.slug;
  const tenantSlug = context?.tenant?.slug;

  return (
    <header className='flex items-center justify-between border-b bg-white/70 px-6 py-3 backdrop-blur'>
      <div>
        <p className='text-xs uppercase tracking-[0.14em] text-muted-foreground'>Tracks, assessments, and much more</p>
        <div className='flex flex-wrap items-center gap-2'>
          <h1 className='text-lg font-semibold'>Welcome, {user?.full_name ?? 'User'}</h1>
          {tenantLabel && (
            <Badge variant='secondary' className='text-[11px]'>
              Tenant: {tenantLabel}
              {tenantSlug && tenantLabel !== tenantSlug ? ` (${tenantSlug})` : ''}
            </Badge>
          )}
        </div>
      </div>
      <div className='flex items-center gap-3'>
        {adminUrl ? (
          <Button asChild variant='outline' size='sm'>
            <a href={adminUrl} target='_blank' rel='noreferrer'>
              Admin console
              <ExternalLink className='ml-2 h-4 w-4' />
            </a>
          </Button>
        ) : null}
        <p className='hidden text-sm text-muted-foreground sm:block'>{user?.email}</p>
        <Button
          variant='outline'
          onClick={async () => {
            await logout();
            router.push('/login');
          }}
        >
          Logout
        </Button>
      </div>
    </header>
  );
}
