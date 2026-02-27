import { LoginForm } from '@/components/auth/login-form';
import { ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

export default function LoginPage() {
  return (
    <main className='relative min-h-screen overflow-hidden bg-background'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(16,110,255,0.14),transparent_38%),radial-gradient(circle_at_90%_78%,rgba(0,173,181,0.10),transparent_44%)]' />

      <div className='relative mx-auto flex min-h-screen w-full max-w-6xl flex-col lg:grid lg:grid-cols-2'>
        <section className='relative hidden overflow-hidden border-r bg-white/55 px-12 py-16 backdrop-blur lg:flex lg:flex-col'>
          <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(16,110,255,0.16),transparent_45%),radial-gradient(circle_at_80%_60%,rgba(0,173,181,0.12),transparent_50%)]' />
          <div className='relative flex h-full flex-col justify-between gap-12 motion-safe:animate-fade-up'>
            <div>
              <div className='flex items-center gap-3'>
                <div className='rounded-xl bg-primary/10 p-3 text-primary'>
                  <ShieldCheck className='h-5 w-5' />
                </div>
                <div>
                  <p className='text-xs uppercase tracking-[0.22em] text-muted-foreground'>Internal</p>
                  <p className='text-base font-semibold'>Onboarding Hub</p>
                </div>
              </div>

              <h1 className='mt-10 max-w-xl text-4xl font-semibold leading-tight'>
                Centralized onboarding for every role.
              </h1>
              <p className='mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground'>
                Assign published tracks, capture evidence, route mentor approvals, and validate readiness before granting
                full access.
              </p>

              <div className='mt-10 grid max-w-lg gap-4'>
                <FeatureRow
                  icon={<UsersRound className='h-4 w-4' />}
                  title='Role-aware dashboards'
                  description='Admin, mentor, HR, and employee views with the right level of detail.'
                />
                <FeatureRow
                  icon={<Sparkles className='h-4 w-4' />}
                  title='Progress that is auditable'
                  description='Key actions are tracked; completion is computed from required tasks.'
                />
              </div>
            </div>

            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <p>Internal use only</p>
              <p>FastAPI + Next.js</p>
            </div>
          </div>
        </section>

        <section className='flex items-center justify-center px-6 py-10 sm:px-10 lg:px-12 lg:py-16'>
          <div className='w-full max-w-md motion-safe:animate-fade-up'>
            <div className='mb-6 lg:hidden'>
              <div className='flex items-center gap-3'>
                <div className='rounded-xl bg-primary/10 p-3 text-primary'>
                  <ShieldCheck className='h-5 w-5' />
                </div>
                <div>
                  <p className='text-xs uppercase tracking-[0.22em] text-muted-foreground'>Internal</p>
                  <p className='text-base font-semibold'>Onboarding Hub</p>
                </div>
              </div>
            </div>

            <LoginForm />

            <p className='mt-6 text-xs text-muted-foreground'>
              Tip: For production, rotate JWT secrets and use SSO (planned) for account lifecycle management.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function FeatureRow({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className='flex gap-3 rounded-lg border bg-white/65 p-4 shadow-soft'>
      <div className='mt-0.5 text-primary'>{icon}</div>
      <div>
        <p className='text-sm font-semibold'>{title}</p>
        <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
      </div>
    </div>
  );
}
