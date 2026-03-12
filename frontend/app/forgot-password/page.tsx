'use client';

import { useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ShieldCheck, MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
});

type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // Always show success — the backend never reveals whether an account exists.
    try {
      await api.requestPasswordReset(values.email);
    } catch {
      // Silently ignore errors to prevent email enumeration.
    }
    setSubmittedEmail(values.email);
    setSent(true);
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
              <CardTitle className='text-xl'>Forgot password?</CardTitle>
              <CardDescription>
                Enter your email and we&apos;ll send you a reset link.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {sent ? (
                <div className='flex flex-col items-center gap-4 py-2 text-center'>
                  <MailCheck className='h-10 w-10 text-emerald-600' />
                  <p className='text-sm font-medium text-foreground'>
                    If <span className='font-semibold'>{submittedEmail}</span> is registered, a reset link has been sent. Check your inbox.
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    The link is valid for 24 hours. Check your spam folder if you don&apos;t see it.
                  </p>
                  <Link href='/login' className='text-sm text-primary underline-offset-4 hover:underline'>
                    Back to login
                  </Link>
                </div>
              ) : (
                <form className='grid gap-4' onSubmit={onSubmit}>
                  <div className='space-y-1.5'>
                    <Label htmlFor='email'>Email address</Label>
                    <Input
                      id='email'
                      type='email'
                      autoComplete='email'
                      placeholder='name@company.com'
                      {...form.register('email')}
                    />
                    {form.formState.errors.email && (
                      <p className='text-xs text-destructive'>{form.formState.errors.email.message}</p>
                    )}
                  </div>

                  <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
                  </Button>

                  <p className='text-center text-xs text-muted-foreground'>
                    Remember it?{' '}
                    <Link href='/login' className='text-primary underline-offset-4 hover:underline'>
                      Back to login
                    </Link>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
