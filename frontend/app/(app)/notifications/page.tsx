'use client';

import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTenant } from '@/lib/tenant-context';

export default function NotificationsPage() {
  const { hasModule, hasPermission } = useTenant();
  const canManage = hasModule('settings') && hasPermission('settings:manage');

  if (!canManage) {
    return (
      <EmptyState
        title='Notifications disabled'
        description='Your tenant does not have notification management enabled.'
      />
    );
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Notifications</h2>
        <p className='text-sm text-muted-foreground'>Manage alert routing and delivery preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>Configure email, Slack, and webhook delivery targets.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>No channels configured yet.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>Define which events should trigger notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>Add your first notification rule.</p>
        </CardContent>
      </Card>
    </div>
  );
}
