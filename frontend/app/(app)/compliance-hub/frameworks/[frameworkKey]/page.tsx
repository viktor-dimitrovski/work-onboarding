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

const formatPercent = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
};

export default function ComplianceFrameworkPage() {
  const params = useParams();
  const router = useRouter();
  const frameworkKey = String(params.frameworkKey || '');
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [framework, setFramework] = useState<Framework | null>(null);
  const [summary, setSummary] = useState<FrameworkSummary | null>(null);
  const [controls, setControls] = useState<ControlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingControls, setLoadingControls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selectedControlKey, setSelectedControlKey] = useState<string | null>(null);

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

  useEffect(() => {
    void loadBase();
  }, [accessToken, frameworkKey]);

  useEffect(() => {
    const handler = setTimeout(() => {
      void loadControls();
    }, 300);
    return () => clearTimeout(handler);
  }, [accessToken, frameworkKey, domainFilter, criticalityFilter, statusFilter, query]);

  const domainOptions = useMemo(() => {
    const set = new Map(summary?.by_domain?.map((item) => [item.key, item.label]) || []);
    return Array.from(set.entries()).map(([key, label]) => ({ key, label }));
  }, [summary]);

  if (loading) return <LoadingState label='Loading framework...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>{framework?.name ?? frameworkKey}</h2>
          <p className='text-sm text-muted-foreground'>{framework?.full_name ?? 'Framework summary'}</p>
        </div>
        <Button type='button' variant='outline' onClick={() => router.push('/compliance-hub')}>
          Back to dashboard
        </Button>
      </div>

      {error ? <p className='text-sm text-red-600'>{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Framework summary</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='text-3xl font-semibold'>{formatPercent(summary?.framework?.compliance ?? null)}</div>
          <div className='grid gap-2 md:grid-cols-3'>
            {summary?.by_domain?.map((item) => (
              <div key={item.key} className='rounded border px-3 py-2'>
                <div className='text-xs text-muted-foreground'>{item.label}</div>
                <div className='text-sm font-medium'>{formatPercent(item.compliance)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-3 md:grid-cols-4'>
            <Input placeholder='Search controls...' value={query} onChange={(e) => setQuery(e.target.value)} />
            <select
              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
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
              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
              value={criticalityFilter}
              onChange={(e) => setCriticalityFilter(e.target.value)}
            >
              <option value=''>All criticality</option>
              <option value='High'>High</option>
              <option value='Medium'>Medium</option>
              <option value='Low'>Low</option>
            </select>
            <select
              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
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
            <div className='mt-4 space-y-2'>
              {controls.map((item) => (
                <button
                  key={item.control.control_key}
                  type='button'
                  className='flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition hover:border-primary/40 hover:bg-muted/20'
                  onClick={() => setSelectedControlKey(item.control.control_key)}
                >
                  <div className='min-w-0'>
                    <div className='text-sm font-semibold'>{item.control.code}</div>
                    <div className='truncate text-sm text-muted-foreground'>{item.control.title}</div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Badge variant='secondary'>{item.status?.status_enum ?? 'not_started'}</Badge>
                    <Badge variant='outline'>{item.evidence_count} evidence</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ControlDrawer
        open={Boolean(selectedControlKey)}
        onOpenChange={(open) => !open && setSelectedControlKey(null)}
        controlKey={selectedControlKey}
        accessToken={accessToken}
        onUpdated={() => {
          void loadControls();
          void loadBase();
        }}
      />
    </div>
  );
}
