'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import { useTrackTypeLabels } from '@/lib/track-type';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { Plus, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading, accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { items, addPurpose, removePurpose, updateLabel, updateValue, resetItems } = useTrackPurposeLabels();
  const {
    items: typeItems,
    addType,
    removeType,
    updateLabel: updateTypeLabel,
    updateValue: updateTypeValue,
    resetItems: resetTypeItems,
  } = useTrackTypeLabels();
  const [newLabel, setNewLabel] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [defaultTargetDays, setDefaultTargetDays] = useState<number | ''>(45);
  const [escalationEmail, setEscalationEmail] = useState('onboarding-ops@example.com');
  const [policyNotes, setPolicyNotes] = useState(
    'MVP placeholder. TODO: Connect Slack/Jira/GitHub webhooks and SSO provisioning events.',
  );
  const [woGitEnabled, setWoGitEnabled] = useState(false);
  const [woGitRepo, setWoGitRepo] = useState('');
  const [woGitFolder, setWoGitFolder] = useState('work-orders');
  const [woGitReleaseFolder, setWoGitReleaseFolder] = useState('releases');
  const [woGitBaseBranch, setWoGitBaseBranch] = useState('');
  const [woGitInstallationId, setWoGitInstallationId] = useState('');
  const [woGitSyncOnSave, setWoGitSyncOnSave] = useState(true);
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
        work_orders_github?: {
          enabled?: boolean;
          repo_full_name?: string | null;
          folder_path?: string | null;
          release_manifests_folder_path?: string | null;
          base_branch?: string | null;
          installation_id?: number | null;
          sync_on_save?: boolean;
        };
      }>('/settings', accessToken)
      .then((data) => {
        if (!isMounted) return;
        setDefaultTargetDays(data.default_onboarding_target_days);
        setEscalationEmail(data.escalation_email ?? '');
        setPolicyNotes(data.notification_policy_notes ?? '');
        const wo = data.work_orders_github || {};
        setWoGitEnabled(Boolean(wo.enabled));
        setWoGitRepo(wo.repo_full_name ?? '');
        setWoGitFolder(wo.folder_path ?? 'work-orders');
        setWoGitReleaseFolder(wo.release_manifests_folder_path ?? 'releases');
        setWoGitBaseBranch(wo.base_branch ?? '');
        setWoGitInstallationId(wo.installation_id ? String(wo.installation_id) : '');
        setWoGitSyncOnSave(wo.sync_on_save !== false);
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
          work_orders_github: {
            enabled: woGitEnabled,
            repo_full_name: woGitRepo.trim() || null,
            folder_path: woGitFolder.trim() || 'work-orders',
            release_manifests_folder_path: woGitReleaseFolder.trim() || 'releases',
            base_branch: woGitBaseBranch.trim() || null,
            installation_id: woGitInstallationId.trim() ? Number(woGitInstallationId.trim()) : null,
            sync_on_save: woGitSyncOnSave,
          },
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
        <p className='text-sm text-muted-foreground'>Tenant-level configuration.</p>
      </div>

      <Card className='overflow-hidden'>
        <CardContent className='p-0'>
          <Accordion type='multiple' defaultValue={['org-defaults', 'wo-github', 'track-purposes']}>
            <AccordionItem value='org-defaults' className='border-b px-4'>
              <AccordionTrigger className='py-3'>Organization defaults</AccordionTrigger>
              <AccordionContent className='pb-4'>
                <div className='grid gap-4 md:grid-cols-2'>
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
                    <Textarea rows={4} value={policyNotes} onChange={(e) => setPolicyNotes(e.target.value)} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value='wo-github' className='border-b px-4'>
              <AccordionTrigger className='py-3'>Work Orders GitHub</AccordionTrigger>
              <AccordionContent className='pb-4'>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='flex items-center gap-2'>
                    <input
                      id='wo-git-enabled'
                      type='checkbox'
                      checked={woGitEnabled}
                      onChange={(e) => setWoGitEnabled(e.target.checked)}
                    />
                    <Label htmlFor='wo-git-enabled'>Enable GitHub sync</Label>
                  </div>
                  <div className='flex items-center gap-2'>
                    <input
                      id='wo-git-sync'
                      type='checkbox'
                      checked={woGitSyncOnSave}
                      onChange={(e) => setWoGitSyncOnSave(e.target.checked)}
                    />
                    <Label htmlFor='wo-git-sync'>Commit on Save</Label>
                  </div>
                  <div className='space-y-2'>
                    <Label>Repo (owner/name)</Label>
                    <Input value={woGitRepo} onChange={(e) => setWoGitRepo(e.target.value)} placeholder='org/repo' />
                  </div>
                  <div className='space-y-2'>
                    <Label>Folder path</Label>
                    <Input
                      value={woGitFolder}
                      onChange={(e) => setWoGitFolder(e.target.value)}
                      placeholder='work-orders'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Release manifests folder</Label>
                    <Input
                      value={woGitReleaseFolder}
                      onChange={(e) => setWoGitReleaseFolder(e.target.value)}
                      placeholder='releases'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Base branch</Label>
                    <Input
                      value={woGitBaseBranch}
                      onChange={(e) => setWoGitBaseBranch(e.target.value)}
                      placeholder='main'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>GitHub App installation id</Label>
                    <Input
                      inputMode='numeric'
                      value={woGitInstallationId}
                      onChange={(e) => setWoGitInstallationId(e.target.value)}
                      placeholder='12345678'
                    />
                  </div>
                  <p className='text-xs text-muted-foreground md:col-span-2'>
                    Note: Backend must be configured with GitHub App credentials (GITHUB_APP_ID + private key).
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value='track-purposes' className='px-4'>
              <AccordionTrigger className='py-3'>Track purpose labels</AccordionTrigger>
              <AccordionContent className='pb-4'>
                <div className='space-y-3'>
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
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value='track-types' className='px-4'>
              <AccordionTrigger className='py-3'>Track type labels</AccordionTrigger>
              <AccordionContent className='pb-4'>
                <p className='mb-3 text-xs text-muted-foreground'>
                  Manage the options available in the <span className='font-medium'>Track type</span> dropdown when
                  editing a track. The <span className='font-medium'>value</span> is stored in the database; the{' '}
                  <span className='font-medium'>label</span> is what users see.
                </p>
                <div className='space-y-3'>
                  <div className='space-y-2'>
                    {typeItems.map((item) => (
                      <div
                        key={item.value}
                        className='flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'
                      >
                        <div className='min-w-0 flex-1 space-y-1 sm:flex sm:flex-1 sm:items-center sm:gap-2'>
                          <Input
                            className='h-8 w-[160px] font-mono text-xs font-medium'
                            value={item.value}
                            onChange={(e) => updateTypeValue(item.value, e.target.value)}
                            placeholder='VALUE_KEY'
                          />
                          <Input
                            className='h-8 flex-1 text-sm'
                            value={item.label}
                            onChange={(e) => updateTypeLabel(item.value, e.target.value)}
                            placeholder='Display label'
                          />
                        </div>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive'
                          onClick={() => removeType(item.value)}
                          disabled={typeItems.length <= 1}
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
                        placeholder='New type label…'
                        className='h-8 max-w-[200px] text-sm'
                        value={newTypeLabel}
                        onChange={(e) => setNewTypeLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newTypeLabel.trim()) addType(newTypeLabel.trim());
                            setNewTypeLabel('');
                          }
                        }}
                      />
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          if (newTypeLabel.trim()) addType(newTypeLabel.trim());
                          setNewTypeLabel('');
                        }}
                        disabled={!newTypeLabel.trim()}
                      >
                        <Plus className='mr-1.5 h-4 w-4' />
                        Add
                      </Button>
                    </div>
                    <Button type='button' variant='ghost' size='sm' onClick={resetTypeItems}>
                      Reset defaults
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className='flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3'>
            <div className='min-h-[20px] text-sm'>
              {loadError && <span className='text-destructive'>{loadError}</span>}
              {!loadError && saveError && <span className='text-destructive'>{saveError}</span>}
            </div>
            <Button type='button' onClick={saveSettings} disabled={saving || defaultTargetDays === ''}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
