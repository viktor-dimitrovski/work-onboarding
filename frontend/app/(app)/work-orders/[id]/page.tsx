"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MarkdownRenderer } from '@/components/common/markdown-renderer';
import { RiskChip } from '@/components/common/risk-chip';
import { StatusChip } from '@/components/common/status-chip';
import { LexicalMarkdownEditor } from '@/components/editor/lexical-markdown-editor';
import { ServicesTouchedGrid, type ServiceTouchedItem } from '@/components/work-orders/services-touched-grid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type WorkOrderOut = {
  wo_id: string;
  path: string;
  sha?: string | null;
  raw_markdown: string;
  parsed: {
    title: string;
    type?: string | null;
    status?: string | null;
    owner?: string | null;
    requested_by?: string | null;
    tenants_impacted?: string[];
    risk?: string | null;
    target_envs?: string[];
    postman_testing_ref?: string | null;
    services_touched: ServiceTouchedItem[];
    body_markdown: string;
  };
  pr_url?: string | null;
  branch?: string | null;
};

function toInlineList(items: string[]) {
  const cleaned = (items || []).map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? `[${cleaned.join(', ')}]` : '[]';
}

function buildMarkdown(input: {
  wo_id?: string;
  title: string;
  type?: string | null;
  status?: string | null;
  owner?: string | null;
  requested_by?: string | null;
  tenants_impacted?: string[];
  risk?: string | null;
  target_envs?: string[];
  postman_testing_ref?: string | null;
  services: ServiceTouchedItem[];
  body: string;
}) {
  const lines: string[] = ['---'];
  if (input.wo_id) lines.push(`id: ${input.wo_id}`);
  lines.push(`title: ${input.title}`);
  if (input.type) lines.push(`type: ${input.type}`);
  if (input.status) lines.push(`status: ${input.status}`);
  if (input.owner) lines.push(`owner: ${input.owner}`);
  if (input.requested_by) lines.push(`requested_by: ${input.requested_by}`);
  if ((input.tenants_impacted || []).length) lines.push(`tenants_impacted: ${toInlineList(input.tenants_impacted || [])}`);
  if (input.risk) lines.push(`risk: ${input.risk}`);
  if ((input.target_envs || []).length) lines.push(`target_envs: ${toInlineList(input.target_envs || [])}`);
  if (input.postman_testing_ref) lines.push(`postman_testing_ref: ${input.postman_testing_ref}`);
  lines.push('');
  lines.push('services_touched:');
  if (input.services.length === 0) {
    lines[lines.length - 1] = 'services_touched: []';
  } else {
    input.services.forEach((item) => {
      lines.push(`  - service_id: ${item.service_id || ''}`);
      lines.push(`    repo: ${item.repo || ''}`);
      if (item.change_type) lines.push(`    change_type: ${item.change_type}`);
      lines.push(`    requires_deploy: ${item.requires_deploy ? 'true' : 'false'}`);
      lines.push(`    requires_db_migration: ${item.requires_db_migration ? 'true' : 'false'}`);
      lines.push(`    requires_config_change: ${item.requires_config_change ? 'true' : 'false'}`);
      const flags = (item.feature_flags || []).filter(Boolean);
      lines.push(`    feature_flags: ${flags.length ? `[${flags.join(', ')}]` : '[]'}`);
      lines.push(`    release_notes_ref: ${item.release_notes_ref || ''}`);
    });
  }
  lines.push('---');
  const trimmed = (input.body || '').trim();
  return trimmed ? `${lines.join('\n')}\n\n${trimmed}\n` : `${lines.join('\n')}\n`;
}

function extractHeadings(markdown: string): string[] {
  const text = markdown || '';
  const headings: string[] = [];
  const lines = text.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = /^##\s+(.+)\s*$/.exec(line);
    if (match?.[1]) headings.push(match[1].trim());
  }
  return headings;
}

function defaultWoId() {
  const year = new Date().getFullYear();
  const suffix = String(Date.now()).slice(-4);
  return `WO-${year}-${suffix}`;
}

