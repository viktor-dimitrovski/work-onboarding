'use client';

import Link from 'next/link';
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
  const [rememberMe, setRememberMe] = useState(true);

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
    <Card className="w-full rounded-lg border border-border/70 bg-white shadow-sm dark:bg-card">
      <CardHeader className="space-y-1 px-5 pb-2 pt-5">
        <CardTitle className="text-lg font-semibold tracking-tight text-foreground">Sign in</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Use your account email and password.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-5 pb-5">
        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-9 font-medium rounded-md border border-input/80 shadow-none hover:bg-muted/50"
            onClick={() => startOAuth('microsoft')}
          >
            Continue with Microsoft
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-9 font-medium rounded-md border border-input/80 shadow-none hover:bg-muted/50"
            onClick={() => startOAuth('google')}
          >
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-9 font-medium rounded-md border border-input/80 shadow-none hover:bg-muted/50"
            onClick={() => startOAuth('github')}
          >
            Continue with GitHub
          </Button>
        </div>

        <div className="relative" aria-hidden="true">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/80" />
          </div>
          <div className="relative flex justify-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="bg-white px-2 dark:bg-card">or with email</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={onSubmit} aria-busy={isSubmitting}>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              className="h-9 rounded-md border border-input/80 bg-background focus-visible:ring-1 focus-visible:ring-primary/30"
              aria-invalid={emailError ? 'true' : 'false'}
              aria-describedby={emailError ? 'email-error' : undefined}
              {...form.register('email')}
            />
            {emailError && (
              <p id="email-error" className="text-xs font-medium text-destructive" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="At least 8 characters"
                className="h-9 pr-9 rounded-md border border-input/80 bg-background focus-visible:ring-1 focus-visible:ring-primary/30"
                aria-invalid={passwordError ? 'true' : 'false'}
                aria-describedby={passwordError ? 'password-error' : undefined}
                {...form.register('password')}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-controls="password"
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {passwordError && (
              <p id="password-error" className="text-xs font-medium text-destructive" role="alert">
                {passwordError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border border-input text-primary focus-visible:ring-1 focus-visible:ring-primary/30"
                aria-describedby="remember-label"
              />
              <span id="remember-label">Remember me</span>
            </label>
            <span className="text-xs text-muted-foreground">Protected with standard security.</span>
          </div>

          {error && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}

          <Button type="submit" className="w-full h-9 font-medium" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-foreground">
            Don&apos;t have an account?{' '}
            <Link
              href="/sign-up"
              className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded"
            >
              Create one
            </Link>
          </p>

          <p className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded">
              Privacy Policy
            </Link>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
