'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  CreditCard,
  FileQuestion,
  Network,
  PlayCircle,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatDateTime, formatPercent, shortId } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { AdminDashboardReport, Assignment, EmployeeDashboardReport } from '@/lib/types';

// ── Local types ──────────────────────────────────────────────────────────────

interface AssignmentListResponse {
  items: Assignment[];
  meta: { page: number; page_size: number; total: number };
}

interface NextTaskResponse {
  assignment_id: string;
  task: { id: string; title: string; status: string } | null;
}

interface AvailableTest {
  delivery_id: string;
  test_title: string;
  attempt_status: 'not_started' | 'in_progress' | 'completed' | 'passed';
  question_count: number;
  due_date?: string | null;
}

interface ComplianceDashboard {
  implementation: { compliance: number | null; numerator: number; denominator: number };
  coverage_percent: number | null;
  gaps_by_severity: Record<string, number>;
  open_work_items: number;
  top_gaps: Array<{ control_key: string; title: string; criticality: string }>;
}

interface IrOverview {
  total: number;
  active_count: number;
  draft_count: number;
  prod_count: number;
  uat_count: number;
  service_count: number;
  recently_changed: Array<{ instance_id: string; service_name: string; env: string; status: string }>;
}

interface ReleaseSummary {
  assignment_id: string;
  title: string;
  status: string;
  progress_percent: number;
  environment: string | null;
  version_tag: string | null;
}

interface BillingOverview {
  plan: { name: string } | null;
  subscription: { status: string; ends_at: string | null; trial_ends_at: string | null } | null;
  next_invoice: { total_amount: string; due_at: string | null } | null;
  currency: string | null;
  current_period_spend: string;
}

// ── Sticky nav bar ────────────────────────────────────────────────────────────

interface NavSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string | null;
  badgeVariant?: 'default' | 'warning' | 'alert';
}

