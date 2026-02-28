'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gauge, LayoutGrid, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { getActiveModule, getModuleNavItems, getVisibleModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { useTenant } from '@/lib/tenant-context';

const BASE_ITEMS = [
  { href: '/modules', label: 'Modules', icon: LayoutGrid },
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { context, hasModule, hasPermission, isLoading } = useTenant();
  const { hasRole } = useAuth();

  const accessContext = {
    hasModule,
    hasPermission,
    hasRole,
    tenantSlug: context?.tenant?.slug,
    isLoading,
  };

  const visibleModules = getVisibleModules(accessContext);
  const activeModule = getActiveModule(pathname);
  const activeModuleAllowed =
    activeModule && visibleModules.some((module) => module.id === activeModule.id) ? activeModule : null;
  const moduleNavItems = activeModuleAllowed ? getModuleNavItems(activeModuleAllowed, accessContext) : [];

  return (
    <aside className='flex w-14 flex-col border-r bg-white/80 p-2 backdrop-blur sm:w-16 md:w-64 md:p-4'>
      <div className='mb-6 flex items-center gap-2 px-0 justify-center md:justify-start md:px-2'>
        <div className='rounded-lg bg-primary p-2 text-primary-foreground'>
          <ShieldCheck className='h-4 w-4' />
        </div>
        <div className='hidden md:block'>
          <p className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>Internal</p>
          <p className='text-sm font-semibold'>Onboarding Hub</p>
        </div>
      </div>
      <nav className='space-y-6'>
        <div className='space-y-1'>
          {BASE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors justify-center md:justify-start md:px-3',
                  active
                    ? 'bg-primary text-primary-foreground shadow-soft'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className='h-4 w-4' />
                <span className='hidden md:inline'>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {activeModuleAllowed && moduleNavItems.length > 0 ? (
          <div className='space-y-1'>
            <p className='hidden px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground md:block'>
              {activeModuleAllowed.label}
            </p>
            {moduleNavItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors justify-center md:justify-start md:px-3',
                    active
                      ? 'bg-primary text-primary-foreground shadow-soft'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className='h-4 w-4' />
                  <span className='hidden md:inline'>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className='hidden px-2 text-xs text-muted-foreground md:block'>
            Select a module to see its menu.
          </p>
        )}
      </nav>
    </aside>
  );
}
