'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrAuditLog } from '@/lib/types';
import { formatDateTime, shortId } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/common/loading-state';
import { EmptyState } from '@/components/common/empty-state';

const PAGE_SIZE = 50;

const ACTION_TONE: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  update: 'bg-sky-100 text-sky-700 border-sky-200',
  delete: 'bg-red-100 text-red-600 border-red-200',
};

const ENTITY_LABEL: Record<string, string> = {
  ir_connection: 'Connection',
  ir_instance: 'Connection',
  ir_service: 'Service',
};

export default function IrAuditPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [logs, setLogs] = useState<IrAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:read')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  const loadLogs = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(PAGE_SIZE));
    if (entityTypeFilter) params.set('entity_type', entityTypeFilter);

    api
      .get<IrAuditLog[]>(`/integration-registry/audit-log?${params.toString()}`, accessToken)
      .then(setLogs)
      .catch((e) => setError(e.message || 'Failed to load audit log'))
      .finally(() => setLoading(false));
  }, [accessToken, page, entityTypeFilter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Audit / History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full change log with snapshots for all Integration Registry entities.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={entityTypeFilter}
              onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm min-w-[160px]"
            >
              <option value="">All entity types</option>
              <option value="ir_connection">Connection</option>
              <option value="ir_service">Service</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading audit log…" />
          ) : logs.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No audit records" description="Changes will be recorded here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4 w-8" />
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Action</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Entity Type</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Entity ID</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Version</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Change Reason</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Changed At</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <>
                      <tr
                        key={log.id}
                        className="border-b border-border/60 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      >
                        <td className="py-3 px-4 text-muted-foreground">
                          {expandedId === log.id ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className={`text-xs ${ACTION_TONE[log.action] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                          >
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{ENTITY_LABEL[log.entity_type] ?? log.entity_type}</td>
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{shortId(log.entity_id)}</td>
                        <td className="py-3 px-4 text-center text-xs">{log.version}</td>
                        <td className="py-3 px-4 text-sm max-w-xs truncate">{log.change_reason}</td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{formatDateTime(log.changed_at)}</td>
                      </tr>
                      {expandedId === log.id && (
                        <tr key={`${log.id}-expand`} className="border-b border-border/60 bg-muted/10">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="text-xs font-medium text-muted-foreground mb-1">Snapshot</div>
                            <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-60">
                              {JSON.stringify(log.snapshot_json, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={logs.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
