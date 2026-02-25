'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

export function TopHeader() {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <header className='flex items-center justify-between border-b bg-white/70 px-6 py-3 backdrop-blur'>
      <div>
        <p className='text-xs uppercase tracking-[0.14em] text-muted-foreground'>Employee Onboarding Platform</p>
        <h1 className='text-lg font-semibold'>Welcome, {user?.full_name ?? 'User'}</h1>
      </div>
      <div className='flex items-center gap-3'>
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
