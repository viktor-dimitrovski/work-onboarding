'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardList,
  FileText,
  FileQuestion,
  Gauge,
  Layers,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTenant } from '@/lib/tenant-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/tracks', label: 'Tracks', icon: Layers, module: 'tracks', permission: 'tracks:read' },
  { href: '/assessments', label: 'Assessments', icon: FileQuestion, module: 'assessments', permission: 'assessments:read' },
  { href: '/assignments', label: 'Assignments', icon: ClipboardList, module: 'assignments', permission: 'assignments:read' },
  { href: '/users', label: 'Users', icon: Users, module: 'users', permission: 'users:read' },
  { href: '/reports', label: 'Reports', icon: FileText, module: 'reports', permission: 'reports:read' },
  { href: '/settings', label: 'Settings', icon: Settings, module: 'settings', permission: 'settings:manage' },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { hasModule, hasPermission, isLoading } = useTenant();

  const allowedItems = NAV_ITEMS.filter((item) => {
    if (!item.module || !item.permission) {
      return true;
    }
    if (isLoading) {
      return false;
    }
    return hasModule(item.module) && hasPermission(item.permission);
  });

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
      <nav className='space-y-1'>
        {allowedItems.map((item) => {
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
      </nav>
    </aside>
  );
}
