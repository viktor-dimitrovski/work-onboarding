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
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge, roles: ['super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer'] },
  { href: '/tracks', label: 'Tracks', icon: Layers, roles: ['super_admin', 'admin', 'mentor', 'hr_viewer'] },
  {
    href: '/assessments',
    label: 'Assessments',
    icon: FileQuestion,
    roles: ['super_admin', 'admin', 'mentor', 'hr_viewer', 'reviewer'],
  },
  { href: '/assignments', label: 'Assignments', icon: ClipboardList, roles: ['super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer'] },
  { href: '/users', label: 'Users', icon: Users, roles: ['super_admin', 'admin'] },
  { href: '/reports', label: 'Reports', icon: FileText, roles: ['super_admin', 'admin', 'hr_viewer', 'mentor'] },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer'] },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const allowedItems = NAV_ITEMS.filter((item) => item.roles.some((role) => user?.roles.includes(role as never)));

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
