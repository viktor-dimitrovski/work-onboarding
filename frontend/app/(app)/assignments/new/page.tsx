'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { SingleSelect } from '@/components/inputs/single-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { TrackTemplate, UserRow } from '@/lib/types';

interface TrackListResponse {
  items: TrackTemplate[];
  meta: { page: number; page_size: number; total: number };
}

interface UserListResponse {
  items: UserRow[];
  meta: { page: number; page_size: number; total: number };
}

export default function NewAssignmentPage() {
  const { accessToken, isLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const router = useRouter();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [publishedVersions, setPublishedVersions] = useState<
    Array<{ templateId: string; versionId: string; label: string }>
  >([]);

  const [employeeId, setEmployeeId] = useState('');
  const [mentorId, setMentorId] = useState('');
  const [trackVersionId, setTrackVersionId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !tenantLoading && !(hasModule('assignments') && hasPermission('assignments:write'))) {
      router.replace('/assignments');
    }
  }, [hasModule, hasPermission, isLoading, router, tenantLoading]);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;

      const [usersResponse, tracksResponse] = await Promise.all([
        api.get<UserListResponse>('/users?page=1&page_size=200', accessToken),
        api.get<TrackListResponse>('/tracks?page=1&page_size=100', accessToken),
      ]);

      const activeUsers = usersResponse.items.filter((user) => user.tenant_status !== 'disabled');

      const versions = tracksResponse.items
        .filter((track) => track.is_active)
        .flatMap((track) =>
          track.versions
            .filter((version) => version.status === 'published')
            .map((version) => ({
              templateId: track.id,
              versionId: version.id,
              label: `${track.title} v${version.version_number}`,
            })),
        )
        .sort((a, b) => a.label.localeCompare(b.label));

      setUsers(activeUsers);
      setPublishedVersions(versions);

      if (activeUsers[0]) setEmployeeId(activeUsers[0].id);
      if (versions[0]) setTrackVersionId(versions[0].versionId);
    };

    void run();
  }, [accessToken]);

  const disabled = useMemo(
    () => !employeeId || !trackVersionId || !startDate || !targetDate || saving,
    [employeeId, saving, startDate, targetDate, trackVersionId],
  );

  const submit = async () => {
    if (!accessToken || disabled) return;
    setSaving(true);
    setError(null);

    try {
      const created = await api.post<{ id: string }>(
        '/assignments',
        {
          employee_id: employeeId,
          mentor_id: mentorId || null,
          track_version_id: trackVersionId,
          start_date: startDate,
          target_date: targetDate,
        },
        accessToken,
      );
      router.replace(`/assignments/${created.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create assignment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Create assignment</h2>
        <p className='text-sm text-muted-foreground'>Assign a published track to employee with mentor support.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assignment setup</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Label>Employee</Label>
            <SingleSelect
              value={employeeId}
              onChange={setEmployeeId}
              placeholder='Select employee…'
              options={users.map((u) => ({
                value: u.id,
                label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
              }))}
            />
          </div>

          <div className='space-y-2'>
            <Label>Mentor</Label>
            <SingleSelect
              value={mentorId}
              onChange={setMentorId}
              placeholder='No mentor'
              options={[
                { value: '', label: 'No mentor' },
                ...users
                  .filter((u) => u.id !== employeeId)
                  .map((u) => ({
                    value: u.id,
                    label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
                  })),
              ]}
            />
          </div>

          <div className='space-y-2 md:col-span-2'>
            <Label>Published track version</Label>
            <SingleSelect
              value={trackVersionId}
              onChange={setTrackVersionId}
              placeholder='Select track version…'
              options={publishedVersions.map((v) => ({ value: v.versionId, label: v.label }))}
            />
          </div>

          <div className='space-y-2'>
            <Label>Start date</Label>
            <Input type='date' value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>

          <div className='space-y-2'>
            <Label>Target date</Label>
            <Input type='date' value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          </div>

          {error && <p className='text-sm text-destructive md:col-span-2'>{error}</p>}

          <div className='md:col-span-2 flex gap-2'>
            <Button onClick={submit} disabled={disabled}>
              {saving ? 'Creating...' : 'Create assignment'}
            </Button>
            <Button variant='outline' onClick={() => router.push('/assignments')}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
