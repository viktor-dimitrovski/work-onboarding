'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { StartRunDialog } from './start-run-dialog';
import { DeploymentRunCard, type DeploymentRun } from './deployment-run-card';
import { ReopenRunDialog } from './reopen-run-dialog';
import type { RunItemStatus } from './checklist-item';

type DataCenter = { id: string; name: string; slug: string; environment: string; is_primary: boolean; is_dr: boolean };

type Props = {
  platformReleaseId: string;
  releaseStatus: string;
};

export function DeploymentRunsTab({ platformReleaseId, releaseStatus }: Props) {
  const { accessToken } = useAuth();
  const [runs, setRuns] = useState<DeploymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [dataCenters, setDataCenters] = useState<DataCenter[]>([]);
  const [error, setError] = useState('');

  const canStartRun = ['cab_approved', 'deploying', 'deployed'].includes(releaseStatus);

  const loadRuns = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await api.get<DeploymentRun[]>(`/platform-releases/${platformReleaseId}/deployment-runs`, accessToken);
      // For active runs, load full detail with items
      const withItems = await Promise.all(
        data.map(async (run) => {
          if (run.status === 'in_progress' || run.status === 'pending') {
            const full = await api.get<DeploymentRun>(`/deployment-runs/${run.id}`, accessToken);
            return full;
          }
          return run;
        })
      );
      setRuns(withItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, [accessToken, platformReleaseId]);

  useEffect(() => {
    void loadRuns();
    if (!accessToken) return;
    api.get<{ items: DataCenter[] }>('/data-centers', accessToken)
      .then((res) => setDataCenters(res.items ?? []))
      .catch(() => setDataCenters([]));
  }, [loadRuns, accessToken]);

  const activeRun = runs.find((r) => r.status === 'in_progress' || r.status === 'pending');
  const pastRuns = runs.filter((r) => r.status !== 'in_progress' && r.status !== 'pending');

  const handleStartRun = async (data_center_id: string, environment: string) => {
    if (!accessToken) return;
    await api.post<DeploymentRun>(`/platform-releases/${platformReleaseId}/deployment-runs`, { data_center_id, environment }, accessToken);
    setShowStartDialog(false);
    await loadRuns();
  };

  const handleUpdateItem = (runId: string) => async (itemId: string, status: RunItemStatus, notes?: string) => {
    if (!accessToken) return;
    await api.patch<DeploymentRun>(`/deployment-runs/${runId}/items/${itemId}`, { status, notes }, accessToken);
    await loadRuns();
  };

  const handleMarkAllDone = (runId: string) => async () => {
    if (!accessToken) return;
    await api.post<DeploymentRun>(`/deployment-runs/${runId}/items/mark-all-done`, {}, accessToken);
    await loadRuns();
  };

  const handleComplete = (runId: string) => async (force: boolean) => {
    if (!accessToken) return;
    await api.post<DeploymentRun>(`/deployment-runs/${runId}/complete`, { force }, accessToken);
    await loadRuns();
  };

  const handleAbort = (runId: string) => async () => {
    if (!accessToken) return;
    const notes = window.prompt('Enter an abort reason:');
    if (notes === null) return;
    await api.post<DeploymentRun>(`/deployment-runs/${runId}/abort`, { notes: notes || 'Aborted' }, accessToken);
    await loadRuns();
  };

  const handleReopen = (runId: string) => async (reason: string) => {
    if (!accessToken) return;
    await api.post<DeploymentRun>(`/deployment-runs/${runId}/reopen`, { reopen_reason: reason }, accessToken);
    await loadRuns();
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading deployment runs…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Deployment Runs
          {runs.length > 0 && <span className="ml-1.5 text-muted-foreground font-normal">({runs.length})</span>}
        </h3>
        {canStartRun && !activeRun && (
          <Button size="sm" onClick={() => setShowStartDialog(true)} className="h-8">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Start Deployment Run
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {!canStartRun && runs.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          The release must be CAB approved before a deployment run can be started.
        </div>
      )}

      {canStartRun && runs.length === 0 && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No deployment runs yet. Start one to begin deploying this release.</p>
          <Button onClick={() => setShowStartDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Start First Deployment Run
          </Button>
        </div>
      )}

      {/* Active run */}
      {activeRun && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Active Run</p>
          <DeploymentRunCard
            run={activeRun}
            isActive
            onMarkAllDone={handleMarkAllDone(activeRun.id)}
            onComplete={handleComplete(activeRun.id)}
            onAbort={handleAbort(activeRun.id)}
            onReopen={handleReopen(activeRun.id)}
            onUpdateItem={handleUpdateItem(activeRun.id)}
          />
        </div>
      )}

      {/* Past runs */}
      {pastRuns.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Past Runs</p>
          {pastRuns.map((run) => (
            <PastRunRow
              key={run.id}
              run={run}
              onReopen={handleReopen(run.id)}
              onExpandLoad={async () => {
                if (!accessToken) return run;
                return api.get<DeploymentRun>(`/deployment-runs/${run.id}`, accessToken);
              }}
            />
          ))}
        </div>
      )}

      {showStartDialog && (
        <StartRunDialog
          dataCenters={dataCenters}
          onStart={handleStartRun}
          onClose={() => setShowStartDialog(false)}
        />
      )}
    </div>
  );
}

