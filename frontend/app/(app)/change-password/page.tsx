'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const schema = z
  .object({
    current_password: z.string().min(8),
    new_password: z.string().min(8),
    confirm_password: z.string().min(8),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type Values = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const { accessToken, user, setSession, refreshToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  useEffect(() => {
    if (user && !user.must_change_password) {
      router.replace('/dashboard');
    }
  }, [router, user]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!accessToken) return;
    setError(null);
    setSuccess(null);
    try {
      await api.changePassword(accessToken, {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      const me = (await api.me(accessToken)) as { must_change_password?: boolean };
      if (user && refreshToken) {
        setSession({
          user: { ...user, must_change_password: Boolean(me.must_change_password) },
          accessToken,
          refreshToken,
        });
      }
      setSuccess('Password updated. Redirecting…');
      form.reset({ current_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => router.replace('/dashboard'), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    }
  });

  return (
    <div className='mx-auto w-full max-w-lg space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Change password</h2>
        <p className='text-sm text-muted-foreground'>
          For security, you must update your password before continuing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Update credentials</CardTitle>
          <CardDescription>Use your temporary password as the current password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className='grid gap-4' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label>Current password</Label>
              <Input type='password' {...form.register('current_password')} />
              {form.formState.errors.current_password && (
                <p className='text-xs text-destructive'>{form.formState.errors.current_password.message}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label>New password</Label>
              <Input type='password' {...form.register('new_password')} />
              {form.formState.errors.new_password && (
                <p className='text-xs text-destructive'>{form.formState.errors.new_password.message}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label>Confirm new password</Label>
              <Input type='password' {...form.register('confirm_password')} />
              {form.formState.errors.confirm_password && (
                <p className='text-xs text-destructive'>{form.formState.errors.confirm_password.message}</p>
              )}
            </div>

            {error && <p className='text-sm text-destructive'>{error}</p>}
            {success && <p className='text-sm text-emerald-700'>{success}</p>}

            <div className='flex justify-end'>
              <Button type='submit' disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

