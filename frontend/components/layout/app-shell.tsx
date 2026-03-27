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
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isWorkOrderEditor = Boolean(pathname?.startsWith('/work-orders/'));
  const isFullScreenPage =
    isWorkOrderEditor ||
    Boolean(pathname?.match(/^\/assessments\/tests\/.+/)) ||
    Boolean(pathname?.match(/^\/assessments\/take\/.+/));
  const mustChangePassword = Boolean(user?.must_change_password);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      const redirect = pathname && pathname !== '/' ? `?redirect=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${redirect}`);
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [isAuthenticated, isLoading, mustChangePassword, pathname, router]);

  if (isLoading) {
    return <LoadingState label='Authenticating session...' />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (mustChangePassword) {
    return (
      <div className='flex min-h-screen'>
        <main className='flex-1 p-6'>{children}</main>
      </div>
    );
  }

  return (
    <TenantProvider>
      {/*
        App-shell pattern: outer box is always a fixed h-screen viewport.
        Only <main> scrolls — the sidebar and top-header are never in the
        scroll flow, so sticky/fixed positioning works correctly on all pages.
      */}
      <div className='flex h-screen overflow-hidden'>
        {/* Sidebar — visible on lg+, fills the full shell height */}
        <div className='hidden lg:flex lg:h-full lg:shrink-0'>
          <SidebarNav />
        </div>

        {/* Right column: header + scrollable content */}
        <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
          <TopHeader />
          <main
            className={cn(
              'flex-1 min-w-0 min-h-0',
              isFullScreenPage ? 'overflow-hidden p-0' : 'app-main overflow-y-auto overflow-x-hidden p-4 sm:p-6',
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </TenantProvider>
  );
}
