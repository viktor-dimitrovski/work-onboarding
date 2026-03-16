'use client';

import { useEffect, useState } from 'react';

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
import type { AssessmentDelivery, AssessmentTest, UserRow } from '@/lib/types';
import { AlertTriangle, CalendarDays, Clock, Info, MoreVertical, Pencil, Send, Square, Users } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Delivery status helper ────────────────────────────────────────────────────

type DeliveryStatus = 'active' | 'no-deadline' | 'scheduled' | 'closed';

function getDeliveryStatus(d: AssessmentDelivery): DeliveryStatus {
  const now = new Date();
  if (d.ends_at && new Date(d.ends_at) < now) return 'closed';
  if (d.starts_at && new Date(d.starts_at) > now) return 'scheduled';
  if (!d.ends_at) return 'no-deadline';
  return 'active';
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; className: string }> = {
  active:      { label: 'Active',      className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  'no-deadline': { label: 'Open (no end)', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  scheduled:   { label: 'Scheduled',   className: 'border-amber-200 bg-amber-50 text-amber-700' },
  closed:      { label: 'Closed',      className: 'border-slate-200 bg-slate-100 text-slate-500' },
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

function splitDatetime(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const [date = '', time = ''] = value.split('T');
  return { date, time: time.slice(0, 5) };
}

function joinDatetime(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
}

function isoToLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── DateTimeInput component ───────────────────────────────────────────────────

function DateTimeInput({
  value,
  onChange,
  label,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  hint?: string;
}) {
  const { date, time } = splitDatetime(value);
  return (
    <div className='space-y-1.5'>
      <Label>{label}</Label>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
      <div className='flex gap-2'>
        <div className='relative flex-1'>
          <CalendarDays className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            type='date'
            value={date}
            onChange={(e) => onChange(joinDatetime(e.target.value, time))}
            className='pl-8 text-sm'
          />
        </div>
        <div className='relative w-32'>
          <Clock className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            type='time'
            value={time}
            onChange={(e) => onChange(joinDatetime(date, e.target.value))}
            className='pl-8 text-sm'
            disabled={!date}
          />
        </div>
        {value && (
          <Button type='button' variant='ghost' size='icon' className='shrink-0' onClick={() => onChange('')} title='Clear'>
            ×
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssessmentDeliveriesPage() {
  const { accessToken } = useAuth();
  const [deliveries, setDeliveries] = useState<AssessmentDelivery[]>([]);
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersError, setUsersError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState('');

  // Edit sheet
  const [editDelivery, setEditDelivery] = useState<AssessmentDelivery | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Edit form fields
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

  useEffect(() => { void load(); }, [accessToken]);

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

  // ── Edit ───────────────────────────────────────────────────────────────────

  const openEdit = (d: AssessmentDelivery) => {
    setEditDelivery(d);
    setEditStartsAt(isoToLocal(d.starts_at));
    setEditEndsAt(isoToLocal(d.ends_at));
    setEditDueDate(d.due_date ?? '');
    setEditAttempts(d.attempts_allowed);
    setEditDuration(d.duration_minutes ?? '');
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!accessToken || !editDelivery) return;
    setSaving(true); setEditError(null);
    try {
      await api.patch(`/assessments/deliveries/${editDelivery.id}`, {
        starts_at: editStartsAt || null,
        ends_at: editEndsAt || null,
        due_date: editDueDate || null,
        attempts_allowed: editAttempts,
        duration_minutes: editDuration || null,
      }, accessToken);
      setEditDelivery(null); await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // ── Stop ───────────────────────────────────────────────────────────────────

  const stopDelivery = async (d: AssessmentDelivery) => {
    if (!accessToken) return;
    if (!confirm(`Stop delivery "${d.title}"? Employees will immediately lose access. This can be undone by editing the closing date.`)) return;
    try {
      await api.post(`/assessments/deliveries/${d.id}/stop`, {}, accessToken);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to stop delivery');
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
      {deliveries.length === 0 ? (
        <EmptyState title='No deliveries yet' description='Assign a test above to make it available to employees.' />
      ) : (
        <div className='overflow-hidden rounded-xl border bg-white'>
          <table className='w-full text-sm'>
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
              {deliveries.map((delivery) => {
                const deliveryStatus = getDeliveryStatus(delivery);
                const statusCfg = STATUS_CONFIG[deliveryStatus];
                return (
                  <tr key={delivery.id} className={`hover:bg-muted/20 ${deliveryStatus === 'closed' ? 'opacity-60' : ''}`}>
                    <td className='px-4 py-3 font-medium'>{delivery.title}</td>
                    <td className='px-4 py-3'>
                      <Badge variant='outline' className={`text-[11px] font-medium ${statusCfg.className}`}>
                        {statusCfg.label}
                      </Badge>
                    </td>
                    <td className='px-4 py-3 text-xs text-muted-foreground'>
                      {delivery.audience_type === 'campaign' ? 'Open to all' : 'Targeted'}
                    </td>
                    <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                      {fmtDateTime(delivery.starts_at) ?? <span className='text-slate-400'>—</span>}
                    </td>
                    <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                      {delivery.ends_at
                        ? fmtDateTime(delivery.ends_at)
                        : <span className='text-blue-600'>No end</span>
                      }
                    </td>
                    <td className='px-4 py-3 text-xs text-muted-foreground whitespace-nowrap'>
                      {delivery.attempts_allowed} attempt{delivery.attempts_allowed !== 1 ? 's' : ''}
                      {delivery.duration_minutes ? ` · ${delivery.duration_minutes} min` : ''}
                    </td>
                    <td className='px-2 py-3'>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='icon' className='h-7 w-7'>
                            <MoreVertical className='h-3.5 w-3.5' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem onClick={() => openEdit(delivery)}>
                            <Pencil className='mr-2 h-3.5 w-3.5' />
                            Edit dates &amp; limits
                          </DropdownMenuItem>
                          {deliveryStatus !== 'closed' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => stopDelivery(delivery)}
                                className='text-destructive focus:text-destructive'
                              >
                                <Square className='mr-2 h-3.5 w-3.5' />
                                Stop campaign now
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
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
            <div className='space-y-6 py-5 pr-1'>

              <section className='space-y-3'>
                <StepLabel n={1} label='Select test' />
                <SingleSelect value={testVersionId} onChange={setTestVersionId} options={publishedVersionOptions} placeholder='Select a published test…' />
                {publishedVersionOptions.length === 0 && (
                  <p className='text-xs text-amber-700'>No published tests found. Publish a test version in the Test Builder first.</p>
                )}
              </section>

              <section className='space-y-3'>
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
                <section className='space-y-3'>
                  <StepLabel n={3} label='Select employees' />
                  {usersError ? (
                    <UsersErrorBanner />
                  ) : (
                    <MultiSelect value={selectedUserIds} onChange={setSelectedUserIds} options={userOptions} placeholder='Search and select employees…' />
                  )}
                </section>
              )}

              <section className='space-y-3'>
                <StepLabel n={audienceType === 'assignment' ? 4 : 3} label='Scheduling & limits' />
                <div className='rounded-xl border bg-muted/20 p-4 space-y-4'>
                  <DateTimeInput label='Opens on' hint='Leave blank to make available immediately' value={startsAt} onChange={setStartsAt} />
                  <DateTimeInput label='Closes on' hint='Leave blank for no deadline — use Stop campaign to close manually later.' value={endsAt} onChange={setEndsAt} />
                  <div className='grid gap-3 sm:grid-cols-2 pt-1'>
                    <div className='space-y-1.5'>
                      <Label>Duration per attempt</Label>
                      <p className='text-[11px] text-muted-foreground'>Override test default time limit</p>
                      <div className='relative'>
                        <Clock className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
                        <Input type='number' min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : '')} placeholder='Use test default' className='pl-8' />
                      </div>
                    </div>
                    <div className='space-y-1.5'>
                      <Label>Attempts allowed</Label>
                      <p className='text-[11px] text-muted-foreground'>How many times can they take it</p>
                      <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(Number(e.target.value || 1))} />
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
      <Sheet open={!!editDelivery} onOpenChange={(open) => { if (!saving && !open) setEditDelivery(null); }}>
        <SheetContent side='right' className='flex h-full flex-col sm:max-w-md'>
          <SheetHeader className='border-b pb-4'>
            <SheetTitle>Edit delivery</SheetTitle>
            <p className='text-sm text-muted-foreground'>
              Adjust the time window, attempts, or duration. The test and audience cannot be changed.
            </p>
          </SheetHeader>

          <div className='flex-1 overflow-auto'>
            <div className='space-y-6 py-5 pr-1'>
              <div className='rounded-lg border bg-muted/30 px-4 py-3 text-sm'>
                <p className='font-medium'>{editDelivery?.title}</p>
                <p className='text-xs text-muted-foreground mt-0.5'>
                  {editDelivery?.audience_type === 'campaign' ? 'Open to all employees' : 'Targeted assignment'}
                </p>
              </div>

              <div className='space-y-4 rounded-xl border bg-muted/20 p-4'>
                <DateTimeInput
                  label='Opens on'
                  hint='Clear to make available immediately'
                  value={editStartsAt}
                  onChange={setEditStartsAt}
                />
                <DateTimeInput
                  label='Closes on'
                  hint='Clear to remove the deadline (open indefinitely — stop manually when needed)'
                  value={editEndsAt}
                  onChange={setEditEndsAt}
                />
                <div className='space-y-1.5'>
                  <Label>Due date (display only)</Label>
                  <p className='text-[11px] text-muted-foreground'>Shown to employees as a reminder, separate from the hard close date</p>
                  <Input
                    type='date'
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className='text-sm'
                  />
                </div>
              </div>

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>Attempts allowed</Label>
                  <Input
                    type='number'
                    min={1}
                    value={editAttempts}
                    onChange={(e) => setEditAttempts(Number(e.target.value || 1))}
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label>Duration per attempt (min)</Label>
                  <Input
                    type='number'
                    min={1}
                    value={editDuration}
                    placeholder='Use test default'
                    onChange={(e) => setEditDuration(e.target.value ? Number(e.target.value) : '')}
                  />
                </div>
              </div>

              {editError && <ErrorBanner message={editError} />}
            </div>
          </div>

          <SheetFooter className='border-t pt-4'>
            <Button variant='outline' onClick={() => setEditDelivery(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Small shared components ───────────────────────────────────────────────────

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
