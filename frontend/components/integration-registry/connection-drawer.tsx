'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Pencil } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrAuditLog, IrInstance } from '@/lib/types';
import { irEnvTone, irStatusTone, formatDateTime, shortId, maskVaultRef } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState } from '@/components/common/loading-state';
import { ConnectionForm } from '@/components/integration-registry/connection-form';

interface ConnectionDrawerProps {
  instanceId: string;
  defaultTab?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function ConnectionDrawer({
  instanceId,
  defaultTab = 'overview',
  open,
  onOpenChange,
  onRefresh,
}: ConnectionDrawerProps) {
  const { accessToken } = useAuth();
  const { hasPermission } = useTenant();

  const [instance, setInstance] = useState<IrInstance | null>(null);
  const [history, setHistory] = useState<IrAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);

  const loadInstance = useCallback(() => {
    if (!accessToken || !instanceId) return;
    setLoading(true);
    api
      .get<IrInstance>(`/integration-registry/instances/${instanceId}`, accessToken)
      .then((data) => {
        setInstance(data);
        setError(null);
      })
      .catch((e) => setError(e.message || 'Failed to load connection'))
      .finally(() => setLoading(false));
  }, [accessToken, instanceId]);

  const loadHistory = useCallback(() => {
    if (!accessToken || !instanceId) return;
    setHistLoading(true);
    api
      .get<IrAuditLog[]>(
        `/integration-registry/instances/${instanceId}/history`,
        accessToken,
      )
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false));
  }, [accessToken, instanceId]);

  useEffect(() => {
    if (open) {
      loadInstance();
      setActiveTab(defaultTab);
      setEditing(false);
    }
  }, [open, instanceId, defaultTab, loadInstance]);

  useEffect(() => {
    if (activeTab === 'history' && open) {
      loadHistory();
    }
  }, [activeTab, open, loadHistory]);

  const handleCloneToProd = async () => {
    if (!accessToken || !instance) return;
    const reason = window.prompt('Clone reason (required):');
    if (!reason?.trim()) return;
    setCloning(true);
    try {
      await api.post(
        `/integration-registry/instances/${instance.id}/clone-to-prod?change_reason=${encodeURIComponent(reason)}`,
        {},
        accessToken,
      );
      onRefresh();
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clone failed');
    } finally {
      setCloning(false);
    }
  };

  const handleEditSaved = () => {
    setEditing(false);
    loadInstance();
    onRefresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-w-2xl flex-col p-0">
        <SheetHeader className="border-b px-5 py-4 flex-row items-center justify-between space-y-0">
          <div className="min-w-0">
            <SheetTitle className="text-base leading-tight">
              {loading
                ? 'Loading…'
                : instance
                  ? `${instance.service_name || 'Connection'}`
                  : 'Connection Details'}
            </SheetTitle>
            {instance && !loading && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={`text-xs ${irEnvTone(instance.env)}`}>
                  {instance.env}
                </Badge>
                <Badge variant="outline" className={`text-xs ${irStatusTone(instance.status)}`}>
                  {instance.status}
                </Badge>
                {instance.datacenter && (
                  <span className="text-xs text-muted-foreground">{instance.datacenter}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {instance && hasPermission('ir:write') && !editing && !instance.encryption_locked && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            )}
            {instance?.env === 'UAT' && hasPermission('ir:approve') && !editing && !instance.encryption_locked && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCloneToProd}
                disabled={cloning}
              >
                <GitBranch className="h-3.5 w-3.5 mr-1" />
                {cloning ? 'Cloning…' : 'Clone to PROD'}
              </Button>
            )}
          </div>
        </SheetHeader>

        {instance?.encryption_locked && (
          <div className="mx-5 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Encryption key is not loaded. Unlock Integration Registry in Settings to view or edit sensitive fields.
          </div>
        )}

        {error && (
          <div className="mx-5 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1">
            <LoadingState label="Loading connection…" />
          </div>
        ) : !instance ? null : editing ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <ConnectionForm
              accessToken={accessToken!}
              instance={instance}
              onSaved={handleEditSaved}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-5 mt-3 justify-start h-9 w-auto shrink-0">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="endpoints" className="text-xs">Endpoints</TabsTrigger>
              <TabsTrigger value="routes" className="text-xs">Routes</TabsTrigger>
              <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
              <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Overview tab */}
              <TabsContent value="overview" className="mt-0 space-y-4">
                <KvGrid
                  rows={[
                    { label: 'Service', value: instance.service_name },
                    { label: 'Environment', value: instance.env },
                    { label: 'Datacenter', value: instance.datacenter },
                    { label: 'Network Zone', value: instance.network_zone },
                    { label: 'Status', value: instance.status },
                    {
                      label: 'Contact',
                      value: instance.encryption_locked ? 'Locked' : instance.contact,
                    },
                    {
                      label: 'Vault Ref',
                      value: instance.encryption_locked
                        ? 'Locked'
                        : instance.vault_ref
                          ? maskVaultRef(instance.vault_ref)
                          : null,
                      mono: true,
                      masked: true,
                    },
                    { label: 'Notes', value: instance.encryption_locked ? 'Locked' : instance.notes },
                    { label: 'Version', value: String(instance.version) },
                    {
                      label: 'Created',
                      value: formatDateTime(instance.created_at),
                    },
                    {
                      label: 'Updated',
                      value: formatDateTime(instance.updated_at),
                    },
                  ]}
                />
              </TabsContent>

              {/* Endpoints tab */}
              <TabsContent value="endpoints" className="mt-0">
                {!instance.endpoints || instance.endpoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No endpoints defined.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {instance.endpoints.map((ep) => (
                      <div
                        key={ep.id}
                        className="rounded-md border border-border/60 p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center gap-2">
                          {ep.is_primary && (
                            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                              Primary
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-xs ${ep.is_public ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                          >
                            {ep.is_public ? 'Public' : 'Private'}
                          </Badge>
                        </div>
                        <KvGrid
                          rows={[
                            { label: 'FQDN', value: ep.fqdn, mono: true },
                            { label: 'IP', value: ep.ip, mono: true },
                            { label: 'Port', value: ep.port?.toString() },
                            { label: 'Protocol', value: ep.protocol },
                            { label: 'Base Path', value: ep.base_path, mono: true },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Routes tab */}
              <TabsContent value="routes" className="mt-0">
                {!instance.route_hops || instance.route_hops.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No proxy route hops defined.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {instance.route_hops.map((rh, i) => (
                      <div
                        key={rh.id}
                        className="rounded-md border border-border/60 p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">Hop #{i + 1}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${rh.direction === 'inbound' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}
                          >
                            {rh.direction}
                          </Badge>
                        </div>
                        <KvGrid
                          rows={[
                            { label: 'Label', value: rh.label },
                            { label: 'Chain', value: rh.proxy_chain, mono: true },
                            { label: 'Notes', value: rh.notes },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Settings tab */}
              <TabsContent value="settings" className="mt-0">
                {!instance.type_settings_json ||
                Object.keys(instance.type_settings_json).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No type-specific settings.</p>
                ) : (
                  <KvGrid
                    rows={Object.entries(instance.type_settings_json).map(([k, v]) => ({
                      label: k,
                      value: String(v),
                    }))}
                  />
                )}
              </TabsContent>

              {/* History tab */}
              <TabsContent value="history" className="mt-0">
                {histLoading ? (
                  <LoadingState label="Loading history…" />
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No history entries.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {history.map((log) => (
                      <HistoryCard key={log.id} log={log} />
                    ))}
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function KvGrid({
  rows,
}: {
  rows: Array<{ label: string; value?: string | null; mono?: boolean; masked?: boolean }>;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-xs font-medium text-muted-foreground whitespace-nowrap">{r.label}</dt>
            <dd
              className={`min-w-0 break-words ${r.mono ? 'font-mono text-xs' : ''} ${r.masked ? 'text-muted-foreground' : ''}`}
            >
              {r.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function HistoryCard({ log }: { log: IrAuditLog }) {
  const [expanded, setExpanded] = useState(false);

  const actionColors: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    update: 'bg-sky-100 text-sky-700 border-sky-200',
    delete: 'bg-red-100 text-red-600 border-red-200',
  };

  return (
    <div className="rounded-md border border-border/60 p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${actionColors[log.action] || ''}`}>
            v{log.version} · {log.action}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatDateTime(log.changed_at)}</span>
          {log.changed_by && (
            <span className="text-xs text-muted-foreground font-mono">{shortId(log.changed_by)}</span>
          )}
        </div>
        <button
          className="text-xs text-primary hover:underline shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide' : 'Show'} snapshot
        </button>
      </div>
      <p className="text-sm">{log.change_reason}</p>
      {expanded && (
        <pre className="text-xs bg-muted/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-52 mt-1">
          {JSON.stringify(log.snapshot_json, null, 2)}
        </pre>
      )}
    </div>
  );
}
