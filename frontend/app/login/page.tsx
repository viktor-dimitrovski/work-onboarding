import { LoginForm } from '@/components/auth/login-form';
import { ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(16,110,255,0.06),transparent_40%),radial-gradient(circle_at_88%_75%,rgba(0,173,181,0.04),transparent_40%)]" />

      <header className="relative flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
            Onboarding Hub
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tracks, assessments, and much more.
          </p>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-start pt-6 sm:pt-8 px-4 sm:px-6">
        <div className="w-full max-w-[380px]">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
