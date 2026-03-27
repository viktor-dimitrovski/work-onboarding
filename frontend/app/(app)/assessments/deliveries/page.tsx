'use client';

import { useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MultiSelect } from '@/components/inputs/multi-select';
import { SingleSelect } from '@/components/inputs/single-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentAttempt, AssessmentDelivery, AssessmentTest, UserRow } from '@/lib/types';
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock, Info, MoreVertical, Pencil, PlusCircle, RefreshCw, Send, Square, User, Users, X, XCircle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface AttemptStatus {
  status: 'not_started' | 'in_progress' | 'completed';
  score_percent: number | null;
  passed: boolean | null;
  attempt_count: number;
}

interface ResultsResponse {
  items: AssessmentAttempt[];
  summary: { attempt_count: number; average_score_percent?: number | null };
}

interface DeliveryListResponse {
  items: AssessmentDelivery[];
  meta: { page: number; page_size: number; total: number };
}

interface TestListResponse {
  items: AssessmentTest[];
  meta: { page: number; page_size: number; total: number };
}

interface UserListResponse {
  items: UserRow[];
  meta: { page: number; page_size: number; total: number };
}

// ── Grouping ──────────────────────────────────────────────────────────────────
// Deliveries that share the same test version, time window, and limits are
// treated as one "batch" — they were assigned together and should look like one
// row instead of N identical rows.

function groupKey(d: AssessmentDelivery): string {
  // ends_at is intentionally excluded: it changes when a delivery is stopped,
  // which would split a group into N separate rows after stop.
  return [
    d.test_version_id,
    d.audience_type,
    d.starts_at ?? '',
    d.attempts_allowed,
    d.duration_minutes ?? '',
  ].join('|');
}

interface DeliveryGroup {
  key: string;
  deliveries: AssessmentDelivery[];
  rep: AssessmentDelivery; // representative (first) for display
}

function buildGroups(deliveries: AssessmentDelivery[]): DeliveryGroup[] {
  const map = new Map<string, AssessmentDelivery[]>();
  for (const d of deliveries) {
    const k = groupKey(d);
    const arr = map.get(k) ?? [];
    arr.push(d);
    map.set(k, arr);
  }
  return Array.from(map.values()).map((items) => ({
    key: groupKey(items[0]),
    deliveries: items,
    rep: items[0],
  }));
}

// ── Delivery status helper ────────────────────────────────────────────────────

type DeliveryStatus = 'active' | 'no-deadline' | 'scheduled' | 'closed';

function getDeliveryStatus(d: AssessmentDelivery): DeliveryStatus {
  const now = new Date();
  if (d.ends_at && new Date(d.ends_at) <= now) return 'closed';
  if (d.starts_at && new Date(d.starts_at) > now) return 'scheduled';
  if (!d.ends_at) return 'no-deadline';
  return 'active';
}

// For grouped rows, show the most active status across all deliveries in the group.
// Priority: active > no-deadline > scheduled > closed
function getGroupStatus(group: DeliveryGroup): DeliveryStatus {
  const statuses = group.deliveries.map(getDeliveryStatus);
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('no-deadline')) return 'no-deadline';
  if (statuses.includes('scheduled')) return 'scheduled';
  return 'closed';
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; className: string }> = {
  active:        { label: 'Active',        className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  'no-deadline': { label: 'Open (no end)', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  scheduled:     { label: 'Scheduled',     className: 'border-amber-200 bg-amber-50 text-amber-700' },
  closed:        { label: 'Closed',        className: 'border-slate-200 bg-slate-100 text-slate-500' },
};

// ── Date/time helpers ─────────────────────────────────────────────────────────

const fmtDateTime = (d?: string | null) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return d; }
};


function isoToLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── DateTimeInput component ───────────────────────────────────────────────────

