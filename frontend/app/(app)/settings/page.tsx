'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { Plus, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { items, addPurpose, removePurpose, updateLabel, resetItems } = useTrackPurposeLabels();
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (!isLoading && !tenantLoading && !(hasModule('settings') && hasPermission('settings:manage'))) {
      router.replace('/dashboard');
    }
  }, [hasModule, hasPermission, isLoading, router, tenantLoading]);

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
          <CardTitle>Track purpose labels</CardTitle>
          <CardDescription>
            Add or remove purpose options shown in track forms. Value (slug) is stored; label is displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='space-y-2'>
            {items.map((item) => (
              <div
                key={item.value}
                className='flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'
              >
                <div className='min-w-0 flex-1 space-y-1 sm:flex sm:flex-1 sm:items-center sm:gap-2'>
                  <span className='text-xs font-medium text-muted-foreground'>{item.value}</span>
                  <Input
                    className='h-8 flex-1 text-sm'
                    value={item.label}
                    onChange={(e) => updateLabel(item.value, e.target.value)}
                    placeholder='Label'
                  />
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive'
                  onClick={() => removePurpose(item.value)}
                  disabled={items.length <= 1}
                  aria-label={`Remove ${item.label}`}
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='flex flex-1 items-center gap-2'>
              <Input
                placeholder='New label…'
                className='h-8 max-w-[200px] text-sm'
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newLabel.trim()) addPurpose(newLabel.trim());
                    setNewLabel('');
                  }
                }}
              />
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  if (newLabel.trim()) addPurpose(newLabel.trim());
                  setNewLabel('');
                }}
                disabled={!newLabel.trim()}
              >
                <Plus className='mr-1.5 h-4 w-4' />
                Add
              </Button>
            </div>
            <Button type='button' variant='ghost' size='sm' onClick={resetItems}>
              Reset defaults
            </Button>
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
