'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const startOAuth = (provider: string) => {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1').replace(/\/$/, '');
    window.location.href = `${apiBase}/auth/oauth/${provider}/start`;
  };

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      router.replace('/dashboard');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to sign in');
    }
  });

  const isSubmitting = form.formState.isSubmitting;
  const emailError = form.formState.errors.email?.message;
  const passwordError = form.formState.errors.password?.message;

  return (
    <Card className='w-full border bg-white/70 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-white/60'>
      <CardHeader className='space-y-2 pb-4'>
        <p className='text-xs uppercase tracking-[0.22em] text-muted-foreground'>Employee Onboarding Platform</p>
        <div className='space-y-1'>
          <CardTitle className='text-2xl'>Sign in</CardTitle>
          <CardDescription className='text-sm'>
            Use your internal credentials. If you need access, contact your administrator.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className='space-y-5'>
        <div className='grid gap-2'>
          <Button type='button' variant='outline' size='lg' className='w-full' onClick={() => startOAuth('microsoft')}>
            Continue with Microsoft
          </Button>
          <Button type='button' variant='outline' size='lg' className='w-full' onClick={() => startOAuth('google')}>
            Continue with Google
          </Button>
          <Button type='button' variant='outline' size='lg' className='w-full' onClick={() => startOAuth('github')}>
            Continue with GitHub
          </Button>
        </div>

        <div className='relative py-1'>
          <div className='absolute inset-0 flex items-center' aria-hidden='true'>
            <span className='w-full border-t border-border' />
          </div>
          <div className='relative flex justify-center'>
            <span className='bg-white/70 px-2 text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-white/60'>
              or sign in with email
            </span>
          </div>
        </div>

        <form className='space-y-5' onSubmit={onSubmit} aria-busy={isSubmitting}>
          <div className='space-y-1.5'>
            <Label htmlFor='email'>Email</Label>
            <Input
              id='email'
              type='email'
              autoComplete='email'
              aria-invalid={emailError ? 'true' : 'false'}
              aria-describedby={emailError ? 'email-error' : undefined}
              {...form.register('email')}
            />
            {emailError && (
              <p id='email-error' className='text-xs text-destructive' role='alert'>
                {emailError}
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='password'>Password</Label>
            <div className='relative'>
              <Input
                id='password'
                type={showPassword ? 'text' : 'password'}
                autoComplete='current-password'
                className='pr-10'
                aria-invalid={passwordError ? 'true' : 'false'}
                aria-describedby={passwordError ? 'password-error' : undefined}
                {...form.register('password')}
              />
              <button
                type='button'
                className='absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-controls='password'
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              </button>
            </div>
            {passwordError && (
              <p id='password-error' className='text-xs text-destructive' role='alert'>
                {passwordError}
              </p>
            )}
          </div>

          {error && (
            <div
              className='rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive'
              role='alert'
              aria-live='polite'
            >
              {error}
            </div>
          )}

          <Button className='w-full' size='lg' type='submit' disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
