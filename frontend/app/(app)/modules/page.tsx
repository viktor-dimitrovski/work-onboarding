'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { getModuleDefaultHref, getVisibleModules } from '@/lib/modules';
import { useTenant } from '@/lib/tenant-context';

export default function ModulesPage() {
  const { hasRole } = useAuth();
  const { context, hasModule, hasPermission, isLoading } = useTenant();

  if (isLoading) {
    return <LoadingState label='Loading modules...' />;
  }

  const accessContext = {
    hasModule,
    hasPermission,
    hasRole,
    tenantSlug: context?.tenant?.slug,
    isLoading,
  };
  const modules = getVisibleModules(accessContext);

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Modules</h2>
        <p className='text-sm text-muted-foreground'>Select a module to access its dashboard and tools.</p>
      </div>

      {modules.length === 0 ? (
        <EmptyState
          title='No modules available'
          description='Your tenant does not have any modules enabled yet.'
        />
      ) : (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {modules.map((module) => {
            const Icon = module.icon;
            const href = getModuleDefaultHref(module, accessContext);
            return (
              <Link key={module.id} href={href} className='group block'>
                <Card className='flex h-full flex-col transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-soft'>
                  <CardHeader className='flex flex-row items-start gap-3'>
                    <div className='rounded-md bg-primary/10 p-2 text-primary'>
                      <Icon className='h-5 w-5' />
                    </div>
                    <div className='space-y-1'>
                      <CardTitle>{module.label}</CardTitle>
                      <CardDescription>{module.description}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className='mt-auto'>
                    <p className='text-xs text-muted-foreground'>Open module</p>
                  </CardContent>
                  <CardFooter className='pt-0'>
                    <span className='text-xs font-medium text-primary'>View menu →</span>
                  </CardFooter>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