function PastRunRow({
  run,
  onReopen,
  onExpandLoad,
}: {
  run: DeploymentRun;
  onReopen: (reason: string) => Promise<void>;
  onExpandLoad: () => Promise<DeploymentRun>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullRun, setFullRun] = useState<DeploymentRun | null>(null);
  const [showReopen, setShowReopen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleExpand = async () => {
    if (!expanded && !fullRun) {
      setLoading(true);
      try {
        const data = await onExpandLoad();
        setFullRun(data);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((prev) => !prev);
  };

  const statusClass: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    partial: 'bg-amber-100 text-amber-700 border-amber-200',
    aborted: 'bg-red-100 text-red-700 border-red-200',
  };

  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={handleExpand}
      >
        <span className="flex-1 text-sm font-medium text-slate-800">
          {run.data_center_name ?? run.data_center_slug} · {run.environment}
        </span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${statusClass[run.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {run.status}
        </span>
        <span className="text-xs text-muted-foreground">
          {run.done_items}/{run.total_items} done
          {run.blocked_items > 0 && ` · ${run.blocked_items} blocked`}
        </span>
        <span className="text-xs text-muted-foreground">{new Date(run.started_at).toLocaleDateString()}</span>
        {(run.status === 'completed' || run.status === 'partial') && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowReopen(true); }}
            className="text-xs underline text-blue-600 hover:text-blue-800"
          >
            Re-open
          </button>
        )}
      </button>

      {expanded && (
        <div className="border-t p-4">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-3">Loading…</p>
          ) : fullRun ? (
            <div className="space-y-3">
              {fullRun.reopen_reason && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Re-open reason: {fullRun.reopen_reason}
                </p>
              )}
              {Object.entries(
                (fullRun.items ?? []).reduce<Record<string, any[]>>((acc, item) => {
                  if (!acc[item.group_key]) acc[item.group_key] = [];
                  acc[item.group_key].push(item);
                  return acc;
                }, {})
              ).map(([gk, items]) => (
                <div key={gk} className="rounded-md border overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 border-b">
                    <span className="text-xs font-medium">{items[0]?.group_label ?? gk}</span>
                  </div>
                  <div className="divide-y">
                    {items.map((item) => (
                      <div key={item.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                        <span className={`font-medium capitalize ${item.status === 'done' ? 'text-emerald-600' : item.status === 'blocked' ? 'text-red-600' : 'text-slate-600'}`}>
                          {item.status}
                        </span>
                        <span className="text-slate-700">{item.item_title}</span>
                        {item.notes && <span className="text-muted-foreground ml-auto">{item.notes}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {showReopen && (
        <ReopenRunDialog
          onReopen={async (reason: string) => { await onReopen(reason); setShowReopen(false); }}
          onClose={() => setShowReopen(false)}
        />
      )}
    </div>
  );
}
