'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { LoadingState } from '@/components/common/loading-state';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { TopHeader } from '@/components/layout/top-header';
import { useAuth } from '@/lib/auth-context';
import { TenantProvider } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isWorkOrderEditor = Boolean(pathname?.startsWith('/work-orders/'));

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  useEffect(() => {
    if (!isWorkOrderEditor) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isWorkOrderEditor]);

  if (isLoading) {
    return <LoadingState label='Authenticating session...' />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <TenantProvider>
      <div className={cn('flex min-h-screen', isWorkOrderEditor && 'h-screen overflow-hidden')}>
        <SidebarNav />
        <div className={cn('flex min-h-screen flex-1 flex-col', isWorkOrderEditor && 'h-screen')}>
          <TopHeader />
          <main className={cn('flex-1 p-6', isWorkOrderEditor && 'overflow-hidden')}>{children}</main>
        </div>
      </div>
    </TenantProvider>
  );
}
