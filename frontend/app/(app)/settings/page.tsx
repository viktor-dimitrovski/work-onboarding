'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function SettingsPage() {
  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Settings</h2>
        <p className='text-sm text-muted-foreground'>MVP settings and integration placeholders.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization defaults</CardTitle>
          <CardDescription>Basic settings stored client-side for MVP review.</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Label>Default onboarding target (days)</Label>
            <Input defaultValue='45' />
          </div>
          <div className='space-y-2'>
            <Label>Escalation email alias</Label>
            <Input defaultValue='onboarding-ops@example.com' />
          </div>
          <div className='space-y-2 md:col-span-2'>
            <Label>Notification policy notes</Label>
            <Textarea
              rows={5}
              defaultValue='MVP placeholder. TODO: Connect Slack/Jira/GitHub webhooks and SSO provisioning events.'
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integration roadmap</CardTitle>
          <CardDescription>Planned modules for next increment.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>- Slack workflow notifications (assignment and review events)</p>
          <p>- Jira ticket linking for onboarding tasks and blocker resolution</p>
          <p>- GitHub repo access readiness checks for engineering tracks</p>
          <p>- Enterprise SSO + SCIM user lifecycle sync</p>
        </CardContent>
      </Card>
    </div>
  );
}
