'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { formatDateTime } from '@/lib/constants';
import { cn } from '@/lib/utils';

type AuditLogItem = {
  id: string;
  actor_user_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  status: string;
  details: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
};

type AuditLogResponse = {
  items: AuditLogItem[];
  meta: { page: number; page_size: number; total: number };
};

export default function AuditLogPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const canManage = hasModule('settings') && hasPermission('settings:manage');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    if (actionFilter.trim()) params.set('action', actionFilter.trim());
    if (statusFilter.trim()) params.set('status', statusFilter.trim());
    if (startDate) params.set('start', `${startDate}T00:00:00Z`);
    if (endDate) params.set('end', `${endDate}T23:59:59Z`);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [actionFilter, statusFilter, startDate, endDate, page, pageSize]);

  useEffect(() => {
    if (!accessToken || !canManage) return;
    const handle = setTimeout(() => {
      const run = async () => {
        setLoading(true);
        try {
          const response = await api.get<AuditLogResponse>(`/audit-log${query}`, accessToken);
          setItems(response.items);
          setTotal(response.meta.total ?? 0);
        } finally {
          setLoading(false);
        }
      };
      void run();
    }, 200);
    return () => clearTimeout(handle);
  }, [accessToken, canManage, query]);

  useEffect(() => {
    setPage(1);
  }, [actionFilter, statusFilter, startDate, endDate, pageSize]);

  if (!canManage) {
    return <EmptyState title='Access denied' description='You do not have access to audit logs.' />;
  }

  if (loading) return <LoadingState label='Loading audit log...' />;

  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Audit log</h2>
        <p className='text-sm text-muted-foreground'>Review recent administrative and system actions.</p>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
          placeholder='Filter by action (track_create, user_create)'
          className='max-w-sm'
        />
        <Input
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          placeholder='Filter by status'
          className='max-w-[160px]'
        />
        <Input type='date' value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        <Input type='date' value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        {(actionFilter || statusFilter || startDate || endDate) && (
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setActionFilter('');
              setStatusFilter('');
              setStartDate('');
              setEndDate('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState title='No audit entries yet' description='Activity will appear here as actions are logged.' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='grid grid-cols-[minmax(180px,2fr)_140px_140px_140px_minmax(160px,2fr)] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground'>
              <div>Action</div>
              <div>Entity</div>
              <div>Actor</div>
              <div>Status</div>
              <div>Details</div>
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'grid grid-cols-[minmax(180px,2fr)_140px_140px_140px_minmax(160px,2fr)] items-center gap-2 rounded-md border px-3 py-2 text-sm',
                )}
              >
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{item.action}</p>
                  <p className='text-xs text-muted-foreground'>{formatDateTime(item.created_at)}</p>
                </div>
                <div className='text-xs text-muted-foreground'>{item.entity_type}</div>
                <div className='text-xs text-muted-foreground'>
                  {item.actor_name || item.actor_email || item.actor_user_id || 'System'}
                </div>
                <div className='text-xs'>
                  <StatusChip status={item.status} />
                </div>
                <div className='text-xs text-muted-foreground'>
                  {Object.keys(item.details || {}).length === 0
                    ? '—'
                    : JSON.stringify(item.details).slice(0, 160)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-xs text-muted-foreground'>
          Showing {items.length} of {total} entries
        </p>
        <div className='flex items-center gap-2'>
          <select
            className='h-8 rounded-md border border-input bg-background px-2 text-xs'
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value || 25))}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </Button>
          <span className='text-xs text-muted-foreground'>
            Page {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