const DEFAULT_BODY_TEMPLATE = `## Summary
- 

## Acceptance / checks
- 

## Versions used during testing

| Component | Version |
|---|---|
|  |  |

## Implementation notes
- 

## Dev log (history)
- ${new Date().toISOString().slice(0, 10)}: 

## Risks and mitigations
- Risk:
  - 
- Mitigation:
  - 

## Rollback considerations
- 
`;

const typeOptions = ['project', 'cds', 'hotfix', 'maintenance'] as const;
const statusOptions = ['draft', 'in_progress', 'ready_for_release', 'released', 'cancelled'] as const;
const riskOptions = ['low', 'medium', 'high'] as const;

function ChipsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'>
      {value.map((item) => (
        <span key={item} className='flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
          {item}
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground'
            onClick={() => onChange(value.filter((v) => v !== item))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className='h-6 flex-1 bg-transparent text-xs outline-none'
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.currentTarget.value.trim();
            if (input) {
              onChange([...value, input]);
              event.currentTarget.value = '';
            }
          } else if (event.key === 'Backspace' && event.currentTarget.value === '') {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

export default function WorkOrderEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const overviewRef = useRef<HTMLDivElement | null>(null);
  const servicesRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const [woId, setWoId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('project');
  const [status, setStatus] = useState<string>('draft');
  const [risk, setRisk] = useState<string>('medium');
  const [owner, setOwner] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [tenantsImpacted, setTenantsImpacted] = useState<string[]>([]);
  const [targetEnvs, setTargetEnvs] = useState<string[]>([]);
  const [postmanTestingRef, setPostmanTestingRef] = useState('');
  const [services, setServices] = useState<ServiceTouchedItem[]>([]);
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [sha, setSha] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState('');
  const [tab, setTab] = useState<'preview' | 'diff' | 'pr'>('preview');

  const isNew = id === 'new';

  useEffect(() => {
    if (!accessToken) return;
    if (isNew) {
      setWoId(defaultWoId());
      setTitle('');
      setServices([]);
      setType('project');
      setStatus('draft');
      setRisk('medium');
      setOwner('');
      setRequestedBy('');
      setTenantsImpacted([]);
      setTargetEnvs([]);
      setPostmanTestingRef('');
      setBodyMarkdown(DEFAULT_BODY_TEMPLATE);
      setLoading(false);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const response = await api.get<WorkOrderOut>(`/work-orders/${id}`, accessToken);
        setWoId(response.wo_id);
        setTitle(response.parsed.title);
        setType(response.parsed.type || 'project');
        setStatus(response.parsed.status || 'draft');
        setRisk(response.parsed.risk || 'medium');
        setOwner(response.parsed.owner || '');
        setRequestedBy(response.parsed.requested_by || '');
        setTenantsImpacted(response.parsed.tenants_impacted || []);
        setTargetEnvs(response.parsed.target_envs || []);
        setPostmanTestingRef(response.parsed.postman_testing_ref || '');
        setServices(response.parsed.services_touched);
        setBodyMarkdown(response.parsed.body_markdown);
        setSha(response.sha || null);
        setBranch(response.branch || null);
        setPrUrl(response.pr_url || null);
        setLastSavedMarkdown(response.raw_markdown);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [accessToken, id, isNew]);

  const previewMarkdown = useMemo(
    () =>
      buildMarkdown({
        wo_id: woId,
        title,
        type,
        status,
        owner,
        requested_by: requestedBy,
        tenants_impacted: tenantsImpacted,
        risk,
        target_envs: targetEnvs,
        postman_testing_ref: postmanTestingRef,
        services,
        body: bodyMarkdown,
      }),
    [woId, title, type, status, owner, requestedBy, tenantsImpacted, risk, targetEnvs, postmanTestingRef, services, bodyMarkdown],
  );

  const headings = useMemo(() => extractHeadings(bodyMarkdown), [bodyMarkdown]);

  const jumpTo = (target: React.RefObject<HTMLElement | null>) => {
    target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const jumpToHeadingInPreview = (headingText: string) => {
    setTab('preview');
    setTimeout(() => {
      const root = previewRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll('h2, h3'));
      const match = nodes.find((node) => (node.textContent || '').trim() === headingText.trim());
      match?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const save = async (overrideSha?: string | null) => {
    if (!accessToken || !canWrite) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    const payload = {
      wo_id: woId,
      title,
      type,
      status,
      owner,
      requested_by: requestedBy,
      tenants_impacted: tenantsImpacted,
      risk,
      target_envs: targetEnvs,
      postman_testing_ref: postmanTestingRef,
      services_touched: services,
      body_markdown: bodyMarkdown,
      sha: overrideSha ?? sha ?? undefined,
      branch: branch || undefined,
    };
    try {
      const response = isNew
        ? await api.post<WorkOrderOut>('/work-orders', payload, accessToken)
        : await api.put<WorkOrderOut>(`/work-orders/${woId}`, payload, accessToken);
      setSha(response.sha || null);
      setBranch(response.branch || null);
      setPrUrl(response.pr_url || null);
      setLastSavedMarkdown(response.raw_markdown);
      if (isNew) {
        router.replace(`/work-orders/${response.wo_id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save work order';
      if (message.includes('409') || message.toLowerCase().includes('conflict')) {
        setConflict('This work order was updated remotely. Reload the latest version or force overwrite.');
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const reloadLatest = async () => {
    if (!accessToken || !woId) return;
    try {
      const response = await api.get<WorkOrderOut>(`/work-orders/${woId}?ref=${branch ?? ''}`, accessToken);
      setTitle(response.parsed.title);
      setServices(response.parsed.services_touched);
      setBodyMarkdown(response.parsed.body_markdown);
      setSha(response.sha || null);
      setLastSavedMarkdown(response.raw_markdown);
      setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload latest work order');
    }
  };

  const forceOverwrite = async () => {
    if (!accessToken || !woId) return;
    try {
      const response = await api.get<WorkOrderOut>(`/work-orders/${woId}?ref=${branch ?? ''}`, accessToken);
      const latestSha = response.sha || null;
      setSha(latestSha);
      await save(latestSha);
      setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to force overwrite');
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
      if (event.key === 'F6') {
        event.preventDefault();
        const targets = ['wo-title', 'wo-service-first', 'wo-editor-content', 'wo-preview-tab'];
        const activeId = (document.activeElement as HTMLElement | null)?.id;
        const idx = Math.max(0, targets.indexOf(activeId || ''));
        const nextId = targets[(idx + 1) % targets.length];
        const nextEl = document.getElementById(nextId);
        if (nextEl) nextEl.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  if (loading) return <LoadingState label='Loading work order...' />;
  if (!canWrite && isNew) {
    return <EmptyState title='Access denied' description='You do not have permission to create work orders.' />;
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]'>
      <div className='space-y-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-semibold'>{isNew ? 'New work order' : woId}</h2>
            <div className='mt-2 flex flex-wrap items-center gap-2'>
              <StatusChip status={status} />
              <span className='rounded-md border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground'>{type}</span>
              <RiskChip risk={risk} />
              <span className='text-xs text-muted-foreground'>Ctrl+S to save · / for sections</span>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            {prUrl && (
              <Button variant='outline' asChild>
                <a href={prUrl} target='_blank' rel='noreferrer'>
                  Open PR
                </a>
              </Button>
            )}
            <Button onClick={save} disabled={saving || !canWrite}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {error && <p className='text-sm text-destructive'>{error}</p>}
        {conflict && (
          <Card className='border-amber-200 bg-amber-50/40'>
            <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-amber-900'>
              <span>{conflict}</span>
              <div className='flex gap-2'>
                <Button type='button' variant='outline' onClick={reloadLatest}>
                  Reload latest
                </Button>
                <Button type='button' variant='secondary' onClick={forceOverwrite}>
                  Force overwrite
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div ref={overviewRef}>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Overview</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-3'>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>WO ID</label>
            <Input id='wo-title' value={woId} disabled={!isNew} onChange={(event) => setWoId(event.target.value)} />
          </div>
          <div className='space-y-2 md:col-span-2'>
            <label className='text-xs text-muted-foreground'>Title</label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder='Short WO title' />
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Type</label>
            <select
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Status</label>
            <select
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Risk</label>
            <select
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
              value={risk}
              onChange={(event) => setRisk(event.target.value)}
            >
              {riskOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Owner</label>
            <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder='Team / unit' />
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Requested by</label>
            <Input
              value={requestedBy}
              onChange={(event) => setRequestedBy(event.target.value)}
              placeholder='Client / internal'
            />
          </div>
          <div className='space-y-2 md:col-span-3'>
            <label className='text-xs text-muted-foreground'>Tenants impacted</label>
            <ChipsInput value={tenantsImpacted} onChange={setTenantsImpacted} placeholder='mks, ro, ...' />
          </div>
          <div className='space-y-2 md:col-span-3'>
            <label className='text-xs text-muted-foreground'>Target envs</label>
            <ChipsInput value={targetEnvs} onChange={setTargetEnvs} placeholder='uat-ro, live-ro, ...' />
          </div>
          <div className='space-y-2 md:col-span-3'>
            <label className='text-xs text-muted-foreground'>Postman testing ref</label>
            <Input
              value={postmanTestingRef}
              onChange={(event) => setPostmanTestingRef(event.target.value)}
              placeholder='https://...'
            />
          </div>
            </CardContent>
          </Card>
        </div>

        <div ref={servicesRef}>
          <ServicesTouchedGrid items={services} onChange={setServices} firstInputId='wo-service-first' />
        </div>

        <div ref={contentRef}>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Work order content</CardTitle>
            </CardHeader>
            <CardContent>
              <LexicalMarkdownEditor
                value={bodyMarkdown}
                onChange={setBodyMarkdown}
                contentEditableId='wo-editor-content'
                placeholder='Write the work order here… Use / to insert sections.'
              />
            </CardContent>
          </Card>
        </div>

        <div ref={tabsRef}>
          <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
            <TabsList className='grid w-full max-w-md grid-cols-3'>
              <TabsTrigger value='preview' id='wo-preview-tab'>
                Preview
              </TabsTrigger>
              <TabsTrigger value='diff'>Diff</TabsTrigger>
              <TabsTrigger value='pr'>PR</TabsTrigger>
            </TabsList>
            <TabsContent value='preview'>
              <Card>
                <CardContent className='pt-4'>
                  <div ref={previewRef}>
                    <MarkdownRenderer content={previewMarkdown} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value='diff'>
              <Card>
                <CardContent className='grid gap-4 pt-4 md:grid-cols-2'>
                  <div>
                    <p className='text-xs text-muted-foreground'>Saved</p>
                    <pre className='mt-2 max-h-96 overflow-auto rounded-md border bg-muted/20 p-3 text-xs'>
                      {lastSavedMarkdown || 'No saved version yet.'}
                    </pre>
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground'>Draft</p>
                    <pre className='mt-2 max-h-96 overflow-auto rounded-md border bg-muted/20 p-3 text-xs'>
                      {previewMarkdown}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value='pr'>
              <Card>
                <CardContent className='pt-4 text-sm'>
                  {prUrl ? (
                    <a className='text-primary underline' href={prUrl} target='_blank' rel='noreferrer'>
                      {prUrl}
                    </a>
                  ) : (
                    <p className='text-muted-foreground'>No PR yet. Press Ctrl+S or Save to create one.</p>
                  )}
                  {branch && <p className='mt-2 text-xs text-muted-foreground'>Branch: {branch}</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className='hidden lg:block'>
        <div className='sticky top-20 space-y-3'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>Jump to</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <Button type='button' variant='ghost' className='w-full justify-start' onClick={() => jumpTo(overviewRef)}>
                Overview
              </Button>
              <Button type='button' variant='ghost' className='w-full justify-start' onClick={() => jumpTo(servicesRef)}>
                Services touched
              </Button>
              <Button type='button' variant='ghost' className='w-full justify-start' onClick={() => jumpTo(contentRef)}>
                Content
              </Button>
              <Button type='button' variant='ghost' className='w-full justify-start' onClick={() => jumpTo(tabsRef)}>
                Preview / Diff / PR
              </Button>
            </CardContent>
          </Card>

          {headings.length > 0 && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>Sections</CardTitle>
              </CardHeader>
              <CardContent className='space-y-1'>
                {headings.slice(0, 12).map((heading) => (
                  <Button
                    key={heading}
                    type='button'
                    variant='ghost'
                    className='h-8 w-full justify-start truncate text-xs'
                    onClick={() => jumpToHeadingInPreview(heading)}
                  >
                    {heading}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
