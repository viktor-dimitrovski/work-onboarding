'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Calendar, ChevronRight, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type PlannedRelease = {
  id: string;
  name: string;
  release_type: string;
  status: string;
  environment: string | null;
  planned_start: string | null;
  planned_end: string | null;
  planning_notes: string | null;
  data_center_name: string | null;
  work_order_count: number;
  created_at: string;
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

const TYPE_LABELS: Record<string, string> = {
  quarterly: 'Quarterly', ad_hoc: 'Ad-hoc', security: 'Security', bugfix: 'Bug Fix',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function groupByMonth(releases: PlannedRelease[]): Record<string, PlannedRelease[]> {
  const groups: Record<string, PlannedRelease[]> = {};
  const unscheduled: PlannedRelease[] = [];

  for (const r of releases) {
    if (!r.planned_start) {
      unscheduled.push(r);
      continue;
    }
    const d = new Date(r.planned_start);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  if (unscheduled.length) groups['unscheduled'] = unscheduled;
  return groups;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'TBD';
  const s = new Date(start);
  const label = `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} ${s.getFullYear()}`;
  if (!end) return label;
  const e = new Date(end);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} ${s.getFullYear()}`;
  }
  return `${label} → ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
}

export default function ReleaseCalendarPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const router = useRouter();
  const [releases, setReleases] = useState<PlannedRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showInsertDialog, setShowInsertDialog] = useState<string | null>(null); // insertBefore ID

  const canWrite = hasModule('releases') && hasPermission('releases:write');
  const canRead = hasModule('releases') && hasPermission('releases:read');

  const load = async () => {
    if (!accessToken || !canRead) return;
    setLoading(true);
    try {
      const data = await api.get<{ items: PlannedRelease[] }>(
        '/platform-releases?view=calendar&page_size=200',
        accessToken,
      );
      // Sort by planned_start, null last
      const sorted = [...(data.items ?? [])].sort((a, b) => {
        if (!a.planned_start && !b.planned_start) return 0;
        if (!a.planned_start) return 1;
        if (!b.planned_start) return -1;
        return new Date(a.planned_start).getTime() - new Date(b.planned_start).getTime();
      });
      setReleases(sorted);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [accessToken, canRead]);

  const selectedRelease = releases.find((r) => r.id === selectedId) ?? null;
  const grouped = groupByMonth(releases);

  const handlePromote = async (id: string) => {
    if (!accessToken) return;
    await api.post(`/platform-releases/${id}/promote`, {}, accessToken);
    await load();
    router.push(`/platform-releases/${id}`);
  };

  const handleSaveField = async (id: string, field: string, value: string | null) => {
    if (!accessToken) return;
    await api.patch(`/platform-releases/${id}`, { [field]: value || null }, accessToken);
    await load();
  };

  const groupKeys = Object.keys(grouped).filter((k) => k !== 'unscheduled');
  const sortedGroupKeys = groupKeys.sort();

  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-slate-500" />
            Release Calendar
          </h1>
          <p className="text-sm text-muted-foreground">Plan and schedule upcoming releases</p>
        </div>
        {canWrite && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Plan Release
          </Button>
        )}
      </div>

      <div className="flex gap-5">
        {/* Timeline */}
        <div className="flex-1 space-y-6">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading calendar…</div>
          )}

          {!loading && releases.length === 0 && (
            <div className="py-12 text-center space-y-3">
              <Calendar className="h-8 w-8 mx-auto text-slate-300" />
              <p className="text-sm text-muted-foreground">No releases planned yet.</p>
              {canWrite && (
                <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Plan first release
                </Button>
              )}
            </div>
          )}

          {sortedGroupKeys.map((key) => {
            const [year, monthIdx] = key.split('-').map(Number);
            const monthLabel = `${MONTHS[monthIdx]} ${year}`;
            return (
              <div key={key}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{monthLabel}</h2>
                <div className="space-y-1.5">
                  {grouped[key].map((rel) => (
                    <CalendarRow
                      key={rel.id}
                      release={rel}
                      isSelected={selectedId === rel.id}
                      onSelect={() => setSelectedId(selectedId === rel.id ? null : rel.id)}
                      onInsertBefore={canWrite ? () => setShowInsertDialog(rel.id) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Unscheduled */}
          {grouped['unscheduled'] && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Unscheduled</h2>
              <div className="space-y-1.5">
                {grouped['unscheduled'].map((rel) => (
                  <CalendarRow
                    key={rel.id}
                    release={rel}
                    isSelected={selectedId === rel.id}
                    onSelect={() => setSelectedId(selectedId === rel.id ? null : rel.id)}
                    onInsertBefore={undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedRelease && (
          <DetailPanel
            release={selectedRelease}
            onClose={() => setSelectedId(null)}
            onSaveField={handleSaveField}
            onPromote={handlePromote}
            canWrite={canWrite}
          />
        )}
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <PlanReleaseDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={async (id) => { setShowCreateDialog(false); await load(); setSelectedId(id); }}
          accessToken={accessToken}
          insertBefore={null}
        />
      )}

      {/* Insert ad-hoc before dialog */}
      {showInsertDialog && (
        <PlanReleaseDialog
          onClose={() => setShowInsertDialog(null)}
          onCreated={async (id) => { setShowInsertDialog(null); await load(); setSelectedId(id); }}
          accessToken={accessToken}
          insertBefore={releases.find((r) => r.id === showInsertDialog) ?? null}
        />
      )}
    </div>
  );
}

function CalendarRow({
  release,
  isSelected,
  onSelect,
  onInsertBefore,
}: {
  release: PlannedRelease;
  isSelected: boolean;
  onSelect: () => void;
  onInsertBefore?: () => void;
}) {
  const isAdHoc = release.release_type === 'ad_hoc' || release.release_type === 'security';

  return (
    <div className={cn(
      'group flex items-center gap-3 rounded-lg border px-4 py-2.5 cursor-pointer transition-colors text-sm',
      isSelected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
    )} onClick={onSelect}>
      <span className={cn('text-base flex-shrink-0', isAdHoc ? 'text-amber-500' : 'text-slate-400')}>
        {isAdHoc ? '★' : '●'}
      </span>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-800 truncate">{release.name}</span>
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide rounded-full border px-1.5 py-0.5',
            STATUS_COLORS[release.status] ?? 'bg-slate-100 text-slate-600',
          )}>
            {STATUS_LABELS[release.status] ?? release.status}
          </span>
          {isAdHoc && <span className="text-[10px] text-amber-600 font-medium">AD-HOC</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>{formatDateRange(release.planned_start, release.planned_end)}</span>
          {release.work_order_count > 0 && (
            <span>{release.work_order_count} WO{release.work_order_count !== 1 ? 's' : ''}</span>
          )}
          {release.data_center_name && <span>📍 {release.data_center_name}</span>}
        </div>
      </div>
      {onInsertBefore && (
        <button
          onClick={(e) => { e.stopPropagation(); onInsertBefore(); }}
          className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:underline flex-shrink-0 transition-opacity"
        >
          Insert ad-hoc before
        </button>
      )}
    </div>
  );
}

function DetailPanel({
  release,
  onClose,
  onSaveField,
  onPromote,
  canWrite,
}: {
  release: PlannedRelease;
  onClose: () => void;
  onSaveField: (id: string, field: string, value: string | null) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(release.name);
  const [plannedStart, setPlannedStart] = useState(release.planned_start ?? '');
  const [plannedEnd, setPlannedEnd] = useState(release.planned_end ?? '');
  const [planningNotes, setPlanningNotes] = useState(release.planning_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);

  // Reset when release changes
  useEffect(() => {
    setName(release.name);
    setPlannedStart(release.planned_start ?? '');
    setPlannedEnd(release.planned_end ?? '');
    setPlanningNotes(release.planning_notes ?? '');
  }, [release.id]);

  const save = async (field: string, value: string | null) => {
    setSaving(true);
    try { await onSaveField(release.id, field, value); } finally { setSaving(false); }
  };

  return (
    <div className="w-80 flex-shrink-0 rounded-xl border bg-white shadow-sm overflow-hidden self-start sticky top-6">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
        <span className="text-sm font-semibold text-slate-800 truncate">{release.name}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Status + type */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5',
            STATUS_COLORS[release.status] ?? 'bg-slate-100 text-slate-600',
          )}>
            {STATUS_LABELS[release.status] ?? release.status}
          </span>
          <span className="text-xs text-muted-foreground">{TYPE_LABELS[release.release_type] ?? release.release_type}</span>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Name</label>
            {canWrite ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => { if (name !== release.name) save('name', name); }}
                className="mt-1 h-8 text-sm"
              />
            ) : (
              <p className="text-sm text-slate-700 mt-0.5">{release.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Window Start</label>
              {canWrite ? (
                <Input
                  type="date"
                  value={plannedStart}
                  onChange={(e) => setPlannedStart(e.target.value)}
                  onBlur={() => save('planned_start', plannedStart || null)}
                  className="mt-1 h-8 text-xs"
                />
              ) : (
                <p className="text-xs text-slate-700 mt-0.5">{release.planned_start ?? '—'}</p>
              )}
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Window End</label>
              {canWrite ? (
                <Input
                  type="date"
                  value={plannedEnd}
                  onChange={(e) => setPlannedEnd(e.target.value)}
                  onBlur={() => save('planned_end', plannedEnd || null)}
                  className="mt-1 h-8 text-xs"
                />
              ) : (
                <p className="text-xs text-slate-700 mt-0.5">{release.planned_end ?? '—'}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Planning Notes</label>
            {canWrite ? (
              <Textarea
                value={planningNotes}
                onChange={(e) => setPlanningNotes(e.target.value)}
                onBlur={() => save('planning_notes', planningNotes || null)}
                rows={3}
                className="mt-1 text-xs resize-none"
                placeholder="High-level goals, scope, notes…"
              />
            ) : (
              <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap">{release.planning_notes ?? '—'}</p>
            )}
          </div>
        </div>

        {saving && <p className="text-[10px] text-muted-foreground text-right">Saving…</p>}

        {/* Actions */}
        <div className="space-y-2 pt-2 border-t">
          <Button
            className="w-full h-8 text-xs"
            onClick={() => router.push(`/platform-releases/${release.id}`)}
            variant="outline"
          >
            Open Full Release
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>

          {release.status === 'planned' && canWrite && (
            <Button
              className="w-full h-8 text-xs"
              onClick={async () => { setPromoting(true); try { await onPromote(release.id); } finally { setPromoting(false); } }}
              disabled={promoting}
            >
              {promoting ? 'Promoting…' : 'Promote to Draft →'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanReleaseDialog({
  onClose,
  onCreated,
  accessToken,
  insertBefore,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  accessToken: string | null;
  insertBefore: PlannedRelease | null;
}) {
  const [name, setName] = useState('');
  const [releaseType, setReleaseType] = useState('quarterly');
  const [plannedStart, setPlannedStart] = useState(() => {
    if (insertBefore?.planned_start) {
      const d = new Date(insertBefore.planned_start);
      d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    }
    return '';
  });
  const [plannedEnd, setPlannedEnd] = useState('');
  const [planningNotes, setPlanningNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !accessToken) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await api.post<{ id: string }>('/platform-releases', {
        name: name.trim(),
        release_type: releaseType,
        status: 'planned',
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        planning_notes: planningNotes || null,
      }, accessToken);
      await onCreated(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create release');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {insertBefore ? `Insert Ad-hoc Before "${insertBefore.name}"` : 'Plan New Release'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create a lightweight release placeholder. Add details anytime before promoting to draft.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Name / Code *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3-2026 — Platform Refresh" autoFocus />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Type</label>
            <div className="flex gap-2">
              {[['quarterly', 'Quarterly'], ['ad_hoc', 'Ad-hoc'], ['security', 'Security'], ['bugfix', 'Bug Fix']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setReleaseType(val)}
                  className={cn(
                    'flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors',
                    releaseType === val ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Window Start</label>
              <Input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Window End</label>
              <Input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Planning Notes (optional)</label>
            <Textarea
              value={planningNotes}
              onChange={(e) => setPlanningNotes(e.target.value)}
              rows={2}
              className="resize-none text-xs"
              placeholder="High-level goals, scope…"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600 rounded-md bg-red-50 border border-red-200 px-3 py-2">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create Planned Release'}
          </Button>
        </div>
      </div>
    </div>
  );
}
