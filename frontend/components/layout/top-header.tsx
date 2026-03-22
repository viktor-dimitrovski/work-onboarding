'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Menu, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MobileNav } from '@/components/layout/mobile-nav';
import { cn } from '@/lib/utils';
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const adminUrl = useMemo(() => {
    if (!hasRole('super_admin')) return null;
    return buildAdminUrl();
  }, [hasRole]);

  const tenantLabel = context?.tenant?.name || context?.tenant?.slug;
  const tenantSlug = context?.tenant?.slug;

  return (
    <>
      <header className='sticky top-0 z-30 flex items-center justify-between border-b bg-white/90 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-3 lg:px-6'>
        {/* Mobile header left: hamburger + brand */}
        <div className='flex min-w-0 items-center gap-2.5 lg:hidden'>
          <button
            type='button'
            className='relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted active:bg-muted/80'
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          >
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-all duration-200',
                mobileNavOpen ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100',
              )}
            >
              <Menu style={{ width: 26, height: 26 }} />
            </span>
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-all duration-200',
                mobileNavOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0',
              )}
            >
              <X style={{ width: 26, height: 26 }} />
            </span>
          </button>
          <div className='min-w-0'>
            <p className='text-[15px] font-bold leading-tight text-foreground'>SolveBox Hub</p>
            {tenantLabel && (
              <p className='truncate text-[11px] text-muted-foreground'>
                {tenantLabel}
                {tenantSlug && tenantLabel !== tenantSlug ? ` · ${tenantSlug}` : ''}
              </p>
            )}
          </div>
        </div>

        {/* Desktop header left */}
        <div className='hidden lg:block'>
          <p className='text-xs uppercase tracking-[0.14em] text-muted-foreground'>
            Tracks, assessments, and much more
          </p>
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

        {/* Desktop actions */}
        <div className='hidden items-center gap-3 lg:flex'>
          {adminUrl ? (
            <Button asChild variant='outline' size='sm'>
              <a href={adminUrl} target='_blank' rel='noreferrer'>
                Admin console
                <ExternalLink className='ml-2 h-4 w-4' />
              </a>
            </Button>
          ) : null}
          <p className='text-sm text-muted-foreground'>{user?.email}</p>
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

      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
    </>
  );
}
