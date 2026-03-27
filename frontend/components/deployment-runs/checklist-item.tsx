'use client';

import { useState } from 'react';
import { Check, AlertCircle, Clock, Pause, RotateCcw, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type RunItemStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'postponed' | 'skipped';

export type RunItem = {
  id: string;
  group_key: string;
  group_label: string;
  step_index: number;
  item_title: string;
  migration_step: string | null;
  status: RunItemStatus;
  notes: string | null;
  marked_by: string | null;
  marked_at: string | null;
};

type Props = {
  item: RunItem;
  onUpdate: (itemId: string, status: RunItemStatus, notes?: string) => Promise<void>;
  readOnly?: boolean;
};

const STATUS_META: Record<RunItemStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'Pending', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: null },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Play className="h-3 w-3" /> },
  done: { label: 'Done', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <Check className="h-3 w-3" /> },
  blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700 border-red-200', icon: <AlertCircle className="h-3 w-3" /> },
  postponed: { label: 'Postponed', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: <Pause className="h-3 w-3" /> },
  skipped: { label: 'Skipped', color: 'bg-slate-100 text-slate-400 border-slate-200', icon: null },
};

export function ChecklistItem({ item, onUpdate, readOnly = false }: Props) {
  const [noteInput, setNoteInput] = useState('');
  const [pendingStatus, setPendingStatus] = useState<RunItemStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const meta = STATUS_META[item.status];
  const needsNote = pendingStatus === 'blocked' || pendingStatus === 'postponed';

  const handleAction = async (newStatus: RunItemStatus) => {
    if (newStatus === 'blocked' || newStatus === 'postponed') {
      setPendingStatus(newStatus);
      return;
    }
    setSaving(true);
    try {
      await onUpdate(item.id, newStatus);
    } finally {
      setSaving(false);
    }
  };

  const handleNoteSubmit = async () => {
    if (!pendingStatus) return;
    if (!noteInput.trim()) return;
    setSaving(true);
    try {
      await onUpdate(item.id, pendingStatus, noteInput.trim());
      setPendingStatus(null);
      setNoteInput('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(
      'border-b last:border-b-0 px-4 py-3 transition-colors',
      item.status === 'done' ? 'bg-emerald-50/30' : item.status === 'blocked' ? 'bg-red-50/30' : item.status === 'postponed' ? 'bg-amber-50/30' : '',
    )}>
      <div className="flex items-start gap-3">
        {/* Status indicator */}
        <div className={cn(
          'flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] mt-0.5',
          meta.color,
        )}>
          {meta.icon ?? <span>{item.step_index + 1}</span>}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              'text-sm font-medium',
              item.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-800',
            )}>
              {item.item_title}
            </p>
            {!readOnly && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {item.status !== 'done' && (
                  <button
                    onClick={() => handleAction('done')}
                    disabled={saving}
                    title="Mark done"
                    className="h-6 w-6 flex items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                )}
                {item.status === 'pending' && (
                  <button
                    onClick={() => handleAction('in_progress')}
                    disabled={saving}
                    title="Mark in progress"
                    className="h-6 w-6 flex items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                )}
                {item.status !== 'blocked' && (
                  <button
                    onClick={() => handleAction('blocked')}
                    disabled={saving}
                    title="Mark blocked"
                    className="h-6 w-6 flex items-center justify-center rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                  >
                    <AlertCircle className="h-3 w-3" />
                  </button>
                )}
                {item.status !== 'postponed' && (
                  <button
                    onClick={() => handleAction('postponed')}
                    disabled={saving}
                    title="Postpone"
                    className="h-6 w-6 flex items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                  >
                    <Pause className="h-3 w-3" />
                  </button>
                )}
                {item.status !== 'pending' && (
                  <button
                    onClick={() => handleAction('pending')}
                    disabled={saving}
                    title="Reset to pending"
                    className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {item.migration_step && (
            <pre className="text-xs bg-slate-50 rounded px-2 py-1.5 overflow-x-auto font-mono whitespace-pre-wrap break-all text-slate-700 border border-slate-100">
              {item.migration_step}
            </pre>
          )}

          {item.notes && item.status !== 'done' && (
            <p className={cn(
              'text-xs px-2 py-1 rounded border',
              item.status === 'blocked' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200',
            )}>
              <span className="font-medium">Note:</span> {item.notes}
            </p>
          )}

          {item.marked_at && (
            <p className="text-[10px] text-muted-foreground">
              {meta.label} · {new Date(item.marked_at).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Inline note input for blocked/postponed */}
      {pendingStatus && needsNote && (
        <div className="mt-3 ml-8 space-y-2">
          <Textarea
            placeholder={`Why is this step ${pendingStatus}? (required)`}
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            rows={2}
            className="resize-none text-xs"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleNoteSubmit} disabled={!noteInput.trim() || saving} className={cn(
              'h-7 text-xs',
              pendingStatus === 'blocked' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600',
            )}>
              {saving ? 'Saving…' : `Confirm ${pendingStatus}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPendingStatus(null); setNoteInput(''); }} className="h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
