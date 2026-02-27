'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

  const [employees, setEmployees] = useState<UserRow[]>([]);
  const [mentors, setMentors] = useState<UserRow[]>([]);
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
        api.get<UserListResponse>('/users?page=1&page_size=100', accessToken),
        api.get<TrackListResponse>('/tracks?page=1&page_size=100', accessToken),
      ]);

      const employeeRows = usersResponse.items.filter((user) => user.tenant_role === 'member');
      const mentorRows = usersResponse.items.filter((user) => user.tenant_role === 'mentor');

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

      setEmployees(employeeRows);
      setMentors(mentorRows);
      setPublishedVersions(versions);

      if (employeeRows[0]) setEmployeeId(employeeRows[0].id);
      if (mentorRows[0]) setMentorId(mentorRows[0].id);
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
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name} ({employee.email})
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-2'>
            <Label>Mentor</Label>
            <select
              value={mentorId}
              onChange={(event) => setMentorId(event.target.value)}
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
            >
              <option value=''>No mentor</option>
              {mentors.map((mentor) => (
                <option key={mentor.id} value={mentor.id}>
                  {mentor.full_name} ({mentor.email})
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-2 md:col-span-2'>
            <Label>Published track version</Label>
            <select
              value={trackVersionId}
              onChange={(event) => setTrackVersionId(event.target.value)}
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
            >
              {publishedVersions.map((version) => (
                <option key={version.versionId} value={version.versionId}>
                  {version.label}
                </option>
              ))}
            </select>
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
