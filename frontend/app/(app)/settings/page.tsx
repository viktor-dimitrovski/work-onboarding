'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useTrackPurposeLabels } from '@/lib/track-purpose';
import { useTrackTypeLabels } from '@/lib/track-type';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { DataCentersSettingsSection } from '@/components/release-notes/data-centers-settings-section';
import { ReleaseNotificationsSettings } from '@/components/settings/release-notifications-settings';
import {
  Bot,
  Building2,
  Check,
  GitBranch,
  Layers,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type AiTemplate = {
  id: string;
  name: string;
  context_placeholder: string | null;
  extra_instructions: string;
  auto_question_count: boolean;
  sort_order: number;
};

// ── Section metadata (for search) ─────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'org-defaults',
    title: 'Organization defaults',
    description: 'Onboarding target days, escalation email, notification policy',
    keywords: ['onboarding', 'target', 'days', 'escalation', 'email', 'notification', 'policy'],
    icon: Building2,
    accent: 'bg-blue-500',
  },
  {
    id: 'wo-github',
    title: 'Work Orders GitHub',
    description: 'GitHub App sync, repo, folder paths, base branch',
    keywords: ['github', 'git', 'repo', 'branch', 'sync', 'work', 'orders', 'installation', 'folder'],
    icon: GitBranch,
    accent: 'bg-slate-500',
  },
  {
    id: 'track-purposes',
    title: 'Track purpose labels',
    description: 'Customize purpose options shown in track forms',
    keywords: ['track', 'purpose', 'label', 'option'],
    icon: Tag,
    accent: 'bg-emerald-500',
  },
  {
    id: 'track-types',
    title: 'Track type labels',
    description: 'Customize track type options and display values',
    keywords: ['track', 'type', 'label', 'value', 'key'],
    icon: Layers,
    accent: 'bg-violet-500',
  },
  {
    id: 'ai-import-templates',
    title: 'AI Import Templates',
    description: 'Reusable AI instruction presets for question import',
    keywords: ['ai', 'import', 'template', 'instruction', 'question', 'prompt', 'pdf'],
    icon: Bot,
    accent: 'bg-indigo-500',
  },
  {
    id: 'data-centers',
    title: 'Data Centers',
    description: 'Kubernetes cluster locations for release deployments',
    keywords: ['data center', 'dc', 'k8s', 'kubernetes', 'cluster', 'release', 'deployment', 'location'],
    icon: Server,
    accent: 'bg-teal-500',
  },
  {
    id: 'release-notifications',
    title: 'Release Notifications',
    description: 'Email recipients for blocked deployment run items',
    keywords: ['release', 'notification', 'email', 'blocked', 'deployment', 'alert'],
    icon: Settings,
    accent: 'bg-orange-500',
  },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// ── Shared field wrapper ───────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <Label className='text-xs font-medium text-muted-foreground'>{label}</Label>
      {children}
    </div>
  );
}

