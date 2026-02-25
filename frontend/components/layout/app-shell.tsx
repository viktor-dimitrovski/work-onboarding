'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { LoadingState } from '@/components/common/loading-state';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { TopHeader } from '@/components/layout/top-header';
import { useAuth } from '@/lib/auth-context';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return <LoadingState label='Authenticating session...' />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className='flex min-h-screen'>
      <SidebarNav />
      <div className='flex min-h-screen flex-1 flex-col'>
        <TopHeader />
        <main className='flex-1 p-6'>{children}</main>
      </div>
    </div>
  );
}
