'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  RefreshCw,
  Rocket,
  X,
  ArrowRight,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type ReleaseCenterItem = {
  id: string;
  name: string;
  release_type: string;
  status: string;
  environment: string | null;
  data_center_id: string | null;
  data_center_name: string | null;
  data_center_slug: string | null;
  planned_start: string | null;
  planned_end: string | null;
  planning_notes: string | null;
  work_order_count: number;
  cab_approver_id: string | null;
  cab_approved_at: string | null;
  generated_at: string | null;
  deployed_at: string | null;
  created_at: string;
  next_action: string | null;
  waiting_on: {type: string; approver_id?: string; count?: number; run_id?: string} | null;
  days_to_window: number | null;
  active_run_id: string | null;
  active_run_progress: {total: number; done: number; blocked: number} | null;
};

type CenterSummary = {
  in_flight: ReleaseCenterItem[];
  planned: ReleaseCenterItem[];
  recently_closed: ReleaseCenterItem[];
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-600 border-slate-200',
  draft: 'bg-blue-100 text-blue-700 border-blue-200',
  preparation: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  cab_approved: 'bg-violet-100 text-violet-700 border-violet-200',
  deploying: 'bg-amber-100 text-amber-700 border-amber-200',
  deployed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned', draft: 'Draft', preparation: 'Preparation',
  cab_approved: 'CAB Approved', deploying: 'Deploying', deployed: 'Deployed', closed: 'Closed',
};

const TRAJECTORY_STEPS = ['draft', 'preparation', 'cab_approved', 'deploying', 'deployed', 'closed'];
const TRAJECTORY_LABELS: Record<string, string> = {
  draft: 'Draft', preparation: 'Prep', cab_approved: 'CAB', deploying: 'Deploy', deployed: 'Done', closed: 'Closed',
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  add_work_orders: 'Add Work Orders',
  generate_plan: 'Generate Release Plan',
  assign_approver: 'Assign CAB Approver',
  request_cab_approval: 'Request CAB Approval',
  awaiting_cab_approval: 'Awaiting CAB Approval',
  start_deployment: 'Start Deployment Run',
  deployment_in_progress: 'Deployment in Progress',
  deployment_blocked: 'Deployment Blocked!',
  close_release: 'Ready to Close',
};

