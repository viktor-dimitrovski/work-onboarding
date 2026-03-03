"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type SummaryItem = {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  compliance: number | null;
};

type SummaryResponse = {
  overall: SummaryItem;
  by_framework: SummaryItem[];
  by_domain: SummaryItem[];
};

type DashboardResponse = {
  implementation: SummaryItem;
  coverage_percent: number | null;
  gaps_by_severity: Record<string, number>;
  open_work_items: number;
  last_snapshot_at: string | null;
  top_gaps: Array<{
    control_key: string;
    title: string;
    criticality: string;
    score: number;
  }>;
};

type TrendPoint = {
  computed_at: string;
  implementation_percent: number | null;
  coverage_percent: number | null;
};

type TrendResponse = {
  scope: string;
  points: TrendPoint[];
};

type Profile = {
  profile_key: string;
  name: string;
  description: string;
  is_active: boolean;
};

type ProfileResponse = {
  items: Profile[];
};

const formatPercent = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
};

export default function ComplianceHubPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule('compliance') && hasPermission('compliance:read'))) {
      router.replace('/dashboard');
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [summaryData, profileData, dashboardData, trendData] = await Promise.all([
        api.get<SummaryResponse>('/compliance/summary', accessToken),
        api.get<ProfileResponse>('/compliance/profiles', accessToken),
        api.get<DashboardResponse>('/compliance/dashboard', accessToken),
        api.get<TrendResponse>('/compliance/trends?scope=overall&window=90', accessToken),
      ]);
      setSummary(summaryData);
      setProfiles(profileData.items || []);
      setDashboard(dashboardData);
      setTrends(trendData.points || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  const activeProfile = profiles.find((profile) => profile.is_active);

  const enableProfile = async (profileKey: string) => {
    if (!accessToken) return;
    setProfileSaving(true);
    setError(null);
    try {
      await api.post(`/compliance/tenant/profiles/${profileKey}:enable`, {}, accessToken);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate profile');
    } finally {
      setProfileSaving(false);
    }
  };

  if (loading) return <LoadingState label='Loading compliance hub...' />;

  const trendValues = trends
    .filter((item) => item.implementation_percent !== null)
    .map((item) => item.implementation_percent ?? 0);
  const trendMin = trendValues.length ? Math.min(...trendValues) : 0;
  const trendMax = trendValues.length ? Math.max(...trendValues) : 1;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Compliance Hub</h2>
          <p className='text-sm text-muted-foreground'>Standards tracking, control coverage, and evidence vault.</p>
        </div>
        <div className='flex gap-2'>
          <Button type='button' variant='outline' onClick={() => router.push('/compliance-hub/practices')}>
            Practices
          </Button>
          <Button type='button' variant='outline' onClick={() => router.push('/compliance-hub/gaps')}>
            Gaps
          </Button>
          <Button type='button' variant='outline' onClick={() => router.push('/compliance-hub/clients')}>
            Clients
          </Button>
        </div>
      </div>

      {error ? <p className='text-sm text-red-600'>{error}</p> : null}

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <Card>
          <CardHeader>
            <CardTitle>Overall compliance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-4xl font-semibold'>
              {formatPercent(dashboard?.implementation?.compliance ?? summary?.overall?.compliance ?? null)}
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              Weighted by control criticality, excluding N/A controls.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active profile</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-2'>
              <Label>Profile</Label>
              <select
                className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                value={activeProfile?.profile_key ?? ''}
                onChange={(e) => enableProfile(e.target.value)}
                disabled={profileSaving || profiles.length === 0}
              >
                <option value='' disabled>
                  {profiles.length === 0 ? 'No profiles available' : 'Select profile'}
                </option>
                {profiles.map((profile) => (
                  <option key={profile.profile_key} value={profile.profile_key}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            {activeProfile ? (
              <p className='text-xs text-muted-foreground'>{activeProfile.description}</p>
            ) : (
              <p className='text-xs text-muted-foreground'>Activate a profile to start tracking compliance.</p>
            )}
            <Button
              type='button'
              variant='outline'
              disabled={!activeProfile || profileSaving}
              onClick={() => activeProfile && enableProfile(activeProfile.profile_key)}
            >
              {profileSaving ? 'Updating...' : 'Re-apply profile'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className='grid gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-semibold'>
              {formatPercent(dashboard?.coverage_percent ?? null)}
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>Reviewed mapping coverage from practices and clients.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open gaps</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-sm'>
            {Object.keys(dashboard?.gaps_by_severity || {}).length ? (
              Object.entries(dashboard?.gaps_by_severity || {}).map(([key, value]) => (
                <div key={key} className='flex items-center justify-between'>
                  <span>{key}</span>
                  <span className='font-medium'>{value}</span>
                </div>
              ))
            ) : (
              <p className='text-xs text-muted-foreground'>No gaps computed yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Work items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-semibold'>{dashboard?.open_work_items ?? 0}</div>
            <p className='mt-2 text-xs text-muted-foreground'>Linked Jira, work orders, or tracks.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Implementation trend (90 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {trends.length < 2 ? (
            <EmptyState title='No trend data yet' description='Run snapshots to build trends.' />
          ) : (
            <svg viewBox='0 0 300 120' className='h-32 w-full'>
              <polyline
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                points={trends
                  .map((point, idx) => {
                    const x = (idx / (trends.length - 1)) * 300;
                    const value = point.implementation_percent ?? 0;
                    const normalized = trendMax === trendMin ? 0.5 : (value - trendMin) / (trendMax - trendMin);
                    const y = 110 - normalized * 100;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />
            </svg>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top gaps</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard?.top_gaps?.length ? (
            <div className='space-y-2'>
              {dashboard.top_gaps.map((gap) => (
                <div key={gap.control_key} className='flex items-center justify-between rounded border px-3 py-2'>
                  <div>
                    <div className='text-sm font-medium'>{gap.title}</div>
                    <div className='text-xs text-muted-foreground'>{gap.control_key}</div>
                  </div>
                  <div className='text-right'>
                    <div className='text-sm font-semibold'>{(gap.score * 100).toFixed(0)}%</div>
                    <div className='text-xs text-muted-foreground'>{gap.criticality}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title='No gaps yet' description='Update statuses or run mapping to populate gaps.' />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Framework coverage</CardTitle>
        </CardHeader>
        <CardContent>
          {summary?.by_framework?.length ? (
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              {summary.by_framework.map((item) => (
                <Link
                  key={item.key}
                  href={`/compliance-hub/frameworks/${item.key}`}
                  className='rounded-lg border p-4 transition hover:border-primary/40 hover:bg-muted/20'
                >
                  <div className='text-sm font-semibold'>{item.label}</div>
                  <div className='mt-2 text-2xl font-semibold'>{formatPercent(item.compliance)}</div>
                  <div className='mt-1 text-xs text-muted-foreground'>
                    {item.numerator.toFixed(2)} / {item.denominator.toFixed(2)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title='No frameworks yet'
              description='Import the seed dataset or enable a profile to see framework coverage.'
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domain breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {summary?.by_domain?.length ? (
            <div className='space-y-3'>
              {summary.by_domain.map((item) => (
                <div key={item.key} className='flex items-center justify-between rounded border px-3 py-2'>
                  <span className='text-sm font-medium'>{item.label}</span>
                  <span className='text-sm text-muted-foreground'>{formatPercent(item.compliance)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>No domain data available yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