function SectionTrigger({
  icon: Icon,
  accent,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  title: string;
  description: string;
}) {
  return (
    <div className='flex min-w-0 flex-1 items-center gap-3 py-0.5'>
      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', accent)}>
        <Icon className='h-3.5 w-3.5 text-white' />
      </div>
      <div className='min-w-0 text-left'>
        <p className='text-sm font-medium'>{title}</p>
        <p className='hidden truncate text-xs text-muted-foreground sm:block'>{description}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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

  // Form state
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
  const [woGitPatConfigured, setWoGitPatConfigured] = useState(false);
  const [woGitPatInput, setWoGitPatInput] = useState('');
  const [woGitPatMode, setWoGitPatMode] = useState<'idle' | 'entering' | 'saving' | 'removing'>('idle');
  const [woGitPatError, setWoGitPatError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI Import Templates
  const [aiTemplates, setAiTemplates] = useState<AiTemplate[]>([]);
  const [aiTemplatesLoading, setAiTemplatesLoading] = useState(false);
  const [aiTemplatesError, setAiTemplatesError] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<AiTemplate>>({});
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateForm, setNewTemplateForm] = useState<Partial<AiTemplate>>({
    name: '', context_placeholder: '', extra_instructions: '', auto_question_count: false, sort_order: 0,
  });

  // Search + open state
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<SectionId[]>([]);

  // Compute which sections match the search query
  const matchingSectionIds = useMemo<SectionId[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.includes(q)),
    ).map((s) => s.id);
  }, [search]);

  // Open matching sections when search changes; close all when search is cleared
  useEffect(() => {
    if (search.trim()) {
      setOpenSections(matchingSectionIds);
    } else {
      setOpenSections([]);
    }
  }, [search, matchingSectionIds]);

  // Access guard
  useEffect(() => {
    if (!isLoading && !tenantLoading && !(hasModule('settings') && hasPermission('settings:manage'))) {
      router.replace('/dashboard');
    }
  }, [hasModule, hasPermission, isLoading, router, tenantLoading]);

  // Load settings
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
          pat_configured?: boolean;
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
        setWoGitPatConfigured(Boolean(wo.pat_configured));
      })
      .catch((err) => {
        if (!isMounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
      });
    return () => { isMounted = false; };
  }, [accessToken]);

  const loadAiTemplates = useCallback(async () => {
    if (!accessToken) return;
    setAiTemplatesLoading(true);
    setAiTemplatesError(null);
    try {
      const data = await api.get<AiTemplate[]>('/assessments/ai-import-templates', accessToken);
      setAiTemplates(data);
    } catch (err) {
      setAiTemplatesError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setAiTemplatesLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { loadAiTemplates(); }, [loadAiTemplates]);

  const saveAiTemplate = async (id: string) => {
    if (!accessToken) return;
    try {
      await api.put(`/assessments/ai-import-templates/${id}`, editForm, accessToken);
      setEditingTemplateId(null);
      await loadAiTemplates();
    } catch (err) {
      setAiTemplatesError(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const createAiTemplate = async () => {
    if (!accessToken || !newTemplateForm.name?.trim() || !newTemplateForm.extra_instructions?.trim()) return;
    try {
      await api.post('/assessments/ai-import-templates', {
        name: newTemplateForm.name.trim(),
        context_placeholder: newTemplateForm.context_placeholder?.trim() || null,
        extra_instructions: newTemplateForm.extra_instructions.trim(),
        auto_question_count: newTemplateForm.auto_question_count ?? false,
        sort_order: newTemplateForm.sort_order ?? 0,
      }, accessToken);
      setAddingTemplate(false);
      setNewTemplateForm({ name: '', context_placeholder: '', extra_instructions: '', auto_question_count: false, sort_order: 0 });
      await loadAiTemplates();
    } catch (err) {
      setAiTemplatesError(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  const deleteAiTemplate = async (id: string) => {
    if (!accessToken) return;
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
      const resp = await fetch(`${apiBase}/assessments/ai-import-templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
      await loadAiTemplates();
    } catch (err) {
      setAiTemplatesError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

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

  const extractApiError = (err: unknown, fallback: string): string => {
    if (!(err instanceof Error)) return fallback;
    try {
      const parsed = JSON.parse(err.message);
      if (parsed?.detail) return String(parsed.detail);
    } catch {
      // not JSON — use raw message
    }
    return err.message || fallback;
  };

  const savePat = async () => {
    if (!accessToken || !woGitPatInput.trim()) return;
    setWoGitPatMode('saving');
    setWoGitPatError(null);
    try {
      await api.put('/settings/github-pat', { github_pat: woGitPatInput.trim() }, accessToken);
      setWoGitPatConfigured(true);
      setWoGitPatInput('');
      setWoGitPatMode('idle');
    } catch (err) {
      setWoGitPatError(extractApiError(err, 'Failed to save token'));
      setWoGitPatMode('entering');
    }
  };

  const removePat = async () => {
    if (!accessToken) return;
    setWoGitPatMode('removing');
    setWoGitPatError(null);
    try {
      await api.delete('/settings/github-pat', accessToken);
      setWoGitPatConfigured(false);
      setWoGitPatMode('idle');
    } catch (err) {
      setWoGitPatError(extractApiError(err, 'Failed to remove token'));
      setWoGitPatMode('idle');
    }
  };

  const visibleSections = useMemo<SectionId[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS.map((s) => s.id);
    return matchingSectionIds;
  }, [search, matchingSectionIds]);

  return (
    <div className='mx-auto max-w-3xl space-y-4 pb-24'>

      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10'>
          <Settings className='h-4.5 w-4.5 text-primary' />
        </div>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Settings</h1>
          <p className='text-xs text-muted-foreground'>Tenant-level configuration</p>
        </div>
      </div>

      {/* Search */}
      <div className='relative'>
        <Search className='absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
        <Input
          placeholder='Search settings…'
          className='h-9 pl-9 text-sm'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type='button'
            className='absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground'
            onClick={() => setSearch('')}
          >
            <X className='h-3.5 w-3.5' />
          </button>
        )}
      </div>

      {/* No results */}
      {search.trim() && visibleSections.length === 0 && (
        <p className='py-6 text-center text-sm text-muted-foreground'>No settings found for &ldquo;{search}&rdquo;</p>
      )}

      {/* Accordion */}
      <div className='overflow-hidden rounded-xl border bg-white shadow-sm'>
        <Accordion
          type='multiple'
          value={openSections}
          onValueChange={(v) => setOpenSections(v as SectionId[])}
          id='settings-accordion'
        >
          {/* ── Organization defaults ── */}
          {visibleSections.includes('org-defaults') && (
            <AccordionItem value='org-defaults' className='border-b last:border-0'>
              <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                <SectionTrigger
                  icon={Building2}
                  accent='bg-blue-500'
                  title='Organization defaults'
                  description='Onboarding target days, escalation email, notification policy'
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className='grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2'>
                  <Field label='Default onboarding target (days)'>
                    <Input
                      type='number'
                      min={1}
                      className='h-8 text-sm'
                      value={defaultTargetDays}
                      onChange={(e) => setDefaultTargetDays(e.target.value ? Number(e.target.value) : '')}
                    />
                  </Field>
                  <Field label='Escalation email alias'>
                    <Input
                      className='h-8 text-sm'
                      value={escalationEmail}
                      onChange={(e) => setEscalationEmail(e.target.value)}
                    />
                  </Field>
                  <div className='space-y-1.5 sm:col-span-2'>
                    <Label className='text-xs font-medium text-muted-foreground'>Notification policy notes</Label>
                    <Textarea
                      rows={3}
                      className='text-sm'
                      value={policyNotes}
                      onChange={(e) => setPolicyNotes(e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ── Work Orders GitHub ── */}
          {visibleSections.includes('wo-github') && (
            <AccordionItem value='wo-github' className='border-b last:border-0'>
              <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                <SectionTrigger
                  icon={GitBranch}
                  accent='bg-slate-500'
                  title='Work Orders GitHub'
                  description='GitHub App sync, repo, folder paths, base branch'
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className='grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2'>
                  <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2'>
                    <input
                      id='wo-git-enabled'
                      type='checkbox'
                      className='h-3.5 w-3.5'
                      checked={woGitEnabled}
                      onChange={(e) => setWoGitEnabled(e.target.checked)}
                    />
                    <Label htmlFor='wo-git-enabled' className='cursor-pointer text-sm'>Enable GitHub sync</Label>
                    <span className='mx-3 h-4 w-px bg-border' />
                    <input
                      id='wo-git-sync'
                      type='checkbox'
                      className='h-3.5 w-3.5'
                      checked={woGitSyncOnSave}
                      onChange={(e) => setWoGitSyncOnSave(e.target.checked)}
                    />
                    <Label htmlFor='wo-git-sync' className='cursor-pointer text-sm'>Commit on save</Label>
                  </div>
                  <Field label='Repo (owner/name)'>
                    <Input className='h-8 text-sm' value={woGitRepo} onChange={(e) => setWoGitRepo(e.target.value)} placeholder='org/repo' />
                  </Field>
                  <Field label='Base branch'>
                    <Input className='h-8 text-sm' value={woGitBaseBranch} onChange={(e) => setWoGitBaseBranch(e.target.value)} placeholder='main' />
                  </Field>
                  <Field label='Folder path'>
                    <Input className='h-8 text-sm' value={woGitFolder} onChange={(e) => setWoGitFolder(e.target.value)} placeholder='work-orders' />
                  </Field>
                  <Field label='Release manifests folder'>
                    <Input className='h-8 text-sm' value={woGitReleaseFolder} onChange={(e) => setWoGitReleaseFolder(e.target.value)} placeholder='releases' />
                  </Field>

                  {/* ── GitHub Personal Access Token (write-only) ── */}
                  <div className='sm:col-span-2 rounded-lg border border-dashed p-3 space-y-2'>
                    <div className='flex items-center justify-between'>
                      <Label className='text-xs font-semibold'>GitHub Personal Access Token</Label>
                      {woGitPatConfigured && woGitPatMode === 'idle' && (
                        <span className='inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-700'>
                          <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' />
                          Configured
                        </span>
                      )}
                    </div>
                    <p className='text-[11px] text-muted-foreground leading-relaxed'>
                      Create a <strong>Fine-grained PAT</strong> in your GitHub org with <em>Contents: Read &amp; Write</em> and{' '}
                      <em>Pull requests: Read &amp; Write</em> permissions. The token is stored encrypted and is never shown again.
                    </p>

                    {woGitPatConfigured && woGitPatMode !== 'entering' && woGitPatMode !== 'saving' ? (
                      <div className='flex items-center gap-2'>
                        <Button
                          type='button' variant='outline' size='sm' className='h-7 text-xs'
                          onClick={() => setWoGitPatMode('entering')}
                        >
                          Replace token
                        </Button>
                        <Button
                          type='button' variant='ghost' size='sm'
                          className='h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10'
                          onClick={removePat}
                          disabled={woGitPatMode === 'removing'}
                        >
                          {woGitPatMode === 'removing' ? 'Removing…' : 'Remove'}
                        </Button>
                      </div>
                    ) : (
                      <div className='flex items-start gap-2'>
                        <Input
                          type='password'
                          className='h-8 text-sm font-mono flex-1'
                          placeholder='github_pat_…'
                          value={woGitPatInput}
                          onChange={(e) => { setWoGitPatInput(e.target.value); setWoGitPatMode('entering'); }}
                          autoComplete='off'
                          spellCheck={false}
                        />
                        <Button
                          type='button' size='sm' className='h-8 text-xs shrink-0'
                          onClick={savePat}
                          disabled={!woGitPatInput.trim() || woGitPatMode === 'saving'}
                        >
                          {woGitPatMode === 'saving' ? 'Saving…' : 'Save token'}
                        </Button>
                        {woGitPatConfigured && (
                          <Button
                            type='button' variant='ghost' size='sm' className='h-8 text-xs shrink-0'
                            onClick={() => { setWoGitPatMode('idle'); setWoGitPatInput(''); setWoGitPatError(null); }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                    {woGitPatError && (
                      <p className='text-xs text-destructive'>{woGitPatError}</p>
                    )}
                  </div>

                  <p className='text-xs text-muted-foreground sm:col-span-2'>
                    <strong>Advanced:</strong> If your platform administrator has configured a global GitHub App, you can also use the Installation ID below instead of a PAT.
                  </p>
                  <Field label='GitHub App installation ID (optional)'>
                    <Input className='h-8 text-sm' inputMode='numeric' value={woGitInstallationId} onChange={(e) => setWoGitInstallationId(e.target.value)} placeholder='12345678' />
                  </Field>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ── Track purpose labels ── */}
          {visibleSections.includes('track-purposes') && (
            <AccordionItem value='track-purposes' className='border-b last:border-0'>
              <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                <SectionTrigger
                  icon={Tag}
                  accent='bg-emerald-500'
                  title='Track purpose labels'
                  description='Customize purpose options shown in track forms'
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className='space-y-2 px-4 pb-4 pt-1'>
                  {items.map((item) => (
                    <div key={item.value} className='flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5'>
                      <Input
                        className='h-7 w-[130px] shrink-0 font-mono text-xs'
                        value={item.value}
                        onChange={(e) => updateValue(item.value, e.target.value)}
                        placeholder='value'
                      />
                      <Input
                        className='h-7 min-w-0 flex-1 text-xs'
                        value={item.label}
                        onChange={(e) => updateLabel(item.value, e.target.value)}
                        placeholder='Display label'
                      />
                      <Button
                        type='button' variant='ghost' size='icon'
                        className='h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive'
                        onClick={() => removePurpose(item.value)}
                        disabled={items.length <= 1}
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                  <div className='flex flex-wrap items-center gap-2 pt-1'>
                    <Input
                      placeholder='New label…'
                      className='h-7 max-w-[180px] text-xs'
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); if (newLabel.trim()) { addPurpose(newLabel.trim()); setNewLabel(''); } }
                      }}
                    />
                    <Button type='button' variant='outline' size='sm' className='h-7 text-xs'
                      onClick={() => { if (newLabel.trim()) { addPurpose(newLabel.trim()); setNewLabel(''); } }}
                      disabled={!newLabel.trim()}
                    >
                      <Plus className='mr-1 h-3 w-3' /> Add
                    </Button>
                    <Button type='button' variant='ghost' size='sm' className='h-7 text-xs text-muted-foreground' onClick={resetItems}>
                      Reset defaults
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ── Track type labels ── */}
          {visibleSections.includes('track-types') && (
            <AccordionItem value='track-types' className='border-b last:border-0'>
              <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                <SectionTrigger
                  icon={Layers}
                  accent='bg-violet-500'
                  title='Track type labels'
                  description='Customize track type options and display values'
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className='space-y-2 px-4 pb-4 pt-1'>
                  <p className='text-xs text-muted-foreground'>
                    The <span className='font-medium'>value</span> is stored in the database; the{' '}
                    <span className='font-medium'>label</span> is what users see.
                  </p>
                  {typeItems.map((item) => (
                    <div key={item.value} className='flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5'>
                      <Input
                        className='h-7 w-[130px] shrink-0 font-mono text-xs'
                        value={item.value}
                        onChange={(e) => updateTypeValue(item.value, e.target.value)}
                        placeholder='VALUE_KEY'
                      />
                      <Input
                        className='h-7 min-w-0 flex-1 text-xs'
                        value={item.label}
                        onChange={(e) => updateTypeLabel(item.value, e.target.value)}
                        placeholder='Display label'
                      />
                      <Button
                        type='button' variant='ghost' size='icon'
                        className='h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive'
                        onClick={() => removeType(item.value)}
                        disabled={typeItems.length <= 1}
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                  <div className='flex flex-wrap items-center gap-2 pt-1'>
                    <Input
                      placeholder='New type label…'
                      className='h-7 max-w-[180px] text-xs'
                      value={newTypeLabel}
                      onChange={(e) => setNewTypeLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); if (newTypeLabel.trim()) { addType(newTypeLabel.trim()); setNewTypeLabel(''); } }
                      }}
                    />
                    <Button type='button' variant='outline' size='sm' className='h-7 text-xs'
                      onClick={() => { if (newTypeLabel.trim()) { addType(newTypeLabel.trim()); setNewTypeLabel(''); } }}
                      disabled={!newTypeLabel.trim()}
                    >
                      <Plus className='mr-1 h-3 w-3' /> Add
                    </Button>
                    <Button type='button' variant='ghost' size='sm' className='h-7 text-xs text-muted-foreground' onClick={resetTypeItems}>
                      Reset defaults
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* ── AI Import Templates ── */}
          {visibleSections.includes('ai-import-templates') && (
            <AccordionItem value='ai-import-templates' className='border-b last:border-0' id='ai-import-templates'>
              <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                <SectionTrigger
                  icon={Bot}
                  accent='bg-indigo-500'
                  title='AI Import Templates'
                  description='Reusable AI instruction presets for question import'
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className='space-y-2 px-4 pb-4 pt-1'>
                  <p className='text-xs text-muted-foreground'>
                    Templates appear in the <span className='font-medium'>AI Instructions</span> panel inside Import Text and Import PDF forms.
                  </p>

                  {aiTemplatesError && (
                    <p className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'>{aiTemplatesError}</p>
                  )}

                  {aiTemplatesLoading && (
                    <p className='text-xs text-muted-foreground'>Loading…</p>
                  )}

                  {aiTemplates.map((tmpl) =>
                    editingTemplateId === tmpl.id ? (
                      <div key={tmpl.id} className='space-y-2 rounded-md border bg-muted/10 p-3'>
                        <Input className='h-8 text-sm' placeholder='Template name *' value={editForm.name ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                        <Input className='h-8 text-sm' placeholder='Context placeholder hint (optional)' value={editForm.context_placeholder ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, context_placeholder: e.target.value }))} />
                        <Textarea rows={4} className='text-sm' placeholder='AI instructions…' value={editForm.extra_instructions ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, extra_instructions: e.target.value }))} />
                        <label className='flex cursor-pointer items-center gap-2 text-xs'>
                          <input type='checkbox' className='h-3.5 w-3.5'
                            checked={editForm.auto_question_count ?? false}
                            onChange={(e) => setEditForm((f) => ({ ...f, auto_question_count: e.target.checked }))} />
                          Let AI decide question count
                        </label>
                        <div className='flex gap-2'>
                          <Button type='button' size='sm' variant='outline' className='h-7 text-xs'
                            onClick={() => saveAiTemplate(tmpl.id)}
                            disabled={!editForm.name?.trim() || !editForm.extra_instructions?.trim()}>
                            <Check className='mr-1 h-3 w-3' /> Save
                          </Button>
                          <Button type='button' size='sm' variant='ghost' className='h-7 text-xs'
                            onClick={() => { setEditingTemplateId(null); setAiTemplatesError(null); }}>
                            <X className='mr-1 h-3 w-3' /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div key={tmpl.id} className='flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex flex-wrap items-center gap-1.5'>
                            <span className='text-sm font-medium'>{tmpl.name}</span>
                            {tmpl.auto_question_count && (
                              <span className='rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700'>
                                Auto-count
                              </span>
                            )}
                          </div>
                          {tmpl.context_placeholder && (
                            <p className='mt-0.5 truncate text-xs text-muted-foreground'>{tmpl.context_placeholder}</p>
                          )}
                        </div>
                        <div className='flex shrink-0 items-center gap-0.5'>
                          <Button type='button' variant='ghost' size='icon' className='h-7 w-7 text-muted-foreground hover:text-foreground'
                            onClick={() => {
                              setEditingTemplateId(tmpl.id);
                              setEditForm({ name: tmpl.name, context_placeholder: tmpl.context_placeholder ?? '', extra_instructions: tmpl.extra_instructions, auto_question_count: tmpl.auto_question_count, sort_order: tmpl.sort_order });
                              setAiTemplatesError(null);
                            }}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button type='button' variant='ghost' size='icon' className='h-7 w-7 text-muted-foreground hover:text-destructive'
                            onClick={() => deleteAiTemplate(tmpl.id)}>
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      </div>
                    ),
                  )}

                  {addingTemplate ? (
                    <div className='space-y-2 rounded-md border border-dashed bg-muted/10 p-3'>
                      <p className='text-xs font-medium text-muted-foreground'>New template</p>
                      <Input className='h-8 text-sm' placeholder='Template name *' value={newTemplateForm.name ?? ''}
                        onChange={(e) => setNewTemplateForm((f) => ({ ...f, name: e.target.value }))} />
                      <Input className='h-8 text-sm' placeholder='Context placeholder hint (optional)' value={newTemplateForm.context_placeholder ?? ''}
                        onChange={(e) => setNewTemplateForm((f) => ({ ...f, context_placeholder: e.target.value }))} />
                      <Textarea rows={4} className='text-sm' placeholder='AI instructions… *' value={newTemplateForm.extra_instructions ?? ''}
                        onChange={(e) => setNewTemplateForm((f) => ({ ...f, extra_instructions: e.target.value }))} />
                      <label className='flex cursor-pointer items-center gap-2 text-xs'>
                        <input type='checkbox' className='h-3.5 w-3.5'
                          checked={newTemplateForm.auto_question_count ?? false}
                          onChange={(e) => setNewTemplateForm((f) => ({ ...f, auto_question_count: e.target.checked }))} />
                        Let AI decide question count by default
                      </label>
                      <div className='flex gap-2'>
                        <Button type='button' size='sm' variant='outline' className='h-7 text-xs'
                          onClick={createAiTemplate}
                          disabled={!newTemplateForm.name?.trim() || !newTemplateForm.extra_instructions?.trim()}>
                          <Check className='mr-1 h-3 w-3' /> Create
                        </Button>
                        <Button type='button' size='sm' variant='ghost' className='h-7 text-xs'
                          onClick={() => { setAddingTemplate(false); setAiTemplatesError(null); }}>
                          <X className='mr-1 h-3 w-3' /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button type='button' variant='outline' size='sm' className='mt-1 h-7 text-xs'
                      onClick={() => { setAddingTemplate(true); setAiTemplatesError(null); }}>
                      <Plus className='mr-1 h-3 w-3' /> Add template
                    </Button>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Data Centers */}
          <AccordionItem value='data-centers'>
            <AccordionTrigger className='px-4 hover:no-underline'>
              <div className='flex items-center gap-3'>
                <div className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-teal-500'>
                  <Server className='h-4 w-4 text-white' />
                </div>
                <div className='text-left'>
                  <div className='text-sm font-medium'>Data Centers</div>
                  <div className='text-xs text-muted-foreground'>Kubernetes cluster locations for release deployments</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className='px-4 pb-4 pt-0'>
              <DataCentersSettingsSection canWrite={hasPermission('settings:manage')} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='release-notifications'>
            <AccordionTrigger className='px-4 hover:no-underline'>
              <div className='flex items-center gap-3'>
                <div className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-orange-500'>
                  <Settings className='h-4 w-4 text-white' />
                </div>
                <div className='text-left'>
                  <div className='text-sm font-medium'>Release Notifications</div>
                  <div className='text-xs text-muted-foreground'>Email recipients for blocked deployment run items</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className='px-4 pb-4 pt-0'>
              <ReleaseNotificationsSettings />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Sticky save footer */}
      <div className='fixed bottom-0 left-0 right-0 z-30 border-t bg-white/95 backdrop-blur-sm'>
        <div className='mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6'>
          <div className='min-h-[18px] text-xs'>
            {loadError && <span className='text-destructive'>{loadError}</span>}
            {!loadError && saveError && <span className='text-destructive'>{saveError}</span>}
          </div>
          <Button
            type='button'
            size='sm'
            className='h-8 text-sm'
            onClick={saveSettings}
            disabled={saving || defaultTargetDays === ''}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
