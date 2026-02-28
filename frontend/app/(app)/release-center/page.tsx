"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatPercent } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type ReleaseCenterSummary = {
  assignment_id: string;
  title: string;
  status: string;
  progress_percent: number;
  start_date: string;
  target_date: string;
  blockers_count: number;
  gates_passed: number;
  gates_total: number;
  environment?: string | null;
  version_tag?: string | null;
  rel_id?: string | null;
  links?: Record<string, string>;
};

type ReleaseCenterListResponse = {
  items: ReleaseCenterSummary[];
};

type ReleaseTemplateOption = {
  template_id: string;
  version_id: string;
  title: string;
};

export default function ReleaseCenterPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [items, setItems] = useState<ReleaseCenterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [envFilter, setEnvFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [templates, setTemplates] = useState<ReleaseTemplateOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const createRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasModule('releases') && hasPermission('releases:read');
  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (envFilter) params.set('environment', envFilter);
    if (statusFilter) params.set('status', statusFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [envFilter, statusFilter]);

  const load = async () => {
    if (!accessToken || !canRead) return;
    setLoading(true);
    try {
      const response = await api.get<ReleaseCenterListResponse>(`/release-center${query}`, accessToken);
      setItems(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, query, canRead]);

  useEffect(() => {
    if (!accessToken || !canRead) return;
    const run = async () => {
      const response = await api.get<ReleaseTemplateOption[]>('/release-center/templates', accessToken);
      setTemplates(response);
    };
    void run();
  }, [accessToken, canRead]);

  if (!canRead) {
    return <EmptyState title='Access denied' description='You do not have access to Release Center.' />;
  }
  if (loading) return <LoadingState label='Loading releases...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Release Center</h2>
          <p className='text-sm text-muted-foreground'>Track release progress, blockers, and gates.</p>
        </div>
        {canWrite && (
          <Button
            type='button'
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              setStartDate(today);
              setTargetDate(today);
              setShowCreate(true);
              setTimeout(() => createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
            }}
          >
            New release plan
          </Button>
        )}
      </div>

      {canWrite && showCreate && (
        <div ref={createRef}>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Create release plan</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2 md:col-span-2'>
                <label className='text-xs text-muted-foreground'>Release template</label>
                <select
                  className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                  value={selectedVersionId}
                  onChange={(event) => setSelectedVersionId(event.target.value)}
                >
                  <option value=''>Select template</option>
                  {templates.map((template) => (
                    <option key={template.version_id} value={template.version_id}>
                      {template.title}
                    </option>
                  ))}
                </select>
                {templates.length === 0 && (
                  <p className='text-xs text-muted-foreground'>
                  No published release templates found yet. Create one in <span className='font-medium'>Tracks</span>{' '}
                  (set Track type to <span className='font-medium'>RELEASE</span> and publish), or seed with{' '}
                  <code className='rounded bg-muted px-1 py-0.5'>database/sql/040_seed_release_templates.sql</code>.
                  </p>
                )}
              </div>
              <div className='space-y-2'>
                <label className='text-xs text-muted-foreground'>Start date</label>
                <Input type='date' value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className='space-y-2'>
                <label className='text-xs text-muted-foreground'>Target date</label>
                <Input type='date' value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </div>
              <div className='flex items-center justify-end md:col-span-3'>
                <Button
                  type='button'
                  disabled={!selectedVersionId || !startDate || !targetDate || creating}
                  onClick={async () => {
                    if (!accessToken) return;
                    setCreating(true);
                    try {
                      await api.post(
                        '/release-center/from-template',
                        {
                          track_version_id: selectedVersionId,
                          start_date: startDate,
                          target_date: targetDate,
                          metadata: { environment: envFilter || 'prod' },
                        },
                        accessToken,
                      );
                      await load();
                      setShowCreate(false);
                    } finally {
                      setCreating(false);
                    }
                  }}
                >
                  {creating ? 'Creating…' : 'Create plan'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={envFilter}
          onChange={(event) => setEnvFilter(event.target.value)}
          placeholder='Filter env (prod/staging)'
          className='max-w-[180px]'
        />
        <Input
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          placeholder='Filter status'
          className='max-w-[180px]'
        />
        <Button type='button' variant='outline' onClick={load}>
          Apply
        </Button>
        <Button
          type='button'
          variant='ghost'
          onClick={() => {
            setEnvFilter('');
            setStatusFilter('');
          }}
        >
          Reset
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title='No releases' description='Create a release plan from a template to get started.' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Active releases</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='grid grid-cols-[minmax(220px,2fr)_90px_110px_110px_90px_90px_110px_140px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground'>
              <div>Release</div>
              <div>Env</div>
              <div>Target</div>
              <div>Version</div>
              <div>%</div>
              <div>Blockers</div>
              <div>Gates</div>
              <div>Links</div>
            </div>
            {items.map((item) => (
              <Link
                key={item.assignment_id}
                href={`/release-center/${item.assignment_id}`}
                className={cn(
                  'grid grid-cols-[minmax(220px,2fr)_90px_110px_110px_90px_90px_110px_140px] items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:border-primary/40',
                )}
              >
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{item.title}</p>
                  <div className='mt-1 flex items-center gap-2 text-xs text-muted-foreground'>
                    <StatusChip status={item.status} />
                    <span>{item.start_date} → {item.target_date}</span>
                  </div>
                </div>
                <div className='text-xs'>{item.environment || '—'}</div>
                <div className='text-xs'>{item.target_date}</div>
                <div className='text-xs'>{item.version_tag || '—'}</div>
                <div className='flex items-center gap-2'>
                  <Progress value={item.progress_percent} className='h-2 flex-1' />
                  <span className='w-10 text-right text-xs tabular-nums text-muted-foreground'>
                    {formatPercent(item.progress_percent)}
                  </span>
                </div>
                <div className='text-xs tabular-nums'>{item.blockers_count}</div>
                <div className='text-xs tabular-nums'>
                  {item.gates_passed}/{item.gates_total}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {item.links?.runbook ? 'Runbook' : '—'}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
