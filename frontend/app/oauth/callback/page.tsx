'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { LoadingState } from '@/components/common/loading-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AuthUser } from '@/lib/types';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');
    if (!accessToken || !refreshToken) {
      setError('Missing OAuth tokens in callback.');
      return;
    }

    const run = async () => {
      try {
        const user = (await api.me(accessToken)) as AuthUser;
        setSession({ user, accessToken, refreshToken });
        router.replace('/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to complete OAuth login.');
      }
    };

    void run();
  }, [router, searchParams, setSession]);

  if (error) {
    return (
      <div className='flex min-h-screen items-center justify-center p-6'>
        <div className='max-w-md rounded-md border bg-white p-6 text-sm text-destructive'>{error}</div>
      </div>
    );
  }

  return <LoadingState label='Signing you in...' />;
}
