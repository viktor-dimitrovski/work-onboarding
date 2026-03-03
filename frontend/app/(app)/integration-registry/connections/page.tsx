'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Columns, Plus, Search, X, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrCryptoSettings, IrInstanceListItem, IrInstanceListResponse, IrGridPrefs } from '@/lib/types';
import {
  irEnvTone,
  irStatusTone,
  formatDateShort,
  IR_DEFAULT_COLUMNS,
  IR_COLUMN_LABELS,
} from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/common/loading-state';
import { EmptyState } from '@/components/common/empty-state';
import { ConnectionDrawer } from '@/components/integration-registry/connection-drawer';
import { ColumnPicker } from '@/components/integration-registry/column-picker';

const PAGE_SIZE = 50;

export default function IrConnectionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [rows, setRows] = useState<IrInstanceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [envFilter, setEnvFilter] = useState(searchParams.get('env') || '');
  const [dcFilter, setDcFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [visibleCols, setVisibleCols] = useState<string[]>([...IR_DEFAULT_COLUMNS]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('highlight'));
  const [drawerTab, setDrawerTab] = useState<string>('overview');
  const [encryptionLocked, setEncryptionLocked] = useState(false);

  const prefsLoaded = useRef(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:read')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  // Load saved column prefs once
  useEffect(() => {
    if (!accessToken || prefsLoaded.current) return;
    prefsLoaded.current = true;
    api
      .get<IrGridPrefs>('/integration-registry/grid-prefs/connections', accessToken)
      .then((prefs) => {
        if (prefs.visible_columns && prefs.visible_columns.length > 0) {
          setVisibleCols(prefs.visible_columns);
        }
      })
      .catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    api
      .get<IrCryptoSettings>('/integration-registry/settings', accessToken)
      .then((data) => setEncryptionLocked(!data.unlocked))
      .catch(() => {});
  }, [accessToken]);

  const loadData = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (envFilter) params.set('env', envFilter);
    if (dcFilter) params.set('datacenter', dcFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('page_size', String(PAGE_SIZE));

    api
      .get<IrInstanceListResponse>(
        `/integration-registry/instances?${params.toString()}`,
        accessToken,
      )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e.message || 'Failed to load connections'))
      .finally(() => setLoading(false));
  }, [accessToken, envFilter, dcFilter, statusFilter, search, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const colVisible = (key: string) => visibleCols.includes(key) || key === 'actions';

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Connections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All integration instances — {total} total
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowColumnPicker(true)}>
            <Columns className="h-4 w-4 mr-1" />
            Columns
          </Button>
          {hasPermission('ir:write') && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setDrawerTab('form');
              }}
              disabled={encryptionLocked}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Connection
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search service, datacenter, network…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={envFilter}
              onChange={(e) => { setEnvFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm min-w-[120px]"
            >
              <option value="">All Envs</option>
              <option value="UAT">UAT</option>
              <option value="PROD">PROD</option>
            </select>
            <input
              type="text"
              placeholder="Datacenter"
              value={dcFilter}
              onChange={(e) => { setDcFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm w-[140px]"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm min-w-[130px]"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="disabled">Disabled</option>
              <option value="deprecated">Deprecated</option>
            </select>
            {(envFilter || dcFilter || statusFilter || search) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setEnvFilter('');
                  setDcFilter('');
                  setStatusFilter('');
                  setPage(1);
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Data table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading connections…" />
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No connections found"
                description="Try adjusting your filters or create a new connection."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {colVisible('service') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.service}
                      </th>
                    )}
                    {colVisible('env') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.env}
                      </th>
                    )}
                    {colVisible('dc') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.dc}
                      </th>
                    )}
                    {colVisible('network') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.network}
                      </th>
                    )}
                    {colVisible('endpoint') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.endpoint}
                      </th>
                    )}
                    {colVisible('status') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.status}
                      </th>
                    )}
                    {colVisible('updated') && (
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                        {IR_COLUMN_LABELS.updated}
                      </th>
                    )}
                    <th className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/60 transition-colors hover:bg-muted/20 cursor-pointer"
                      onClick={() => { setSelectedId(row.id); setDrawerTab('overview'); }}
                    >
                      {colVisible('service') && (
                        <td className="py-3 px-4 font-medium">{row.service_name || '—'}</td>
                      )}
                      {colVisible('env') && (
                        <td className="py-3 px-4">
                          <Badge variant="outline" className={`text-xs ${irEnvTone(row.env)}`}>
                            {row.env}
                          </Badge>
                        </td>
                      )}
                      {colVisible('dc') && (
                        <td className="py-3 px-4 text-muted-foreground">{row.datacenter || '—'}</td>
                      )}
                      {colVisible('network') && (
                        <td className="py-3 px-4 text-muted-foreground">{row.network_zone || '—'}</td>
                      )}
                      {colVisible('endpoint') && (
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                          {row.encryption_locked ? 'Locked' : row.primary_endpoint || '—'}
                        </td>
                      )}
                      {colVisible('status') && (
                        <td className="py-3 px-4">
                          <Badge variant="outline" className={`text-xs ${irStatusTone(row.status)}`}>
                            {row.status}
                          </Badge>
                        </td>
                      )}
                      {colVisible('updated') && (
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {formatDateShort(row.updated_at)}
                        </td>
                      )}
                      <td className="py-3 px-4 text-right">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="text-xs text-primary underline-offset-2 hover:underline"
                            onClick={() => { setSelectedId(row.id); setDrawerTab('overview'); }}
                          >
                            View
                          </button>
                          <button
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() => { setSelectedId(row.id); setDrawerTab('history'); }}
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </span>
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
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Drawer */}
      {selectedId && (
        <ConnectionDrawer
          instanceId={selectedId}
          defaultTab={drawerTab}
          open={!!selectedId}
          onOpenChange={(open) => { if (!open) setSelectedId(null); }}
          onRefresh={loadData}
        />
      )}

      {/* Column picker */}
      <ColumnPicker
        open={showColumnPicker}
        onOpenChange={setShowColumnPicker}
        visibleColumns={visibleCols}
        onApply={(cols) => {
          setVisibleCols(cols);
          if (accessToken) {
            api
              .put('/integration-registry/grid-prefs/connections', { visible_columns: cols, order: [] }, accessToken)
              .catch(() => {});
          }
        }}
      />
    </div>
  );
}