function TrajectoryStrip({ status, blocked }: { status: string; blocked: boolean }) {
  const currentIdx = TRAJECTORY_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-0 overflow-hidden">
      {TRAJECTORY_STEPS.map((step, idx) => {
        const isDone = idx < currentIdx;
        const isActive = idx === currentIdx;
        const isBlocked = isActive && blocked;
        return (
          <div key={step} className="flex items-center">
            <div className={cn(
              'flex items-center justify-center rounded px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide transition-all',
              isDone ? 'bg-emerald-500 text-white' :
              isBlocked ? 'bg-red-500 text-white animate-pulse' :
              isActive ? 'bg-blue-500 text-white' :
              'bg-slate-100 text-slate-400',
            )}>
              {TRAJECTORY_LABELS[step]}
            </div>
            {idx < TRAJECTORY_STEPS.length - 1 && (
              <div className={cn(
                'h-0.5 w-2',
                isDone ? 'bg-emerald-400' : 'bg-slate-200',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InFlightCard({ item, onRefresh }: { item: ReleaseCenterItem; onRefresh: () => void }) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [actionLoading, setActionLoading] = useState(false);
  const isBlocked = item.next_action === 'deployment_blocked';
  const progress = item.active_run_progress;

  const handleQuickAction = async (action: string) => {
    if (!accessToken) return;
    setActionLoading(true);
    try {
      if (action === 'approve_cab') {
        await api.post(`/platform-releases/${item.id}/approve-cab`, {}, accessToken);
      } else if (action === 'close') {
        await api.post(`/platform-releases/${item.id}/close`, {}, accessToken);
      }
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className={cn(
      'rounded-xl border bg-white shadow-sm overflow-hidden',
      isBlocked ? 'border-red-300' : '',
    )}>
      {/* Status banner */}
      {isBlocked && (
        <div className="flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Deployment blocked — {item.active_run_progress?.blocked ?? 0} item(s) require attention</span>
          {item.active_run_id && (
            <Link href={`/platform-releases/${item.id}?tab=deployment-runs`} className="ml-auto underline font-medium">
              View run →
            </Link>
          )}
        </div>
      )}

      <div className="px-5 py-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5',
                STATUS_COLORS[item.status] ?? 'bg-slate-100 text-slate-600',
              )}>
                {STATUS_LABELS[item.status] ?? item.status}
              </span>
              <h3 className="font-semibold text-slate-900">{item.name}</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {item.data_center_name && <span>📍 {item.data_center_name}</span>}
              {item.environment && <span className="capitalize">🌐 {item.environment}</span>}
              {item.work_order_count > 0 && <span>{item.work_order_count} WOs</span>}
              {item.planned_start && <span>📅 {new Date(item.planned_start).toLocaleDateString()}</span>}
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/platform-releases/${item.id}`)}
            className="h-7 text-xs"
          >
            Open Release
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>

        {/* Trajectory */}
        <TrajectoryStrip status={item.status} blocked={isBlocked} />

        {/* Progress bar (when deploying) */}
        {progress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Deployment Progress</span>
              <span>{progress.done}/{progress.total} steps</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', progress.blocked > 0 ? 'bg-red-400' : 'bg-emerald-500')}
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Next action */}
        {item.next_action && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Clock className={cn('h-3.5 w-3.5', isBlocked ? 'text-red-500' : 'text-blue-500')} />
              <span className={cn('font-medium', isBlocked ? 'text-red-700' : '')}>
                Next: {NEXT_ACTION_LABELS[item.next_action] ?? item.next_action}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {item.next_action === 'approve_cab' || item.status === 'preparation' ? (
                <Button size="sm" variant="outline" onClick={() => handleQuickAction('approve_cab')} disabled={actionLoading} className="h-6 text-[10px] px-2">
                  Approve CAB
                </Button>
              ) : null}
              {item.next_action === 'close_release' ? (
                <Button size="sm" variant="outline" onClick={() => handleQuickAction('close')} disabled={actionLoading} className="h-6 text-[10px] px-2">
                  Close Release
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlannedRow({ item }: { item: ReleaseCenterItem }) {
  const router = useRouter();
  const daysLabel = item.days_to_window !== null
    ? item.days_to_window < 0
      ? `${Math.abs(item.days_to_window)} days overdue`
      : item.days_to_window === 0
      ? 'Today'
      : `in ${item.days_to_window} days`
    : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 hover:border-slate-300 transition-colors">
      <Calendar className="h-4 w-4 text-slate-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {item.planned_start ? new Date(item.planned_start).toLocaleDateString() : 'Date TBD'}
          {daysLabel && ` · ${daysLabel}`}
        </p>
      </div>
      <button
        onClick={() => router.push(`/platform-releases/${item.id}`)}
        className="text-xs text-blue-600 hover:underline flex-shrink-0"
      >
        View
      </button>
    </div>
  );
}

export default function ReleaseCenterPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const [summary, setSummary] = useState<CenterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dismissedAlert, setDismissedAlert] = useState(false);

  const canRead = hasModule('releases') && hasPermission('releases:read');

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    try {
      const data = await api.get<CenterSummary>('/platform-releases/center-summary', accessToken);
      setSummary(data);
      setLastUpdated(new Date());
    } catch {
      // silent refresh failure
    } finally {
      setLoading(false);
    }
  }, [accessToken, canRead]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const blockedReleases = summary?.in_flight.filter((r) => r.next_action === 'deployment_blocked') ?? [];
  const showAlert = !dismissedAlert && blockedReleases.length > 0;

  return (
    <div className="container mx-auto max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-slate-500" />
            Release Center
          </h1>
          <p className="text-xs text-muted-foreground">
            Operations dashboard · Updated {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} className="h-8 text-xs gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Attention banner */}
      {showAlert && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800">Action Required</p>
            <p className="text-xs text-red-700 mt-0.5">
              {blockedReleases.length} release{blockedReleases.length !== 1 ? 's' : ''} have blocked deployment items:
            </p>
            <ul className="mt-1 space-y-0.5">
              {blockedReleases.map((r) => (
                <li key={r.id}>
                  <Link href={`/platform-releases/${r.id}?tab=deployment-runs`} className="text-xs text-red-700 underline font-medium">
                    {r.name} → {r.active_run_progress?.blocked ?? 0} blocked item(s)
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <button onClick={() => setDismissedAlert(true)} className="text-red-400 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      )}

      {!loading && summary && (
        <>
          {/* In Flight */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">In Flight</h2>
              <span className="text-xs text-muted-foreground">({summary.in_flight.length})</span>
            </div>
            {summary.in_flight.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center rounded-lg border border-dashed border-slate-200 bg-white">
                No releases currently in flight.
              </p>
            ) : (
              <div className="space-y-4">
                {summary.in_flight.map((item) => (
                  <InFlightCard key={item.id} item={item} onRefresh={load} />
                ))}
              </div>
            )}
          </section>

          {/* Planned Upcoming */}
          {summary.planned.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Planned Upcoming ({summary.planned.length})
                </h2>
                <Link href="/release-calendar" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  View Calendar <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="space-y-1.5">
                {summary.planned.map((item) => (
                  <PlannedRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* Recently Closed */}
          {summary.recently_closed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recently Closed</h2>
              <div className="space-y-1.5">
                {summary.recently_closed.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 opacity-70">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {item.status} {item.deployed_at ? `· ${new Date(item.deployed_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <Link href={`/platform-releases/${item.id}`} className="text-xs text-blue-600 hover:underline">
                      View
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.in_flight.length === 0 && summary.planned.length === 0 && summary.recently_closed.length === 0 && (
            <div className="py-16 text-center space-y-3">
              <Rocket className="h-10 w-10 mx-auto text-slate-300" />
              <p className="text-sm text-muted-foreground">No releases found. Create your first release to get started.</p>
              <Link href="/platform-releases">
                <Button variant="outline" size="sm">Go to Platform Releases</Button>
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
