'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ShieldCheck, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

const schema = z
  .object({
    new_password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string().min(8),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type Values = z.infer<typeof schema>;

export default function SetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', confirm_password: '' },
  });

  useEffect(() => {
    if (!token) {
      setError('The invitation link is missing or invalid. Please ask to be re-invited.');
    }
  }, [token]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.setPassword({ token, new_password: values.new_password });
      setSuccess(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The link has expired or already been used. Please ask to be re-invited.');
    }
  });

  return (
    <main className='relative flex min-h-screen flex-col overflow-hidden bg-background'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(16,110,255,0.06),transparent_40%),radial-gradient(circle_at_88%_75%,rgba(0,173,181,0.04),transparent_40%)]' />

      <header className='relative flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6 sm:pt-5'>
        <div className='rounded-md bg-primary/10 p-2 text-primary'>
          <ShieldCheck className='h-5 w-5 sm:h-6 sm:w-6' aria-hidden />
        </div>
        <h1 className='text-base font-semibold tracking-tight text-foreground sm:text-lg'>Solve Box</h1>
      </header>

      <div className='relative flex min-h-0 flex-1 flex-col items-center justify-start px-4 pt-10 sm:px-6 sm:pt-14'>
        <div className='w-full max-w-[400px]'>
          <Card>
            <CardHeader className='space-y-1 pb-4'>
              <div className='mb-1 flex items-center gap-2'>
                <KeyRound className='h-5 w-5 text-primary' />
                <CardTitle className='text-xl'>Set your password</CardTitle>
              </div>
              <CardDescription>
                Choose a strong password to activate your account.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {success ? (
                <div className='space-y-3 text-center'>
                  <p className='text-sm font-medium text-emerald-700'>
                    Password set successfully! Redirecting to login…
                  </p>
                </div>
              ) : (
                <form className='grid gap-4' onSubmit={onSubmit}>
                  <div className='space-y-1.5'>
                    <Label htmlFor='new_password'>New password</Label>
                    <Input
                      id='new_password'
                      type='password'
                      autoComplete='new-password'
                      placeholder='Min. 8 characters'
                      {...form.register('new_password')}
                    />
                    {form.formState.errors.new_password && (
                      <p className='text-xs text-destructive'>{form.formState.errors.new_password.message}</p>
                    )}
                  </div>

                  <div className='space-y-1.5'>
                    <Label htmlFor='confirm_password'>Confirm password</Label>
                    <Input
                      id='confirm_password'
                      type='password'
                      autoComplete='new-password'
                      placeholder='Repeat password'
                      {...form.register('confirm_password')}
                    />
                    {form.formState.errors.confirm_password && (
                      <p className='text-xs text-destructive'>{form.formState.errors.confirm_password.message}</p>
                    )}
                  </div>

                  {error && <p className='text-sm text-destructive'>{error}</p>}

                  <Button type='submit' className='w-full' disabled={form.formState.isSubmitting || !token}>
                    {form.formState.isSubmitting ? 'Setting password…' : 'Set password & activate account'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
