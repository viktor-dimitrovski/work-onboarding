'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Gauge, LayoutGrid, LogOut, ShieldCheck, User, X } from 'lucide-react';
import { useMemo } from 'react';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAuth } from '@/lib/auth-context';
import { getActiveModule, getModuleNavItems, getVisibleModules } from '@/lib/modules';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type MobileNavProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const BASE_ITEMS = [
  { href: '/modules', label: 'Modules', icon: LayoutGrid },
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
];

export function MobileNav({ open, onOpenChange }: MobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, hasRole } = useAuth();
  const { context, hasModule, hasPermission, isLoading } = useTenant();

  const accessContext = useMemo(
    () => ({
      hasModule,
      hasPermission,
      hasRole,
      tenantSlug: context?.tenant?.slug,
      isLoading,
    }),
    [hasModule, hasPermission, hasRole, context?.tenant?.slug, isLoading],
  );

  const visibleModules = getVisibleModules(accessContext);
  const activeModule = getActiveModule(pathname);

  const moduleGroups = useMemo(() => {
    return visibleModules
      .map((module) => ({ module, items: getModuleNavItems(module, accessContext) }))
      .filter((g) => g.items.length > 0);
  }, [visibleModules, accessContext]);

  const tenantLabel = context?.tenant?.name || context?.tenant?.slug;

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  const navLinkClass = (active: boolean) =>
    cn(
      'flex min-h-[52px] items-center gap-3.5 rounded-xl px-3.5 py-3 text-[17px] font-medium transition-all duration-150',
      active
        ? 'border-l-[3px] border-primary bg-primary/[0.08] pl-[calc(0.875rem-3px)] text-primary'
        : 'border-l-[3px] border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900',
    );

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='left' className='w-[82vw] max-w-[320px] p-0' hideCloseButton>
        <div className='flex h-full flex-col'>

          {/* ── Sheet header: close button at same spot as the hamburger ── */}
          <div
            className='flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3'
            style={{
              paddingTop: 'max(env(safe-area-inset-top), 8px)',
              paddingBottom: '12px',
            }}
          >
            {/*
              This button sits at position (left: 12px, top: safe-area + 8px),
              same coordinates as the hamburger in the TopHeader.
              h-11 w-11 matches the hamburger button size exactly.
            */}
            <button
              type='button'
              onClick={() => onOpenChange(false)}
              aria-label='Close navigation'
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-200 active:bg-slate-300'
            >
              <X style={{ width: 26, height: 26 }} />
            </button>

            {/* Brand */}
            <div className='flex min-w-0 items-center gap-2.5'>
              <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm'>
                <ShieldCheck className='h-[18px] w-[18px] text-white' />
              </div>
              <div className='min-w-0'>
                <p className='text-[15px] font-bold leading-tight text-slate-900'>SolveBox Hub</p>
                {tenantLabel && (
                  <p className='truncate text-[12px] text-slate-500'>{tenantLabel}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Nav links ── */}
          <div className='flex-1 overflow-y-auto px-3 py-4'>
            <div className='space-y-1'>
              {BASE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    className={navLinkClass(active)}
                  >
                    <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-slate-400')} />
                    <span className='truncate'>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {moduleGroups.length > 0 && (
              <div className='mt-6 space-y-5'>
                {moduleGroups.map(({ module, items }) => {
                  const isActiveGroup = activeModule?.id === module.id;
                  const ModuleIcon = module.icon;
                  return (
                    <div key={module.id}>
                      <div
                        className={cn(
                          'mb-2 flex items-center gap-1.5 px-3.5 text-[11px] font-bold uppercase tracking-widest',
                          isActiveGroup ? 'text-primary' : 'text-slate-400',
                        )}
                      >
                        <ModuleIcon className='h-3.5 w-3.5' />
                        <span>{module.label}</span>
                      </div>
                      <div className='space-y-1'>
                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = isActive(item.href);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => onOpenChange(false)}
                              className={navLinkClass(active)}
                            >
                              <Icon
                                className={cn(
                                  'h-5 w-5 shrink-0',
                                  active ? 'text-primary' : 'text-slate-400',
                                )}
                              />
                              <span className='truncate'>{item.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── User + logout footer ── */}
          <div
            className='border-t border-slate-100 bg-slate-50 px-3 py-3'
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
          >
            {user && (
              <div className='mb-2 flex items-center gap-3 px-2 py-1.5'>
                <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200'>
                  <User className='h-4 w-4 text-slate-500' />
                </div>
                <div className='min-w-0'>
                  <p className='truncate text-[14px] font-semibold text-slate-800'>{user.full_name}</p>
                  <p className='truncate text-[12px] text-slate-500'>{user.email}</p>
                </div>
              </div>
            )}
            <button
              type='button'
              onClick={handleLogout}
              className='flex min-h-[52px] w-full items-center gap-3.5 rounded-xl px-3.5 py-3 text-[17px] font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 active:bg-red-100'
            >
              <LogOut className='h-5 w-5 shrink-0 text-slate-400' />
              <span>Logout</span>
            </button>
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}