function StickyNav({ sections }: { sections: NavSection[] }) {
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Show bar once user has scrolled 80px
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Highlight the section currently in view
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveId(id); },
        { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [sections]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  if (sections.length < 2) return null;

  return (
    <div
      className={cn(
        'fixed left-0 right-0 top-0 z-40 flex justify-center transition-all duration-200',
        visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none',
      )}
      style={{ paddingTop: '56px' }} // offset below the app topbar
    >
      <div className='flex items-center gap-1 rounded-b-xl border border-t-0 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm'>
        {sections.map(({ id, label, icon: Icon, badge, badgeVariant }) => {
          const isActive = activeId === id;
          return (
            <button
              key={id}
              type='button'
              onClick={() => scrollTo(id)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className='h-3.5 w-3.5 shrink-0' />
              <span>{label}</span>
              {badge != null && Number(badge) > 0 && (
                <span
                  className={cn(
                    'ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                    badgeVariant === 'alert'
                      ? 'bg-red-500 text-white'
                      : badgeVariant === 'warning'
                        ? 'bg-amber-400 text-amber-900'
                        : isActive
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted-foreground/15 text-muted-foreground',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared UI helpers ────────────────────────────────────────────────────────

function MetricCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card className='bg-white'>
      <CardHeader className='pb-2 pt-3'>
        <CardDescription className='text-xs'>{title}</CardDescription>
        <CardTitle className='text-xl font-semibold'>{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className='pb-3 pt-0 text-xs text-muted-foreground'>{sub}</CardContent>}
    </Card>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  href,
  linkLabel = 'Open module',
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  href: string;
  linkLabel?: string;
  accent: string;
}) {
  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-3'>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accent)}>
          <Icon className='h-4 w-4 text-white' />
        </div>
        <h2 className='text-base font-semibold tracking-tight'>{title}</h2>
      </div>
      <Button variant='ghost' size='sm' asChild className='h-7 text-xs text-muted-foreground'>
        <Link href={href} className='gap-1'>
          {linkLabel} <ArrowRight className='h-3 w-3' />
        </Link>
      </Button>
    </div>
  );
}

function SectionShell({
  id,
  accent,
  children,
}: {
  id: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className='overflow-hidden rounded-xl border bg-white shadow-sm'>
      <div className={cn('h-1', accent)} />
      <div className='space-y-4 p-5'>{children}</div>
    </section>
  );
}

// ── Section: Tracks & Assignments ────────────────────────────────────────────

function AssignmentsSection({
  isAdmin,
  adminData,
  employeeData,
  assignments,
  nextTask,
}: {
  isAdmin: boolean;
  adminData: AdminDashboardReport | null;
  employeeData: EmployeeDashboardReport | null;
  assignments: Assignment[];
  nextTask: NextTaskResponse | null;
}) {
  return (
    <SectionShell id='section-assignments' accent='bg-blue-500'>
      <SectionHeader icon={ClipboardList} title='Tracks' href='/assignments' linkLabel='Go to assignments' accent='bg-blue-500' />

      <div className='grid gap-4 md:grid-cols-4'>
        {isAdmin && adminData ? (
          <>
            <MetricCard title='Active onboardings' value={String(adminData.active_onboardings)} />
            <MetricCard title='Completion rate' value={`${adminData.completion_rate_percent.toFixed(1)}%`} />
            <MetricCard title='Overdue tasks' value={String(adminData.overdue_tasks)} />
            <MetricCard title='Approval queue' value={String(adminData.mentor_approval_queue)} />
          </>
        ) : employeeData ? (
          <>
            <MetricCard title='Assigned tracks' value={String(employeeData.assignment_count)} />
            <MetricCard title='Upcoming tasks' value={String(employeeData.upcoming_tasks)} />
            <MetricCard title='Overdue tasks' value={String(employeeData.overdue_tasks)} />
            <MetricCard title='Avg progress' value={`${employeeData.average_progress_percent.toFixed(1)}%`} />
          </>
        ) : null}
      </div>

      {!isAdmin && nextTask?.task && (
        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium text-muted-foreground'>Next task</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3'>
              <div>
                <p className='font-medium'>{nextTask.task.title}</p>
              </div>
              <div className='flex items-center gap-3'>
                <StatusChip status={nextTask.task.status} />
                <Button asChild size='sm'>
                  <Link href={`/my-onboarding/${nextTask.assignment_id}`}>Open</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {assignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Recent assignments</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {assignments.map((a) => (
                <div key={a.id} className='flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20'>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate font-medium'>{a.title}</p>
                    <p className='mt-0.5 text-xs text-muted-foreground'>
                      Start {a.start_date} · Target {a.target_date}
                    </p>
                    <div className='mt-2 flex items-center gap-3'>
                      <Progress value={a.progress_percent} className='h-1.5 flex-1' />
                      <span className='w-10 text-right text-xs text-muted-foreground'>{formatPercent(a.progress_percent)}</span>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <StatusChip status={a.status} />
                    <Button variant='outline' size='sm' asChild>
                      <Link href={`/assignments/${a.id}`}>View</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </SectionShell>
  );
}

// ── Section: Assessments ─────────────────────────────────────────────────────

function AssessmentsSection({
  canManage,
  tests,
}: {
  canManage: boolean;
  tests: AvailableTest[];
}) {
  const pending = tests.filter((t) => t.attempt_status === 'not_started' || t.attempt_status === 'in_progress');
  const completed = tests.filter((t) => t.attempt_status === 'completed' || t.attempt_status === 'passed');

  return (
    <SectionShell id='section-assessments' accent='bg-indigo-500'>
      <SectionHeader icon={FileQuestion} title='Assessments' href='/assessments/my-tests' linkLabel='My Tests' accent='bg-indigo-500' />

      <div className='grid gap-4 md:grid-cols-3'>
        <MetricCard title='Pending tests' value={String(pending.length)} />
        <MetricCard title='Completed' value={String(completed.length)} />
        <MetricCard title='Total assigned' value={String(tests.length)} />
      </div>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Tests to do</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {pending.slice(0, 5).map((t) => (
                <div key={t.delivery_id} className='flex items-center justify-between px-4 py-3 hover:bg-muted/20'>
                  <div>
                    <p className='font-medium'>{t.test_title}</p>
                    <p className='text-xs text-muted-foreground'>
                      {t.question_count} questions
                      {t.due_date && ` · Due ${new Date(t.due_date).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Badge variant={t.attempt_status === 'in_progress' ? 'secondary' : 'outline'} className='text-xs'>
                      {t.attempt_status === 'in_progress' ? 'In progress' : 'Not started'}
                    </Badge>
                    <Button size='sm' asChild>
                      <Link href={`/assessments/take/${t.delivery_id}`}>
                        <PlayCircle className='mr-1 h-3.5 w-3.5' />
                        {t.attempt_status === 'in_progress' ? 'Continue' : 'Start'}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && (
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' asChild>
            <Link href='/assessments/deliveries'>
              <BarChart3 className='mr-1.5 h-3.5 w-3.5' />
              Manage deliveries
            </Link>
          </Button>
          <Button variant='outline' size='sm' asChild>
            <Link href='/assessments/results'>View results</Link>
          </Button>
        </div>
      )}
    </SectionShell>
  );
}

// ── Section: Compliance ───────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-500',
  medium: 'text-yellow-600',
  low: 'text-slate-500',
};

function ComplianceSection({ data }: { data: ComplianceDashboard }) {
  const impl = data.implementation.compliance;
  const severities = Object.entries(data.gaps_by_severity).sort((a, b) => b[1] - a[1]);

  return (
    <SectionShell id='section-compliance' accent='bg-emerald-500'>
      <SectionHeader icon={ShieldCheck} title='Compliance' href='/compliance-hub/profile' linkLabel='Open compliance' accent='bg-emerald-500' />

      <div className='grid gap-4 md:grid-cols-4'>
        <MetricCard title='Implementation' value={impl != null ? `${impl.toFixed(1)}%` : '—'} />
        <MetricCard title='Coverage' value={data.coverage_percent != null ? `${data.coverage_percent.toFixed(1)}%` : '—'} />
        <MetricCard title='Open work items' value={String(data.open_work_items)} />
        <MetricCard title='Gap categories' value={String(severities.length)} />
      </div>

      {(severities.length > 0 || data.top_gaps.length > 0) && (
        <div className='grid gap-4 md:grid-cols-2'>
          {severities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className='text-sm'>Gaps by severity</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                {severities.map(([sev, count]) => (
                  <div key={sev} className='flex items-center justify-between text-sm'>
                    <span className={`capitalize font-medium ${SEVERITY_COLOR[sev] ?? ''}`}>{sev}</span>
                    <span className='text-muted-foreground'>{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.top_gaps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className='text-sm'>Top gaps</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                {data.top_gaps.slice(0, 5).map((g) => (
                  <div key={g.control_key} className='flex items-center justify-between gap-2 text-sm'>
                    <span className='truncate'>{g.title}</span>
                    <Badge variant='outline' className={`shrink-0 text-[10px] capitalize ${SEVERITY_COLOR[g.criticality] ?? ''}`}>
                      {g.criticality}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ── Section: Integration Registry ────────────────────────────────────────────

function IntegrationRegistrySection({ data }: { data: IrOverview }) {
  return (
    <SectionShell id='section-ir' accent='bg-violet-500'>
      <SectionHeader icon={Network} title='Integration Registry' href='/integration-registry/overview' linkLabel='Open registry' accent='bg-violet-500' />

      <div className='grid gap-4 md:grid-cols-4'>
        <MetricCard title='Total connections' value={String(data.total)} />
        <MetricCard title='Active' value={String(data.active_count)} />
        <MetricCard title='Draft' value={String(data.draft_count)} />
        <MetricCard title='Services' value={String(data.service_count)} />
      </div>

      {data.recently_changed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Recently changed</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {data.recently_changed.slice(0, 5).map((item) => (
                <div key={item.instance_id} className='flex items-center justify-between px-4 py-2.5 hover:bg-muted/20'>
                  <div>
                    <p className='text-sm font-medium'>{item.service_name}</p>
                    <p className='text-xs text-muted-foreground uppercase'>{item.env}</p>
                  </div>
                  <StatusChip status={item.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </SectionShell>
  );
}

// ── Section: Release Management ───────────────────────────────────────────────

function ReleasesSection({ releases }: { releases: ReleaseSummary[] }) {
  return (
    <SectionShell id='section-releases' accent='bg-orange-500'>
      <SectionHeader icon={Rocket} title='Release Management' href='/release-center' linkLabel='Release center' accent='bg-orange-500' />

      {releases.length === 0 ? (
        <EmptyState title='No active releases' description='No releases found for this period.' />
      ) : (
        <Card>
          <CardContent className='p-0'>
            <div className='divide-y'>
              {releases.map((r) => (
                <div key={r.assignment_id} className='flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20'>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate font-medium'>{r.title}</p>
                    <p className='text-xs text-muted-foreground'>
                      {r.environment && <span className='uppercase'>{r.environment}</span>}
                      {r.version_tag && <span> · {r.version_tag}</span>}
                    </p>
                    <div className='mt-1.5 flex items-center gap-2'>
                      <Progress value={r.progress_percent} className='h-1.5 w-24' />
                      <span className='text-xs text-muted-foreground'>{r.progress_percent.toFixed(0)}%</span>
                    </div>
                  </div>
                  <StatusChip status={r.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </SectionShell>
  );
}

// ── Section: Billing ──────────────────────────────────────────────────────────

function BillingSection({ data }: { data: BillingOverview }) {
  const sub = data.subscription;
  const isTrial = sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();

  return (
    <SectionShell id='section-billing' accent='bg-slate-500'>
      <SectionHeader icon={CreditCard} title='Billing' href='/billing' linkLabel='Manage billing' accent='bg-slate-500' />

      <div className='grid gap-4 md:grid-cols-3'>
        <MetricCard
          title='Current plan'
          value={data.plan?.name ?? '—'}
          sub={sub ? `Status: ${sub.status}` : undefined}
        />
        <MetricCard
          title='Period spend'
          value={
            data.current_period_spend != null
              ? `${parseFloat(data.current_period_spend as unknown as string).toFixed(2)} ${data.currency ?? ''}`.trim()
              : '—'
          }
        />
        {data.next_invoice ? (
          <MetricCard
            title='Next invoice'
            value={`${parseFloat(data.next_invoice.total_amount as unknown as string).toFixed(2)} ${data.currency ?? ''}`.trim()}
            sub={data.next_invoice.due_at ? `Due ${new Date(data.next_invoice.due_at).toLocaleDateString()}` : undefined}
          />
        ) : (
          <MetricCard title='Next invoice' value='—' />
        )}
      </div>

      {isTrial && (
        <Card className='border-amber-200 bg-amber-50'>
          <CardContent className='flex items-center gap-2 py-3 text-sm text-amber-800'>
            <span className='font-medium'>Trial active</span>
            <span>· ends {new Date(sub!.trial_ends_at!).toLocaleDateString()}</span>
          </CardContent>
        </Card>
      )}
    </SectionShell>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();

  // Assignments
  const canReadAssignments = hasPermission('assignments:read');
  const canWriteAssignments = hasPermission('assignments:write');
  const canReadReports = hasPermission('reports:read');
  const hasAssignments = hasModule('assignments');

  // Assessments
  const canTakeAssessments = hasPermission('assessments:take');
  const canManageAssessments = hasPermission('assessments:read');
  const hasAssessments = hasModule('assessments');

  // Compliance
  const canReadCompliance = hasPermission('compliance:read');
  const hasCompliance = hasModule('compliance');

  // Integration Registry
  const canReadIr = hasPermission('ir:read');
  const hasIr = hasModule('integration_registry');

  // Releases
  const canReadReleases = hasPermission('releases:read');
  const hasReleases = hasModule('releases');

  // Billing
  const canReadBilling = hasPermission('billing:read');
  const hasBilling = hasModule('billing');

  const showAssignments = hasAssignments && canReadAssignments;
  const showAssessments = hasAssessments && (canTakeAssessments || canManageAssessments);
  const showCompliance = hasCompliance && canReadCompliance;
  const showIr = hasIr && canReadIr;
  const showReleases = hasReleases && canReadReleases;
  const showBilling = hasBilling && canReadBilling;

  const isAdmin = canWriteAssignments;

  // Data state
  const [adminData, setAdminData] = useState<AdminDashboardReport | null>(null);
  const [employeeData, setEmployeeData] = useState<EmployeeDashboardReport | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [nextTask, setNextTask] = useState<NextTaskResponse | null>(null);
  const [tests, setTests] = useState<AvailableTest[]>([]);
  const [compliance, setCompliance] = useState<ComplianceDashboard | null>(null);
  const [ir, setIr] = useState<IrOverview | null>(null);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tenantLoading || !accessToken) return;

    const fetches: Promise<unknown>[] = [];

    if (showAssignments) {
      fetches.push(
        api.get<AssignmentListResponse>('/assignments?page=1&page_size=5', accessToken)
          .then((res) => {
            setAssignments(res.items);
            if (!isAdmin && res.items[0]) {
              return api.get<NextTaskResponse>(
                `/progress/assignments/${res.items[0].id}/next-task`,
                accessToken,
              ).then(setNextTask).catch(() => null);
            }
          })
          .catch(() => null),
      );

      if (canReadReports) {
        if (isAdmin) {
          fetches.push(
            api.get<AdminDashboardReport>('/reports/admin-dashboard', accessToken)
              .then(setAdminData).catch(() => null),
          );
        } else {
          fetches.push(
            api.get<EmployeeDashboardReport>('/reports/employee-dashboard', accessToken)
              .then(setEmployeeData).catch(() => null),
          );
        }
      }
    }

    if (showAssessments && canTakeAssessments) {
      fetches.push(
        api.get<{ items: AvailableTest[] }>('/assessments/available', accessToken)
          .then((res) => setTests(res.items)).catch(() => null),
      );
    }

    if (showCompliance) {
      fetches.push(
        api.get<ComplianceDashboard>('/compliance/dashboard', accessToken)
          .then(setCompliance).catch(() => null),
      );
    }

    if (showIr) {
      fetches.push(
        api.get<IrOverview>('/integration-registry/overview', accessToken)
          .then(setIr).catch(() => null),
      );
    }

    if (showReleases) {
      fetches.push(
        api.get<{ items: ReleaseSummary[] }>('/release-center?page_size=5', accessToken)
          .then((res) => setReleases(res.items)).catch(() => null),
      );
    }

    if (showBilling) {
      fetches.push(
        api.get<BillingOverview>('/billing/overview', accessToken)
          .then(setBilling).catch(() => null),
      );
    }

    Promise.allSettled(fetches).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, tenantLoading]);

  if (loading || tenantLoading) {
    return <LoadingState label='Loading dashboard...' />;
  }

  const hasSomething = showAssignments || showAssessments || showCompliance || showIr || showReleases || showBilling;

  if (!hasSomething) {
    return null;
  }

  // Badge counts for the sticky nav
  const assignmentsBadge = isAdmin
    ? (adminData?.overdue_tasks ?? 0)
    : (employeeData?.overdue_tasks ?? 0);
  const assessmentsBadge = tests.filter(
    (t) => t.attempt_status === 'not_started' || t.attempt_status === 'in_progress',
  ).length;
  const complianceBadge = compliance
    ? Object.values(compliance.gaps_by_severity).reduce((s, n) => s + n, 0)
    : 0;
  const irBadge = ir?.draft_count ?? 0;
  const releasesBadge = releases.length;
  const billingBadge = billing?.subscription?.trial_ends_at
    ? new Date(billing.subscription.trial_ends_at) > new Date() ? 1 : 0
    : 0;

  const navSections: NavSection[] = [
    ...(showAssignments ? [{
      id: 'section-assignments',
      label: 'Assignments',
      icon: ClipboardList,
      badge: assignmentsBadge,
      badgeVariant: assignmentsBadge > 0 ? 'warning' as const : undefined,
    }] : []),
    ...(showAssessments ? [{
      id: 'section-assessments',
      label: 'Assessments',
      icon: FileQuestion,
      badge: assessmentsBadge,
      badgeVariant: assessmentsBadge > 0 ? 'default' as const : undefined,
    }] : []),
    ...(showCompliance && compliance ? [{
      id: 'section-compliance',
      label: 'Compliance',
      icon: ShieldCheck,
      badge: complianceBadge,
      badgeVariant: complianceBadge > 0 ? 'alert' as const : undefined,
    }] : []),
    ...(showIr && ir ? [{
      id: 'section-ir',
      label: 'Integrations',
      icon: Network,
      badge: irBadge,
      badgeVariant: undefined,
    }] : []),
    ...(showReleases ? [{
      id: 'section-releases',
      label: 'Releases',
      icon: Rocket,
      badge: releasesBadge,
      badgeVariant: undefined,
    }] : []),
    ...(showBilling && billing ? [{
      id: 'section-billing',
      label: 'Billing',
      icon: CreditCard,
      badge: billingBadge,
      badgeVariant: billingBadge > 0 ? 'warning' as const : undefined,
    }] : []),
  ];

  const sectionNodes = [
    showAssignments ? (
      <AssignmentsSection
        key='assignments'
        isAdmin={isAdmin}
        adminData={adminData}
        employeeData={employeeData}
        assignments={assignments}
        nextTask={nextTask}
      />
    ) : null,
    showAssessments ? (
      <AssessmentsSection key='assessments' canManage={canManageAssessments} tests={tests} />
    ) : null,
    showCompliance && compliance ? (
      <ComplianceSection key='compliance' data={compliance} />
    ) : null,
    showIr && ir ? (
      <IntegrationRegistrySection key='ir' data={ir} />
    ) : null,
    showReleases ? (
      <ReleasesSection key='releases' releases={releases} />
    ) : null,
    showBilling && billing ? (
      <BillingSection key='billing' data={billing} />
    ) : null,
  ].filter(Boolean);

  const isOdd = sectionNodes.length % 2 !== 0;

  return (
    <>
      <StickyNav sections={navSections} />

      <div className='grid gap-6 lg:grid-cols-2'>
        {sectionNodes.map((node, i) => (
          <div key={i} className={isOdd && i === sectionNodes.length - 1 ? 'lg:col-span-2' : ''}>
            {node}
          </div>
        ))}
      </div>
    </>
  );
}
