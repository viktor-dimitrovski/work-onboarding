"use client";

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { ControlDrawer } from '@/components/compliance/control-drawer';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type Framework = {
  framework_key: string;
  name: string;
  full_name?: string | null;
  version?: string | null;
  type?: string | null;
  region?: string | null;
};

type SummaryItem = {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  compliance: number | null;
};

type FrameworkSummary = {
  framework: SummaryItem;
  by_domain: SummaryItem[];
};

type ControlListItem = {
  control: {
    control_key: string;
    code: string;
    title: string;
    description: string;
    domain_code: string;
    criticality: string;
    weight: number;
  };
  status?: {
    status_enum: string;
    score: number;
  } | null;
  evidence_count: number;
};

type GapItem = {
  control_key: string;
  code: string;
  title: string;
  criticality: string;
  score: number;
  status_enum: string | null;
};

const formatPercent = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
};

const formatStatus = (status: string) =>
  status
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');

export default function ComplianceFrameworkPage() {
  const params = useParams();
  const router = useRouter();
  const frameworkKey = String(params.frameworkKey || '');
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [framework, setFramework] = useState<Framework | null>(null);
  const [summary, setSummary] = useState<FrameworkSummary | null>(null);
  const [controls, setControls] = useState<ControlListItem[]>([]);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingControls, setLoadingControls] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selectedControlKey, setSelectedControlKey] = useState<string | null>(null);
  const [gapThreshold, setGapThreshold] = useState('0.75');
  const [activeTab, setActiveTab] = useState<'overview' | 'controls' | 'gaps'>('overview');

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule('compliance') && hasPermission('compliance:read'))) {
      router.replace('/dashboard');
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const loadBase = async () => {
    if (!accessToken || !frameworkKey) return;
    setLoading(true);
    setError(null);
    try {
      const [frameworkData, summaryData] = await Promise.all([
        api.get<Framework>(`/compliance/frameworks/${frameworkKey}`, accessToken),
        api.get<FrameworkSummary>(`/compliance/frameworks/${frameworkKey}/summary`, accessToken),
      ]);
      setFramework(frameworkData);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load framework');
    } finally {
      setLoading(false);
    }
  };

  const loadControls = async () => {
    if (!accessToken || !frameworkKey) return;
    setLoadingControls(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('framework_key', frameworkKey);
      if (domainFilter) params.set('domain_code', domainFilter);
      if (criticalityFilter) params.set('criticality', criticalityFilter);
      if (statusFilter) params.set('status_enum', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      const qs = params.toString();
      const response = await api.get<ControlListItem[]>(`/compliance/controls?${qs}`, accessToken);
      setControls(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load controls');
    } finally {
      setLoadingControls(false);
    }
  };

  const loadGaps = async () => {
    if (!accessToken || !frameworkKey) return;
    setLoadingGaps(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('framework_key', frameworkKey);
      params.set('threshold', gapThreshold);
      const response = await api.get<GapItem[]>(`/compliance/gaps?${params.toString()}`, accessToken);
      setGaps(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gaps');
    } finally {
      setLoadingGaps(false);
    }
  };

  useEffect(() => {
    void loadBase();
  }, [accessToken, frameworkKey]);

  useEffect(() => {
    const handler = setTimeout(() => {
      void loadControls();
    }, 300);
    return () => clearTimeout(handler);
  }, [accessToken, frameworkKey, domainFilter, criticalityFilter, statusFilter, query]);

  useEffect(() => {
    if (activeTab !== 'gaps') return;
    const handler = setTimeout(() => {
      void loadGaps();
    }, 250);
    return () => clearTimeout(handler);
  }, [activeTab, accessToken, frameworkKey, gapThreshold]);

  const domainOptions = useMemo(() => {
    const set = new Map(summary?.by_domain?.map((item) => [item.key, item.label]) || []);
    return Array.from(set.entries()).map(([key, label]) => ({ key, label }));
  }, [summary]);

  const controlStats = useMemo(() => {
    const byStatus = new Map<string, number>();
    let withEvidence = 0;
    for (const item of controls) {
      const status = item.status?.status_enum ?? 'not_started';
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      if (item.evidence_count > 0) withEvidence += 1;
    }
    const total = controls.length;
    const notStarted = byStatus.get('not_started') ?? 0;
    const inProgress = (byStatus.get('in_progress') ?? 0) + (byStatus.get('partial') ?? 0);
    const implemented = (byStatus.get('implemented') ?? 0) + (byStatus.get('mostly') ?? 0);
    const evidenceCoverage = total > 0 ? withEvidence / total : null;
    return { total, notStarted, inProgress, implemented, withEvidence, evidenceCoverage };
  }, [controls]);

  if (loading) return <LoadingState label='Loading framework...' />;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className='text-2xl font-semibold'>{framework?.name ?? frameworkKey}</h2>
          <p className='text-sm text-muted-foreground'>{framework?.full_name ?? 'Framework summary'}</p>
        </div>
        <Button type='button' variant='outline' onClick={() => router.push('/compliance-hub/profile')}>
          Back to overview
        </Button>
      </div>

      {error ? <p className='text-sm text-red-600'>{error}</p> : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        className='w-full'
      >
        <TabsList className='w-full justify-start'>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='controls'>Controls</TabsTrigger>
          <TabsTrigger value='gaps'>Gaps</TabsTrigger>
        </TabsList>

        <TabsContent value='overview' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>Framework summary</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex flex-wrap items-end justify-between gap-3'>
                <div className='text-2xl font-semibold tabular-nums'>{formatPercent(summary?.framework?.compliance ?? null)}</div>
                <div className='text-xs text-muted-foreground'>
                  {summary?.framework?.numerator ?? 0}/{summary?.framework?.denominator ?? 0} scored items
                </div>
              </div>
              <div className='grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6'>
                {summary?.by_domain?.map((item) => (
                  <div key={item.key} className='rounded-md border bg-slate-50/60 px-2 py-1.5'>
                    <div className='truncate text-[11px] text-muted-foreground'>{item.label}</div>
                    <div className='text-sm font-semibold tabular-nums'>{formatPercent(item.compliance)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='controls' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>Controls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='flex flex-wrap gap-2'>
                <div className='rounded-md border bg-slate-50/60 px-2 py-1.5 text-xs'>
                  <div className='text-[11px] text-muted-foreground'>Total</div>
                  <div className='font-semibold tabular-nums'>{controlStats.total}</div>
                </div>
                <div className='rounded-md border bg-slate-50/60 px-2 py-1.5 text-xs'>
                  <div className='text-[11px] text-muted-foreground'>Evidence coverage</div>
                  <div className='font-semibold tabular-nums'>{formatPercent(controlStats.evidenceCoverage)}</div>
                </div>
                <div className='rounded-md border bg-slate-50/60 px-2 py-1.5 text-xs'>
                  <div className='text-[11px] text-muted-foreground'>Not started</div>
                  <div className='font-semibold tabular-nums'>{controlStats.notStarted}</div>
                </div>
                <div className='rounded-md border bg-slate-50/60 px-2 py-1.5 text-xs'>
                  <div className='text-[11px] text-muted-foreground'>In progress</div>
                  <div className='font-semibold tabular-nums'>{controlStats.inProgress}</div>
                </div>
                <div className='rounded-md border bg-slate-50/60 px-2 py-1.5 text-xs'>
                  <div className='text-[11px] text-muted-foreground'>Implemented</div>
                  <div className='font-semibold tabular-nums'>{controlStats.implemented}</div>
                </div>
                {controls.length > 0 && (
                  <div className='ml-auto flex items-center text-xs text-muted-foreground'>
                    Observation: {formatPercent(controlStats.evidenceCoverage)} of controls have evidence;{' '}
                    {controlStats.notStarted} are not started.
                  </div>
                )}
              </div>

              <div className='mt-3 grid gap-2 md:grid-cols-4'>
                <Input
                  className='h-9'
                  placeholder='Search controls...'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  className='h-9 rounded-md border border-input bg-white px-3 text-[13px]'
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                >
                  <option value=''>All domains</option>
                  {domainOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  className='h-9 rounded-md border border-input bg-white px-3 text-[13px]'
                  value={criticalityFilter}
                  onChange={(e) => setCriticalityFilter(e.target.value)}
                >
                  <option value=''>All criticality</option>
                  <option value='High'>High</option>
                  <option value='Medium'>Medium</option>
                  <option value='Low'>Low</option>
                </select>
                <select
                  className='h-9 rounded-md border border-input bg-white px-3 text-[13px]'
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value=''>All status</option>
                  <option value='not_started'>Not started</option>
                  <option value='in_progress'>In progress</option>
                  <option value='partial'>Partial</option>
                  <option value='mostly'>Mostly</option>
                  <option value='implemented'>Implemented</option>
                  <option value='na'>N/A</option>
                </select>
              </div>

              {loadingControls ? (
                <LoadingState label='Loading controls...' />
              ) : controls.length === 0 ? (
                <EmptyState title='No controls found' description='Try adjusting filters or search query.' />
              ) : (
                <div className='mt-3 overflow-hidden rounded-lg border'>
                  <div className='hidden grid-cols-[110px_1fr_120px_110px_140px_110px] items-center gap-3 border-b bg-slate-50/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground md:grid'>
                    <div>Code</div>
                    <div>Title</div>
                    <div>Domain</div>
                    <div>Criticality</div>
                    <div>Status</div>
                    <div className='text-right'>Evidence</div>
                  </div>
                  {controls.map((item) => {
                    const status = item.status?.status_enum ?? 'not_started';
                    return (
                      <button
                        key={item.control.control_key}
                        type='button'
                        className='grid w-full grid-cols-[96px_1fr] items-center gap-3 px-3 py-2 text-left text-[13px] transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white md:grid-cols-[110px_1fr_120px_110px_140px_110px]'
                        onClick={() => setSelectedControlKey(item.control.control_key)}
                      >
                        <div className='font-semibold tabular-nums text-slate-900'>{item.control.code}</div>
                        <div className='min-w-0'>
                          <div className='truncate text-slate-900'>{item.control.title}</div>
                          <div className='mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground md:hidden'>
                            <span className='rounded border bg-slate-50 px-1.5 py-0.5'>{item.control.domain_code}</span>
                            <span className='rounded border bg-slate-50 px-1.5 py-0.5'>{item.control.criticality}</span>
                            <span className='rounded border bg-slate-50 px-1.5 py-0.5'>{formatStatus(status)}</span>
                            <span className='rounded border bg-slate-50 px-1.5 py-0.5 tabular-nums'>
                              {item.evidence_count} evidence
                            </span>
                          </div>
                        </div>
                        <div className='hidden text-muted-foreground md:block'>{item.control.domain_code}</div>
                        <div className='hidden text-muted-foreground md:block'>{item.control.criticality}</div>
                        <div className='hidden md:block'>
                          <Badge
                            variant='secondary'
                            className='h-5 rounded-md px-2 text-[11px] font-medium tabular-nums'
                          >
                            {formatStatus(status)}
                          </Badge>
                        </div>
                        <div className='hidden text-right md:block'>
                          <Badge variant='outline' className='h-5 rounded-md px-2 text-[11px] font-medium tabular-nums'>
                            {item.evidence_count}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='gaps' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>Gaps</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex flex-wrap items-center gap-3'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs text-muted-foreground'>Threshold</span>
                  <Input
                    className='h-8 w-20'
                    type='number'
                    min={0}
                    max={1}
                    step={0.05}
                    value={gapThreshold}
                    onChange={(e) => setGapThreshold(e.target.value)}
                  />
                </div>
                <Button type='button' size='sm' variant='outline' onClick={loadGaps} disabled={loadingGaps}>
                  Refresh
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => router.push(`/compliance-hub/gaps?framework_key=${frameworkKey}`)}
                >
                  Open global queue
                </Button>
                <span className='ml-auto text-xs text-muted-foreground'>{gaps.length} gap(s)</span>
              </div>

              {loadingGaps ? (
                <LoadingState label='Loading gaps...' />
              ) : gaps.length === 0 ? (
                <EmptyState title='No gaps found' description='Try adjusting threshold or update control statuses.' />
              ) : (
                <div className='overflow-hidden rounded-lg border'>
                  <div className='grid grid-cols-[120px_1fr_120px_130px_120px] gap-3 border-b bg-slate-50/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground'>
                    <div>Control</div>
                    <div>Title</div>
                    <div>Severity</div>
                    <div>Implementation</div>
                    <div>Status</div>
                  </div>
                  {gaps.map((gap) => (
                    <button
                      key={gap.control_key}
                      type='button'
                      className='grid w-full grid-cols-[120px_1fr_120px_130px_120px] gap-3 px-3 py-2 text-left text-[13px] transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white'
                      onClick={() => setSelectedControlKey(gap.control_key)}
                    >
                      <div className='font-semibold tabular-nums text-slate-900'>{gap.code}</div>
                      <div className='truncate text-slate-900'>{gap.title}</div>
                      <div>
                        <Badge variant='outline' className='h-5 rounded-md px-2 text-[11px] font-medium'>
                          {gap.criticality}
                        </Badge>
                      </div>
                      <div className='font-semibold tabular-nums'>{(gap.score * 100).toFixed(0)}%</div>
                      <div>
                        <Badge variant='secondary' className='h-5 rounded-md px-2 text-[11px] font-medium tabular-nums'>
                          {formatStatus(gap.status_enum ?? 'not_started')}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ControlDrawer
        open={Boolean(selectedControlKey)}
        onOpenChange={(open) => !open && setSelectedControlKey(null)}
        controlKey={selectedControlKey}
        accessToken={accessToken}
        onUpdated={() => {
          void loadControls();
          void loadBase();
          void loadGaps();
        }}
      />
    </div>
  );
}
