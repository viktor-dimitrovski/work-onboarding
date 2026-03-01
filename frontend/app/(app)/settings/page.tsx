'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { Plus, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading, accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { items, addPurpose, removePurpose, updateLabel, updateValue, resetItems } = useTrackPurposeLabels();
  const [newLabel, setNewLabel] = useState('');
  const [defaultTargetDays, setDefaultTargetDays] = useState<number | ''>(45);
  const [escalationEmail, setEscalationEmail] = useState('onboarding-ops@example.com');
  const [policyNotes, setPolicyNotes] = useState(
    'MVP placeholder. TODO: Connect Slack/Jira/GitHub webhooks and SSO provisioning events.',
  );
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !tenantLoading && !(hasModule('settings') && hasPermission('settings:manage'))) {
      router.replace('/dashboard');
    }
  }, [hasModule, hasPermission, isLoading, router, tenantLoading]);

  useEffect(() => {
    if (!accessToken) return;
    let isMounted = true;
    setLoadError(null);
    api
      .get<{
        default_onboarding_target_days: number;
        escalation_email?: string | null;
        notification_policy_notes?: string | null;
      }>('/settings', accessToken)
      .then((data) => {
        if (!isMounted) return;
        setDefaultTargetDays(data.default_onboarding_target_days);
        setEscalationEmail(data.escalation_email ?? '');
        setPolicyNotes(data.notification_policy_notes ?? '');
      })
      .catch((err) => {
        if (!isMounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
      });
    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  const saveSettings = async () => {
    if (!accessToken) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(
        '/settings',
        {
          default_onboarding_target_days: defaultTargetDays === '' ? null : Number(defaultTargetDays),
          escalation_email: escalationEmail.trim() || null,
          notification_policy_notes: policyNotes.trim() || null,
        },
        accessToken,
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Settings</h2>
        <p className='text-sm text-muted-foreground'>MVP settings and integration placeholders.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization defaults</CardTitle>
          <CardDescription>Default values applied to new onboarding assignments and alerts.</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Label>Default onboarding target (days)</Label>
            <Input
              type='number'
              min={1}
              value={defaultTargetDays}
              onChange={(e) => setDefaultTargetDays(e.target.value ? Number(e.target.value) : '')}
            />
          </div>
          <div className='space-y-2'>
            <Label>Escalation email alias</Label>
            <Input value={escalationEmail} onChange={(e) => setEscalationEmail(e.target.value)} />
          </div>
          <div className='space-y-2 md:col-span-2'>
            <Label>Notification policy notes</Label>
            <Textarea rows={5} value={policyNotes} onChange={(e) => setPolicyNotes(e.target.value)} />
          </div>
          {loadError && <p className='text-sm text-destructive md:col-span-2'>{loadError}</p>}
          {saveError && <p className='text-sm text-destructive md:col-span-2'>{saveError}</p>}
        </CardContent>
        <CardFooter className='justify-end'>
          <Button type='button' onClick={saveSettings} disabled={saving || defaultTargetDays === ''}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Track purpose labels</CardTitle>
          <CardDescription>
            These options power the “Purpose” dropdowns. They’re stored per-tenant in Settings (and cached locally).
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
                  <Input
                    className='h-8 w-[160px] text-xs font-medium'
                    value={item.value}
                    onChange={(e) => updateValue(item.value, e.target.value)}
                    placeholder='value (slug)'
                  />
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
