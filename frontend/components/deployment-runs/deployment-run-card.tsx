'use client';

import { useState } from 'react';
import { CheckCircle2, RotateCcw, XCircle, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChecklistGroup } from './checklist-group';
import { ReopenRunDialog } from './reopen-run-dialog';
import type { RunItemStatus } from './checklist-item';

export type DeploymentRun = {
  id: string;
  platform_release_id: string;
  data_center_id: string;
  data_center_name: string | null;
  data_center_slug: string | null;
  environment: string;
  status: string;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  notes: string | null;
  created_at: string;
  items: any[];
  total_items: number;
  done_items: number;
  blocked_items: number;
  pending_items: number;
};

type Props = {
  run: DeploymentRun;
  isActive: boolean;
  onMarkAllDone: () => Promise<void>;
  onComplete: (force: boolean) => Promise<void>;
  onAbort: () => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onUpdateItem: (itemId: string, status: RunItemStatus, notes?: string) => Promise<void>;
};

const RUN_STATUS_BADGE: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  aborted: 'bg-red-100 text-red-700 border-red-200',
  pending: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function DeploymentRunCard({ run, isActive, onMarkAllDone, onComplete, onAbort, onReopen, onUpdateItem }: Props) {
  const [showReopen, setShowReopen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const progressPct = run.total_items > 0 ? Math.round((run.done_items / run.total_items) * 100) : 0;
  const canComplete = isActive && run.pending_items === 0;
  const readOnly = !isActive;

  // Group items by group_key
  const groups: Record<string, any[]> = {};
  for (const item of (run.items ?? [])) {
    if (!groups[item.group_key]) groups[item.group_key] = [];
    groups[item.group_key].push(item);
  }
  const groupEntries = Object.entries(groups);

  const handleComplete = async () => {
    if (run.blocked_items > 0 && !confirmComplete) {
      setConfirmComplete(true);
      return;
    }
    setCompleting(true);
    try {
      await onComplete(confirmComplete);
      setConfirmComplete(false);
    } finally {
      setCompleting(false);
    }
  };

  const handleMarkAllDone = async () => {
    setMarkingAll(true);
    try { await onMarkAllDone(); } finally { setMarkingAll(false); }
  };

  const handleAbort = async () => {
    if (!window.confirm('Abort this deployment run? Enter a reason in the notes.')) return;
    setAborting(true);
    try { await onAbort(); } finally { setAborting(false); }
  };

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      {/* Run header */}
      <div className="px-5 py-4 border-b bg-slate-50 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900">
                {run.data_center_name ?? run.data_center_slug ?? run.data_center_id}
              </span>
              <span className="text-slate-400">·</span>
              <span className="capitalize text-sm text-slate-600">{run.environment}</span>
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border',
                RUN_STATUS_BADGE[run.status] ?? 'bg-slate-100 text-slate-600',
              )}>
                {run.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Started {new Date(run.started_at).toLocaleString()}
              {run.completed_at && ` · Completed ${new Date(run.completed_at).toLocaleString()}`}
            </p>
          </div>

          {isActive && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleMarkAllDone}
                disabled={markingAll || run.pending_items === 0}
                className="h-7 text-xs"
              >
                <Check className="mr-1 h-3 w-3" />
                {markingAll ? 'Marking…' : 'Mark All Done'}
              </Button>
              <Button
                size="sm"
                onClick={handleComplete}
                disabled={(!canComplete && !confirmComplete) || completing}
                className={cn('h-7 text-xs', run.blocked_items > 0 ? 'bg-amber-500 hover:bg-amber-600' : '')}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {completing ? 'Completing…' : confirmComplete ? `Complete anyway (${run.blocked_items} blocked)` : 'Complete Deployment'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAbort}
                disabled={aborting}
                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
              >
                <XCircle className="mr-1 h-3 w-3" />
                Abort
              </Button>
            </div>
          )}

          {!isActive && (run.status === 'completed' || run.status === 'partial') && (
            <Button size="sm" variant="outline" onClick={() => setShowReopen(true)} className="h-7 text-xs">
              <RotateCcw className="mr-1 h-3 w-3" />
              Re-open
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {run.total_items > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{run.done_items} / {run.total_items} steps done</span>
              {run.blocked_items > 0 && (
                <span className="text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {run.blocked_items} blocked
                </span>
              )}
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', run.blocked_items > 0 ? 'bg-amber-500' : 'bg-emerald-500')}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Re-open notice */}
        {run.reopened_at && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-medium">Re-opened</span> {new Date(run.reopened_at).toLocaleString()}
            {run.reopen_reason && ` · ${run.reopen_reason}`}
          </div>
        )}
      </div>

      {/* Checklist body */}
      <div className="p-4 space-y-4">
        {run.total_items === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No deployment steps were found in the release plan. Ensure Release Notes have deployment steps before generating the plan.
          </p>
        ) : (
          groupEntries.map(([groupKey, items]) => (
            <ChecklistGroup
              key={groupKey}
              groupKey={groupKey}
              groupLabel={items[0]?.group_label ?? groupKey}
              items={items}
              onUpdate={onUpdateItem}
              readOnly={readOnly}
            />
          ))
        )}
      </div>

      {showReopen && (
        <ReopenRunDialog
          onReopen={async (reason) => { await onReopen(reason); setShowReopen(false); }}
          onClose={() => setShowReopen(false)}
        />
      )}
    </div>
  );
}