function localNow(): string {
  return isoToLocal(new Date().toISOString());
}
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}
function localDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DateTimeInput({
  value,
  onChange,
  label,
  hint,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  hint?: string;
  presets?: Array<{ label: string; getValue: () => string }>;
}) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs font-medium'>{label}</Label>
        {value && (
          <button
            type='button'
            onClick={() => onChange('')}
            className='inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-destructive'
          >
            <X className='h-2.5 w-2.5' />
            Clear
          </button>
        )}
      </div>
      {hint && <p className='text-[10px] text-muted-foreground'>{hint}</p>}
      <div className='relative'>
        <CalendarDays className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
        <Input
          type='datetime-local'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className='h-8 pl-8 text-xs'
        />
      </div>
      {presets && presets.length > 0 && (
        <div className='flex flex-wrap gap-1 pt-0.5'>
          {presets.map((p) => (
            <button
              key={p.label}
              type='button'
              onClick={() => onChange(p.getValue())}
              className='rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors'
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const OPEN_PRESETS = [
  { label: 'Now',       getValue: localNow },
  { label: 'Today',     getValue: localToday },
  { label: '+1 day',    getValue: () => localDaysFromNow(1) },
  { label: '+1 week',   getValue: () => localDaysFromNow(7) },
];
const CLOSE_PRESETS = [
  { label: '+1 day',    getValue: () => localDaysFromNow(1) },
  { label: '+3 days',   getValue: () => localDaysFromNow(3) },
  { label: '+1 week',   getValue: () => localDaysFromNow(7) },
  { label: '+2 weeks',  getValue: () => localDaysFromNow(14) },
  { label: '+1 month',  getValue: () => localDaysFromNow(30) },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssessmentDeliveriesPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<AssessmentDelivery[]>([]);
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersError, setUsersError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Per-delivery attempt status (fetched lazily)
  const [attemptStatusMap, setAttemptStatusMap] = useState<Record<string, AttemptStatus>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  // Expanded groups (for multi-person rows)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Create sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState('');

  // Extend time dialog — deliveryId + extra minutes input
  const [extendTarget, setExtendTarget] = useState<{ deliveryId: string; userName: string } | null>(null);
  const [extendMinutes, setExtendMinutes] = useState(15);
  const [extendLoading, setExtendLoading] = useState(false);
  const [extendResult, setExtendResult] = useState<string | null>(null);

  // Grant re-take dialog
  const [retakeTarget, setRetakeTarget] = useState<{ deliveryId: string; userName: string } | null>(null);
  const [retakeLoading, setRetakeLoading] = useState(false);

  // Edit sheet — now operates on an entire group
  const [editGroup, setEditGroup] = useState<DeliveryGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editStartsAt, setEditStartsAt] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editAttempts, setEditAttempts] = useState(1);
  const [editDuration, setEditDuration] = useState<number | ''>('');

  // Create form fields
  const [testVersionId, setTestVersionId] = useState('');
  const [audienceType, setAudienceType] = useState<'assignment' | 'campaign'>('assignment');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [attemptsAllowed, setAttemptsAllowed] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [deliveryRes, testsRes] = await Promise.all([
        api.get<DeliveryListResponse>('/assessments/deliveries?page=1&page_size=100', accessToken),
        api.get<TestListResponse>('/assessments/tests?page=1&page_size=100&status=published', accessToken),
      ]);
      setDeliveries(deliveryRes.items);
      setTests(testsRes.items);
      setUsersError(false);
      try {
        const usersRes = await api.get<UserListResponse>('/users?page=1&page_size=100', accessToken);
        setUsers(usersRes.items.filter((u) => u.tenant_status !== 'disabled'));
      } catch {
        setUsersError(true);
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Lightweight refresh — only deliveries, no full page reload spinner.
  // Used after stop/edit so tests and users don't get needlessly re-fetched.
  const reloadDeliveries = async () => {
    if (!accessToken) return;
    try {
      const res = await api.get<DeliveryListResponse>('/assessments/deliveries?page=1&page_size=100', accessToken);
      setDeliveries(res.items);
    } catch {
      // ignore — stale data is better than a crash
    }
  };

  useEffect(() => { void load(); }, [accessToken]);

  // Fetch attempt status for a list of delivery IDs (concurrent, skip already-fetched).
  const fetchAttemptStatuses = async (deliveryIds: string[]) => {
    if (!accessToken) return;
    const toFetch = deliveryIds.filter((id) => !attemptStatusMap[id] && !fetchingRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => fetchingRef.current.add(id));

    const results = await Promise.allSettled(
      toFetch.map((id) =>
        api.get<ResultsResponse>(`/assessments/results?delivery_id=${id}`, accessToken)
          .then((res) => ({ id, attempts: res.items })),
      ),
    );

    const updates: Record<string, AttemptStatus> = {};
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { id, attempts } = r.value;
      if (attempts.length === 0) {
        updates[id] = { status: 'not_started', score_percent: null, passed: null, attempt_count: 0 };
      } else {
        const scored = attempts.filter((a) => a.status === 'scored' || a.status === 'submitted');
        const inProgress = attempts.some((a) => a.status === 'in_progress');
        const best = [...scored].sort((a, b) => (b.score_percent ?? 0) - (a.score_percent ?? 0))[0];
        updates[id] = {
          status: scored.length > 0 ? 'completed' : inProgress ? 'in_progress' : 'not_started',
          score_percent: best?.score_percent ?? null,
          passed: best?.passed ?? null,
          attempt_count: attempts.length,
        };
      }
      fetchingRef.current.delete(id);
    }
    setAttemptStatusMap((prev) => ({ ...prev, ...updates }));
  };

  // Auto-fetch attempt status for all single-person delivery rows after load.
  useEffect(() => {
    if (!accessToken || deliveries.length === 0) return;
    const singleGroupIds = buildGroups(deliveries)
      .filter((g) => g.deliveries.length === 1 && g.rep.audience_type === 'assignment')
      .map((g) => g.rep.id);
    void fetchAttemptStatuses(singleGroupIds);
  }, [deliveries, accessToken]);

  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  const groups = buildGroups(deliveries);

  const publishedVersionOptions = tests.flatMap((test) =>
    test.versions
      .filter((v) => v.status === 'published')
      .map((v) => ({ value: v.id, label: `${test.title} v${v.version_number}` })),
  );

  const userOptions = users.map((u) => ({
    value: u.id,
    label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
  }));

  // ── Create ─────────────────────────────────────────────────────────────────

  const resetCreate = () => {
    setTestVersionId(''); setAudienceType('assignment'); setSelectedUserIds([]);
    setAttemptsAllowed(1); setDurationMinutes(''); setStartsAt(''); setEndsAt('');
    setCreateError(null); setCreateProgress('');
  };

  const createDeliveries = async () => {
    if (!accessToken || !testVersionId) return;
    setCreating(true); setCreateError(null);
    try {
      if (audienceType === 'campaign') {
        await api.post('/assessments/deliveries', {
          test_version_id: testVersionId,
          audience_type: 'campaign',
          attempts_allowed: attemptsAllowed,
          duration_minutes: durationMinutes || null,
          starts_at: startsAt || null,
          ends_at: endsAt || null,
          due_date: endsAt ? endsAt.split('T')[0] : null,
        }, accessToken);
      } else {
        const ids = selectedUserIds.length > 0 ? selectedUserIds : [null];
        for (let i = 0; i < ids.length; i++) {
          setCreateProgress(`Creating ${i + 1} of ${ids.length}...`);
          await api.post('/assessments/deliveries', {
            test_version_id: testVersionId,
            audience_type: 'assignment',
            participant_user_id: ids[i],
            attempts_allowed: attemptsAllowed,
            duration_minutes: durationMinutes || null,
            starts_at: startsAt || null,
            ends_at: endsAt || null,
            due_date: endsAt ? endsAt.split('T')[0] : null,
          }, accessToken);
        }
      }
      setCreateOpen(false); resetCreate(); await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create delivery');
    } finally {
      setCreating(false); setCreateProgress('');
    }
  };

  // ── Edit (applies to all deliveries in the group) ──────────────────────────

  const openEdit = (group: DeliveryGroup) => {
    const d = group.rep;
    setEditGroup(group);
    setEditStartsAt(isoToLocal(d.starts_at));
    setEditEndsAt(isoToLocal(d.ends_at));
    setEditDueDate(d.due_date ?? '');
    setEditAttempts(d.attempts_allowed);
    setEditDuration(d.duration_minutes ?? '');
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!accessToken || !editGroup) return;
    setSaving(true); setEditError(null);
    try {
      for (const d of editGroup.deliveries) {
        await api.patch(`/assessments/deliveries/${d.id}`, {
          starts_at: editStartsAt || null,
          ends_at: editEndsAt || null,
          due_date: editDueDate || null,
          attempts_allowed: editAttempts,
          duration_minutes: editDuration || null,
        }, accessToken);
      }
      setEditGroup(null); await reloadDeliveries();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // ── Stop ───────────────────────────────────────────────────────────────────

  const stopGroup = async (group: DeliveryGroup) => {
    if (!accessToken) return;
    const label = group.deliveries.length > 1
      ? `"${group.rep.title}" (${group.deliveries.length} employees)`
      : `"${group.rep.title}"`;
    if (!confirm(`Stop delivery ${label}? Employees will immediately lose access. This can be undone by editing the closing date.`)) return;
    try {
      for (const d of group.deliveries) {
        await api.post(`/assessments/deliveries/${d.id}/stop`, {}, accessToken);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to stop one or more deliveries');
    } finally {
      await reloadDeliveries();
    }
  };

  // ── Extend time ────────────────────────────────────────────────────────────

  const extendTime = async () => {
    if (!extendTarget || !accessToken) return;
    setExtendLoading(true);
    try {
      const res = await api.post<{ extended_count: number; extra_minutes: number }>(
        `/assessments/deliveries/${extendTarget.deliveryId}/extend-time`,
        { extra_minutes: extendMinutes },
        accessToken,
      );
      if (res.extended_count === 0) {
        setExtendResult('No active in-progress attempt found for this employee. Time limit is extended for future attempts via the Edit action.');
      } else {
        setExtendResult(`Added ${res.extra_minutes} minutes to ${res.extended_count} active attempt${res.extended_count !== 1 ? 's' : ''}.`);
      }
    } catch (err) {
      setExtendResult(err instanceof Error ? err.message : 'Failed to extend time');
    } finally {
      setExtendLoading(false);
    }
  };

  // ── Grant re-take ───────────────────────────────────────────────────────────

  const grantRetake = async () => {
    if (!retakeTarget || !accessToken) return;
    setRetakeLoading(true);
    try {
      await api.post(
        `/assessments/deliveries/${retakeTarget.deliveryId}/grant-retake`,
        {},
        accessToken,
      );
      setRetakeTarget(null);
      await reloadDeliveries();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to grant re-take');
    } finally {
      setRetakeLoading(false);
    }
  };

  // ── Expand toggle ──────────────────────────────────────────────────────────

  const toggleExpand = (group: DeliveryGroup) => {
    const { key } = group;
    const isExpanded = expandedKeys.has(key);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    if (!isExpanded) {
      void fetchAttemptStatuses(group.deliveries.map((d) => d.id));
    }
  };

  // ── Results navigation ─────────────────────────────────────────────────────

  const getTestIdForGroup = (group: DeliveryGroup): string | undefined =>
    tests.find((t) => t.versions.some((v) => v.id === group.rep.test_version_id))?.id;

  const openResults = (group: DeliveryGroup, deliveryId?: string) => {
    if (deliveryId) {
      router.push(`/assessments/results?delivery_id=${deliveryId}`);
      return;
    }
    const testId = getTestIdForGroup(group);
    if (testId) {
      router.push(`/assessments/results?test_id=${testId}`);
    } else {
      router.push('/assessments/results');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <LoadingState label='Loading deliveries...' />;

  return (
    <div className='space-y-6'>

      {/* Page header */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Deliveries</h2>
          <p className='text-sm text-muted-foreground'>Assign assessment tests to specific employees or open to all.</p>
        </div>
        <Button onClick={() => { resetCreate(); setCreateOpen(true); }}>
          <Send className='mr-2 h-4 w-4' />
          Assign test
        </Button>
      </div>

      {/* Visibility tip */}
      <div className='flex items-start gap-3 rounded-lg border bg-blue-50/60 p-3.5 text-sm text-blue-800'>
        <Info className='mt-0.5 h-4 w-4 shrink-0' />
        <div>
          <p className='font-medium'>How employees see their tests</p>
          <p className='mt-0.5 text-xs text-blue-700'>
            Employees must have the <strong>Assessments Viewer</strong> (or Editor) role AND be included in a delivery below to see tests in their <strong>My Tests</strong> page.
            Use <em>Open to all</em> mode to instantly make a test visible to everyone with that role.
            Deliveries with status <strong>Closed</strong> are no longer visible — use the edit action to extend the window.
          </p>
        </div>
      </div>

      {/* Delivery table */}
      {groups.length === 0 ? (
        <EmptyState title='No deliveries yet' description='Assign a test above to make it available to employees.' />
      ) : (
        <div className='overflow-x-auto rounded-xl border bg-white'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead>
              <tr className='border-b bg-muted/40 text-xs text-muted-foreground'>
                <th className='px-4 py-2.5 text-left font-medium'>Test</th>
                <th className='px-4 py-2.5 text-left font-medium'>Status</th>
                <th className='px-4 py-2.5 text-left font-medium'>Audience</th>
                <th className='px-4 py-2.5 text-left font-medium'>Opens</th>
                <th className='px-4 py-2.5 text-left font-medium'>Closes</th>
                <th className='px-4 py-2.5 text-left font-medium'>Limits</th>
                <th className='px-2 py-2.5' />
              </tr>
            </thead>
            <tbody className='divide-y'>
              {groups.map((group) => {
                const deliveryStatus = getGroupStatus(group);
                const statusCfg = STATUS_CONFIG[deliveryStatus];
                const isMulti = group.deliveries.length > 1;
                const isExpanded = expandedKeys.has(group.key);

                // Completion summary for multi-person groups
                const groupStatuses = isMulti
                  ? group.deliveries.map((d) => attemptStatusMap[d.id])
                  : [];
                const completedCount = groupStatuses.filter((s) => s?.status === 'completed').length;
                const fetchedCount = groupStatuses.filter(Boolean).length;
                const hasGroupStats = isMulti && fetchedCount > 0;

                return (
                  <>
                    {/* Group row */}
                    <tr
                      key={group.key}
                      className={`hover:bg-muted/20 ${deliveryStatus === 'closed' ? 'opacity-60' : ''}`}
                    >
                      <td className='px-4 py-3 font-medium'>{group.rep.title}</td>
                      <td className='px-4 py-3'>
                        <Badge variant='outline' className={`text-[11px] font-medium ${statusCfg.className}`}>
                          {statusCfg.label}
                        </Badge>
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground'>
                        {group.rep.audience_type === 'campaign' ? (
                          'Open to all'
                        ) : isMulti ? (
                          <div className='flex flex-col gap-0.5'>
                            <button
                              type='button'
                              onClick={() => toggleExpand(group)}
                              className='inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 w-fit'
                            >
                              {isExpanded
                                ? <ChevronDown className='h-3 w-3' />
                                : <ChevronRight className='h-3 w-3' />
                              }
                              <Users className='h-3 w-3' />
                              {group.deliveries.length} employees
                            </button>
                            {hasGroupStats && (
                              <span className='text-[10px] text-muted-foreground pl-1'>
                                {completedCount}/{group.deliveries.length} completed
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className='flex flex-col gap-0.5'>
                            <span className='inline-flex items-center gap-1'>
                              <User className='h-3 w-3' />
                              {group.rep.participant_user_id
                                ? (() => {
                                    const u = usersById[group.rep.participant_user_id];
                                    return u ? (u.full_name || u.email) : 'Targeted';
                                  })()
                                : 'Targeted'
                              }
                            </span>
                            <AttemptStatusBadge status={attemptStatusMap[group.rep.id]} />
                          </div>
                        )}
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                        {fmtDateTime(group.rep.starts_at) ?? <span className='text-slate-400'>—</span>}
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                        {group.rep.ends_at
                          ? fmtDateTime(group.rep.ends_at)
                          : <span className='text-blue-600'>No end</span>
                        }
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                        {group.rep.attempts_allowed} attempt{group.rep.attempts_allowed !== 1 ? 's' : ''}
                        {group.rep.duration_minutes ? ` · ${group.rep.duration_minutes} min` : ''}
                      </td>
                      <td className='px-2 py-3'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon' className='h-7 w-7'>
                              <MoreVertical className='h-3.5 w-3.5' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem onClick={() => openEdit(group)}>
                              <Pencil className='mr-2 h-3.5 w-3.5' />
                              {isMulti ? `Edit dates & limits (${group.deliveries.length})` : 'Edit dates & limits'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openResults(group, isMulti ? undefined : group.rep.id)}>
                              <BarChart3 className='mr-2 h-3.5 w-3.5' />
                              View results
                            </DropdownMenuItem>
                            {!isMulti && attemptStatusMap[group.rep.id]?.status === 'in_progress' && (
                              <DropdownMenuItem onClick={() => { setExtendMinutes(15); setExtendResult(null); setExtendTarget({ deliveryId: group.rep.id, userName: group.rep.participant_user_id ? (usersById[group.rep.participant_user_id]?.full_name || usersById[group.rep.participant_user_id]?.email || 'Employee') : 'Employee' }); }}>
                                <Clock className='mr-2 h-3.5 w-3.5 text-amber-500' />
                                Extend time
                              </DropdownMenuItem>
                            )}
                            {!isMulti && (attemptStatusMap[group.rep.id]?.status === 'completed' || (attemptStatusMap[group.rep.id] && attemptStatusMap[group.rep.id].attempt_count >= group.rep.attempts_allowed)) && (
                              <DropdownMenuItem onClick={() => { const u = group.rep.participant_user_id ? usersById[group.rep.participant_user_id] : null; setRetakeTarget({ deliveryId: group.rep.id, userName: u ? (u.full_name || u.email) : 'Employee' }); }}>
                                <RefreshCw className='mr-2 h-3.5 w-3.5 text-blue-500' />
                                Grant re-take
                              </DropdownMenuItem>
                            )}
                            {deliveryStatus !== 'closed' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => stopGroup(group)}
                                  className='text-destructive focus:text-destructive'
                                >
                                  <Square className='mr-2 h-3.5 w-3.5' />
                                  Stop now
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>

                    {/* Expanded participant sub-rows */}
                    {isMulti && isExpanded && group.deliveries.map((d) => {
                      const u = d.participant_user_id ? usersById[d.participant_user_id] : null;
                      const aStatus = attemptStatusMap[d.id];
                      const userName = u ? (u.full_name || u.email) : 'Unknown employee';
                      return (
                        <tr key={d.id} className='bg-slate-50/70'>
                          {/* colSpan=7 covers all columns so this row never widens the table */}
                          <td colSpan={7} className='py-1.5 pl-10 pr-3'>
                            <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
                              {/* Left: user identity */}
                              <span className='inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                                <User className='h-3 w-3 shrink-0 text-slate-400' />
                                {u ? (
                                  <>
                                    <span className='font-medium text-slate-700'>{u.full_name || u.email}</span>
                                    {u.full_name && <span className='hidden text-slate-400 sm:inline'>{u.email}</span>}
                                  </>
                                ) : (
                                  <span className='text-slate-400'>Unknown employee</span>
                                )}
                              </span>
                              {/* Right: status + action buttons — all inline, never breaking the table width */}
                              <div className='flex shrink-0 items-center gap-1.5'>
                                <AttemptStatusBadge status={aStatus} />
                                {aStatus?.status === 'in_progress' && (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 px-2 text-[10px] text-amber-600 hover:bg-amber-50 hover:text-amber-700'
                                    title="Add extra minutes to this employee's active attempt"
                                    onClick={() => { setExtendMinutes(15); setExtendResult(null); setExtendTarget({ deliveryId: d.id, userName }); }}
                                  >
                                    <Clock className='mr-1 h-3 w-3' />
                                    Extend
                                  </Button>
                                )}
                                {(aStatus?.status === 'completed' || (aStatus && aStatus.attempt_count >= d.attempts_allowed)) && (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 px-2 text-[10px] text-blue-600 hover:bg-blue-50 hover:text-blue-700'
                                    title='Allow this employee to take the test again'
                                    onClick={() => setRetakeTarget({ deliveryId: d.id, userName })}
                                  >
                                    <RefreshCw className='mr-1 h-3 w-3' />
                                    Re-take
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  className='h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground'
                                  onClick={() => openResults(group, d.id)}
                                >
                                  <BarChart3 className='mr-1 h-3 w-3' />
                                  Results
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create Sheet ──────────────────────────────────────────────────── */}
      <Sheet open={createOpen} onOpenChange={(open) => { if (!creating) { setCreateOpen(open); if (!open) resetCreate(); } }}>
        <SheetContent side='right' className='flex h-full flex-col sm:max-w-lg'>
          <SheetHeader className='border-b pb-4'>
            <SheetTitle>Assign test</SheetTitle>
            <p className='text-sm text-muted-foreground'>Create a delivery to assign a published test to employees.</p>
          </SheetHeader>

          <div className='flex-1 overflow-auto'>
            <div className='space-y-4 py-4 pr-1'>

              <section className='space-y-2'>
                <StepLabel n={1} label='Select test' />
                <SingleSelect value={testVersionId} onChange={setTestVersionId} options={publishedVersionOptions} placeholder='Select a published test…' />
                {publishedVersionOptions.length === 0 && (
                  <p className='text-xs text-amber-700'>No published tests found. Publish a test version in the Test Builder first.</p>
                )}
              </section>

              <section className='space-y-2'>
                <StepLabel n={2} label='Who takes this test?' />
                <div className='grid grid-cols-2 gap-2'>
                  <AudienceCard active={audienceType === 'assignment'} onClick={() => setAudienceType('assignment')}
                    icon={<Users className='h-4 w-4 text-muted-foreground' />}
                    title='Targeted' desc='Specific employees you pick' />
                  <AudienceCard active={audienceType === 'campaign'} onClick={() => setAudienceType('campaign')}
                    icon={<Send className='h-4 w-4 text-muted-foreground' />}
                    title='Open to all' desc='Everyone with Assessments role' />
                </div>
              </section>

              {audienceType === 'assignment' && (
                <section className='space-y-2'>
                  <StepLabel n={3} label='Select employees' />
                  {usersError ? (
                    <UsersErrorBanner />
                  ) : (
                    <MultiSelect value={selectedUserIds} onChange={setSelectedUserIds} options={userOptions} placeholder='Search and select employees…' />
                  )}
                </section>
              )}

              <section className='space-y-2'>
                <StepLabel n={audienceType === 'assignment' ? 4 : 3} label='Scheduling & limits' />
                <div className='rounded-xl border bg-muted/20 p-3 space-y-3'>
                  <div className='grid grid-cols-2 gap-3'>
                    <DateTimeInput label='Opens on' hint='Blank = available now' value={startsAt} onChange={setStartsAt} presets={OPEN_PRESETS} />
                    <DateTimeInput label='Closes on' hint='Blank = no deadline' value={endsAt} onChange={setEndsAt} presets={CLOSE_PRESETS} />
                  </div>
                  <div className='grid grid-cols-2 gap-3 border-t pt-3'>
                    <div className='space-y-1'>
                      <Label className='text-xs font-medium'>Duration (min)</Label>
                      <p className='text-[10px] text-muted-foreground'>Override test default</p>
                      <div className='relative'>
                        <Clock className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
                        <Input type='number' min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : '')} placeholder='Test default' className='h-8 pl-8 text-xs' />
                      </div>
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-xs font-medium'>Attempts allowed</Label>
                      <p className='text-[10px] text-muted-foreground'>How many times</p>
                      <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(Number(e.target.value || 1))} className='h-8 text-xs' />
                    </div>
                  </div>
                </div>
              </section>

              {createError && <ErrorBanner message={createError} />}
              {createProgress && <p className='text-xs text-muted-foreground'>{createProgress}</p>}
            </div>
            </div>

          <SheetFooter className='border-t pt-4'>
            <Button variant='outline' onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button
              onClick={createDeliveries}
              disabled={creating || !testVersionId || (audienceType === 'assignment' && selectedUserIds.length === 0 && !usersError)}
            >
              {creating ? 'Creating…' : audienceType === 'campaign' ? 'Open test to all' : `Assign to ${selectedUserIds.length} employee${selectedUserIds.length !== 1 ? 's' : ''}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Edit Sheet ────────────────────────────────────────────────────── */}
      <Sheet open={!!editGroup} onOpenChange={(open) => { if (!saving && !open) setEditGroup(null); }}>
        <SheetContent side='right' className='flex h-full flex-col sm:max-w-md'>
          <SheetHeader className='border-b pb-4'>
            <SheetTitle>Edit delivery</SheetTitle>
            <p className='text-sm text-muted-foreground'>
              Adjust the time window, attempts, or duration.{editGroup && editGroup.deliveries.length > 1 && ` Changes apply to all ${editGroup.deliveries.length} employees.`}
            </p>
          </SheetHeader>

          <div className='flex-1 overflow-auto'>
            <div className='space-y-4 py-4 pr-1'>
              <div className='rounded-lg border bg-muted/30 px-3 py-2 text-sm'>
                <p className='font-medium leading-tight'>{editGroup?.rep.title}</p>
                <p className='text-xs text-muted-foreground mt-0.5'>
                  {editGroup?.rep.audience_type === 'campaign'
                    ? 'Open to all employees'
                    : editGroup && editGroup.deliveries.length > 1
                      ? `Targeted — ${editGroup.deliveries.length} employees`
                      : 'Targeted assignment'
                  }
                </p>
              </div>

              <div className='space-y-3 rounded-xl border bg-muted/20 p-3'>
                <div className='grid grid-cols-2 gap-3'>
                  <DateTimeInput
                    label='Opens on'
                    hint='Blank = available now'
                    value={editStartsAt}
                    onChange={setEditStartsAt}
                    presets={OPEN_PRESETS}
                  />
                  <DateTimeInput
                    label='Closes on'
                    hint='Blank = no deadline'
                    value={editEndsAt}
                    onChange={setEditEndsAt}
                    presets={CLOSE_PRESETS}
                  />
                </div>
                <div className='space-y-1 border-t pt-3'>
                  <div className='flex items-center justify-between'>
                    <Label className='text-xs font-medium'>Due date <span className='font-normal text-muted-foreground'>(display only)</span></Label>
                    {editDueDate && (
                      <button type='button' onClick={() => setEditDueDate('')} className='inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-destructive'>
                        <X className='h-2.5 w-2.5' />Clear
                      </button>
                    )}
                  </div>
                  <p className='text-[10px] text-muted-foreground'>Reminder shown to employees, separate from the hard close</p>
                  <Input type='date' value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className='h-8 text-xs' />
                </div>
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1'>
                  <Label className='text-xs font-medium'>Attempts allowed</Label>
                  <Input type='number' min={1} value={editAttempts} onChange={(e) => setEditAttempts(Number(e.target.value || 1))} className='h-8 text-xs' />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs font-medium'>Duration (min)</Label>
                  <Input type='number' min={1} value={editDuration} placeholder='Test default' onChange={(e) => setEditDuration(e.target.value ? Number(e.target.value) : '')} className='h-8 text-xs' />
                </div>
              </div>

              {editError && <ErrorBanner message={editError} />}
            </div>
          </div>

          <SheetFooter className='border-t pt-4'>
            <Button variant='outline' onClick={() => setEditGroup(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Extend Time Dialog ───────────────────────────────────────────── */}
      {extendTarget && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm'>
          <div className='w-full max-w-sm rounded-xl border bg-white p-6 shadow-xl'>
            <h3 className='text-base font-semibold'>Extend time</h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              Add extra minutes to <span className='font-medium text-foreground'>{extendTarget.userName}</span>&apos;s active attempt.
            </p>
            {extendResult ? (
              <div className='mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-foreground'>{extendResult}</div>
            ) : (
              <div className='mt-4 space-y-1.5'>
                <Label htmlFor='extend-minutes'>Extra minutes</Label>
                <div className='relative'>
                  <Clock className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    id='extend-minutes'
                    type='number'
                    min={1}
                    max={480}
                    value={extendMinutes}
                    onChange={(e) => setExtendMinutes(Number(e.target.value) || 1)}
                    className='pl-8'
                  />
                </div>
                <p className='text-[11px] text-muted-foreground'>This extends the expiry of the current in-progress attempt only.</p>
              </div>
            )}
            <div className='mt-5 flex justify-end gap-2'>
              <Button variant='outline' onClick={() => { setExtendTarget(null); setExtendResult(null); }}>
                {extendResult ? 'Close' : 'Cancel'}
              </Button>
              {!extendResult && (
                <Button onClick={extendTime} disabled={extendLoading}>
                  <PlusCircle className='mr-1.5 h-3.5 w-3.5' />
                  {extendLoading ? 'Extending…' : `Add ${extendMinutes} min`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Grant Re-take Dialog ─────────────────────────────────────────── */}
      {retakeTarget && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm'>
          <div className='w-full max-w-sm rounded-xl border bg-white p-6 shadow-xl'>
            <h3 className='text-base font-semibold'>Grant re-take</h3>
            <p className='mt-2 text-sm text-muted-foreground'>
              Allow <span className='font-medium text-foreground'>{retakeTarget.userName}</span> to take this test again? Their attempts allowed will be increased by 1.
            </p>
            <div className='mt-5 flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setRetakeTarget(null)} disabled={retakeLoading}>Cancel</Button>
              <Button onClick={grantRetake} disabled={retakeLoading}>
                <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
                {retakeLoading ? 'Granting…' : 'Grant re-take'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small shared components ───────────────────────────────────────────────────

function AttemptStatusBadge({ status }: { status: AttemptStatus | undefined }) {
  if (!status) return null;
  if (status.status === 'not_started') {
    return <span className='text-[10px] text-slate-400'>Not started</span>;
  }
  if (status.status === 'in_progress') {
    return <span className='inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600'>In progress</span>;
  }
  const pct = status.score_percent != null ? Math.round(status.score_percent) : null;
  const colorClass =
    pct == null ? 'text-emerald-600' :
    pct >= 80   ? 'text-emerald-600' :
    pct >= 50   ? 'text-amber-600'   : 'text-red-600';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colorClass}`}>
      {status.passed
        ? <CheckCircle2 className='h-2.5 w-2.5' />
        : <XCircle className='h-2.5 w-2.5' />
      }
      {pct != null ? `${pct}%` : 'Done'}
      {status.attempt_count > 1 && (
        <span className='ml-0.5 font-normal text-slate-400'>({status.attempt_count})</span>
      )}
    </span>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground'>{n}</span>
      <p className='text-sm font-semibold'>{label}</p>
    </div>
  );
}

function AudienceCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'}`}
    >
      {icon}
      <p className='text-sm font-medium'>{title}</p>
      <p className='text-[11px] text-muted-foreground'>{desc}</p>
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className='flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800'>
      <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
      {message}
    </div>
  );
}

function UsersErrorBanner() {
  return (
    <div className='flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'>
      <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
      <div>
        <p className='font-medium'>Cannot load employees</p>
        <p className='mt-0.5 text-xs text-amber-700'>
          Your account does not have user management access. Ask an admin with the <strong>Tenant Admin</strong> role to create deliveries, or switch to <strong>Open to all</strong>.
        </p>
      </div>
    </div>
  );
}
