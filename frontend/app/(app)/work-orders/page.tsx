"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type WODCStatus = {
  data_center_id: string;
  data_center_name: string;
  slug: string;
  status: string;
  deployed_at: string | null;
};

type WorkOrderSummary = {
  wo_id: string;
  id: string | null;
  title?: string | null;
  path: string;
  year: string;
  services_count: number;
  deploy_count: number;
  sync_status?: string | null;
  pr_url?: string | null;
  branch?: string | null;
  dc_deployments: WODCStatus[];
  platform_release_id: string | null;
  platform_release_name: string | null;
};

type DataCenter = { id: string; name: string; slug: string; environment: string };

export default function WorkOrdersPage() {
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const [items, setItems] = useState<WorkOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [dcFilter, setDcFilter] = useState('');
  const [notDeployedOnly, setNotDeployedOnly] = useState(false);
  const [dataCenters, setDataCenters] = useState<DataCenter[]>([]);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const canWrite = hasModule('releases') && hasPermission('releases:write');
  const lastFetchKey = useRef('');

  const load = async (q?: string) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (dcFilter && notDeployedOnly) {
        params.set('data_center_id', dcFilter);
        params.set('not_deployed', 'true');
      }
      const qs = params.toString();
      const response = await api.get<{ items: WorkOrderSummary[] }>(`/work-orders${qs ? `?${qs}` : ''}`, accessToken);
      setItems(response.items);
      setBulkError(null);
    } finally {
      setLoading(false);
    }
  };

  // Load data centers once
  useEffect(() => {
    if (!accessToken) return;
    api.get<{ items: DataCenter[] }>('/data-centers', accessToken)
      .then((res) => setDataCenters(res.items ?? []))
      .catch(() => {});
  }, [accessToken]);

  const bulkSync = async (syncStatus?: string) => {
    if (!accessToken || !canWrite) return;
    setBulkSyncing(true);
    setBulkError(null);
    try {
      const params = syncStatus ? `?sync_status=${encodeURIComponent(syncStatus)}` : '';
      await api.post(`/work-orders/sync${params}`, {}, accessToken);
      lastFetchKey.current = '';
      await load(query.trim() || undefined);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to queue bulk sync');
    } finally {
      setBulkSyncing(false);
    }
  };

  useEffect(() => {
    const key = `${accessToken ?? ''}::${query}::${dcFilter}::${notDeployedOnly}`;
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    const handler = setTimeout(() => {
      void load(query.trim() || undefined);
    }, query ? 350 : 0);
    return () => clearTimeout(handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, accessToken, dcFilter, notDeployedOnly]);

  const yearOptions = useMemo(() => {
    const values = new Set(items.map((item) => item.year).filter(Boolean));
    return Array.from(values).sort().reverse();
  }, [items]);

  const filteredItems = items.filter((item) => (yearFilter ? item.year === yearFilter : true));

  const syncBadgeClass = (status?: string | null) => {
    switch (status) {
      case 'synced': return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'pending': return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'failed': return 'border-red-200 bg-red-50 text-red-700';
      default: return 'border-muted text-muted-foreground';
    }
  };

  const dcChipClass = (status: string) => {
    switch (status) {
      case 'deployed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'deploying': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'failed': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const hasActiveFilters = !!(query || yearFilter || dcFilter || notDeployedOnly);

  if (loading) return <LoadingState label='Loading work orders...' />;

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Work Orders</h2>
          <p className='text-sm text-muted-foreground'>Track development scope, touched services, and release readiness.</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {canWrite && (
            <>
              <Button type='button' variant='outline' onClick={() => bulkSync()} disabled={bulkSyncing}>
                {bulkSyncing ? 'Syncing…' : 'Sync all'}
              </Button>
              <Button type='button' variant='outline' onClick={() => bulkSync('failed')} disabled={bulkSyncing}>
                Sync failed
              </Button>
            </>
          )}
          {canWrite && (
            <Button asChild>
              <Link href='/work-orders/new'>New WO</Link>
            </Button>
          )}
        </div>
      </div>

      {bulkError && <p className='text-sm text-destructive'>{bulkError}</p>}

      {/* Filters */}
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search WO id, title, or service...'
          className='max-w-sm'
        />
        <select
          className='h-10 rounded-md border border-input bg-white px-3 text-sm'
          value={yearFilter}
          onChange={(event) => setYearFilter(event.target.value)}
        >
          <option value=''>All years</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>

        {/* DC filter */}
        {dataCenters.length > 0 && (
          <select
            className='h-10 rounded-md border border-input bg-white px-3 text-sm'
            value={dcFilter}
            onChange={(event) => setDcFilter(event.target.value)}
          >
            <option value=''>All DCs</option>
            {dataCenters.map((dc) => (
              <option key={dc.id} value={dc.id}>{dc.name}</option>
            ))}
          </select>
        )}

        {/* Not deployed toggle — only meaningful when a DC is selected */}
        {dcFilter && (
          <button
            onClick={() => setNotDeployedOnly((v) => !v)}
            className={cn(
              'h-10 rounded-md border px-3 text-sm font-medium transition-colors',
              notDeployedOnly
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-input bg-white text-muted-foreground hover:bg-slate-50',
            )}
          >
            Not deployed
          </button>
        )}

        {hasActiveFilters && (
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setQuery('');
              setYearFilter('');
              setDcFilter('');
              setNotDeployedOnly(false);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* List */}
      {filteredItems.length === 0 ? (
        <EmptyState title='No work orders' description='Create the first WO to start tracking delivery scope.' />
      ) : (
        <div className='space-y-2'>
          {filteredItems.map((item) => (
            <Link
              key={item.wo_id}
              href={`/work-orders/${item.wo_id}`}
              className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm text-sm transition hover:border-primary/40 hover:shadow'
            >
              {/* Left: identity */}
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <span className='font-semibold text-slate-900 font-mono text-xs'>{item.wo_id}</span>
                  <span className='font-medium text-slate-700 truncate'>{item.title || 'Untitled work order'}</span>
                  {/* Release plan badge */}
                  {item.platform_release_id && (
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.href = `/platform-releases/${item.platform_release_id}`;
                      }}
                      className='inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-100 cursor-pointer'
                    >
                      📦 {item.platform_release_name ?? 'Release Plan'}
                    </span>
                  )}
                </div>

                {/* DC deployment chips */}
                {item.dc_deployments.length > 0 && (
                  <div className='flex items-center gap-1.5 mt-1.5 flex-wrap'>
                    {item.dc_deployments.map((dep) => (
                      <span
                        key={dep.data_center_id}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          dcChipClass(dep.status),
                        )}
                        title={dep.deployed_at ? `Deployed ${new Date(dep.deployed_at).toLocaleDateString()}` : dep.status}
                      >
                        <span className='h-1.5 w-1.5 rounded-full bg-current opacity-70' />
                        {dep.data_center_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: stats */}
              <div className='flex items-center gap-4 text-xs text-muted-foreground tabular-nums flex-shrink-0'>
                <span>{item.services_count} svc</span>
                <span>{item.year}</span>
                <Badge variant='outline' className={syncBadgeClass(item.sync_status)}>
                  {item.sync_status || 'unknown'}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
