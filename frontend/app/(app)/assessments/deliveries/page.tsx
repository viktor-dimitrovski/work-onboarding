'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MultiSelect } from '@/components/inputs/multi-select';
import { SingleSelect } from '@/components/inputs/single-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentDelivery, AssessmentTest, UserRow } from '@/lib/types';

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

export default function AssessmentDeliveriesPage() {
  const { accessToken } = useAuth();
  const [deliveries, setDeliveries] = useState<AssessmentDelivery[]>([]);
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState('');

  const [testVersionId, setTestVersionId] = useState('');
  const [audienceType, setAudienceType] = useState<'assignment' | 'campaign'>('assignment');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [attemptsAllowed, setAttemptsAllowed] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [dueDate, setDueDate] = useState('');

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [deliveryResponse, testsResponse] = await Promise.all([
        api.get<DeliveryListResponse>('/assessments/deliveries?page=1&page_size=100', accessToken),
        api.get<TestListResponse>('/assessments/tests?page=1&page_size=100&status=published', accessToken),
      ]);
      setDeliveries(deliveryResponse.items);
      setTests(testsResponse.items);
      try {
        const usersResponse = await api.get<UserListResponse>('/users?page=1&page_size=200', accessToken);
        setUsers(usersResponse.items.filter((u) => u.tenant_status !== 'disabled'));
      } catch {
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  const publishedVersionOptions = tests.flatMap((test) =>
    test.versions
      .filter((v) => v.status === 'published')
      .map((v) => ({ value: v.id, label: `${test.title} v${v.version_number}` })),
  );

  const userOptions = users.map((u) => ({
    value: u.id,
    label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
  }));

  const resetForm = () => {
    setTestVersionId('');
    setAudienceType('assignment');
    setSelectedUserIds([]);
    setAttemptsAllowed(1);
    setDurationMinutes('');
    setStartsAt('');
    setEndsAt('');
    setDueDate('');
    setCreateError(null);
    setCreateProgress('');
  };

  const createDeliveries = async () => {
    if (!accessToken || !testVersionId) return;
    setCreating(true);
    setCreateError(null);

    try {
      if (audienceType === 'campaign') {
        await api.post('/assessments/deliveries', {
          test_version_id: testVersionId,
          audience_type: 'campaign',
          attempts_allowed: attemptsAllowed,
          duration_minutes: durationMinutes || null,
          starts_at: startsAt || null,
          ends_at: endsAt || null,
          due_date: dueDate || null,
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
            due_date: dueDate || null,
          }, accessToken);
        }
      }
      setSheetOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create delivery');
    } finally {
      setCreating(false);
      setCreateProgress('');
    }
  };

  const formatDate = (d?: string | null) => {
    if (!d) return null;
    try {
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  };

  if (loading) return <LoadingState label='Loading deliveries...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Deliveries</h2>
          <p className='text-sm text-muted-foreground'>Assign assessment tests to employees or open to all.</p>
        </div>
        <Button onClick={() => { resetForm(); setSheetOpen(true); }}>Assign test</Button>
      </div>

      {deliveries.length === 0 ? (
        <EmptyState title='No deliveries yet' description='Assign a test to get started.' />
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {deliveries.map((delivery) => (
            <Card key={delivery.id}>
              <CardHeader>
                <div className='flex items-start justify-between gap-2'>
                  <div>
                    <CardTitle className='text-base'>{delivery.title}</CardTitle>
                    <CardDescription className='mt-1'>
                      {delivery.audience_type === 'campaign' ? 'Open to all employees' : 'Targeted assignment'}
                    </CardDescription>
                  </div>
                  <Badge variant={delivery.audience_type === 'campaign' ? 'secondary' : 'outline'} className='capitalize shrink-0'>
                    {delivery.audience_type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                  <span>{delivery.attempts_allowed} attempt{delivery.attempts_allowed !== 1 ? 's' : ''}</span>
                  {delivery.duration_minutes && <span>{delivery.duration_minutes} min</span>}
                  {delivery.starts_at && <span>From {formatDate(delivery.starts_at)}</span>}
                  {delivery.ends_at && <span>Until {formatDate(delivery.ends_at)}</span>}
                  {delivery.due_date && <span>Due {formatDate(delivery.due_date)}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!creating) { setSheetOpen(open); if (!open) resetForm(); } }}>
        <SheetContent side='right' className='flex h-full flex-col sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>Assign test</SheetTitle>
            <p className='text-sm text-muted-foreground'>Create a delivery to assign a published test to employees.</p>
          </SheetHeader>

          <div className='mt-4 flex-1 space-y-5 overflow-auto pr-1'>
            <div className='space-y-2'>
              <Label>Published test version</Label>
              <SingleSelect
                value={testVersionId}
                onChange={setTestVersionId}
                options={publishedVersionOptions}
                placeholder='Select a published test…'
              />
            </div>

            <div className='space-y-2'>
              <Label>Delivery mode</Label>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant={audienceType === 'assignment' ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setAudienceType('assignment')}
                >
                  Targeted employees
                </Button>
                <Button
                  type='button'
                  variant={audienceType === 'campaign' ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setAudienceType('campaign')}
                >
                  Open to all
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                {audienceType === 'assignment'
                  ? 'Select specific employees who will receive this test.'
                  : 'The test will be visible to all employees within the time window.'}
              </p>
            </div>

            {audienceType === 'assignment' && (
              <div className='space-y-2'>
                <Label>Employees</Label>
                <MultiSelect
                  value={selectedUserIds}
                  onChange={setSelectedUserIds}
                  options={userOptions}
                  placeholder='Select employees…'
                />
              </div>
            )}

            <div className='rounded-md border bg-muted/20 p-4 space-y-4'>
              <p className='text-sm font-medium'>Scheduling & limits</p>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Available from</Label>
                  <Input type='datetime-local' value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>Available until</Label>
                  <Input type='datetime-local' value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>Due date</Label>
                  <Input type='date' value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>Duration (minutes)</Label>
                  <Input type='number' min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : '')} placeholder='Use test default' />
                </div>
                <div className='space-y-2'>
                  <Label>Attempts allowed</Label>
                  <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(Number(e.target.value || 1))} />
                </div>
              </div>
            </div>

            {createError && <p className='text-sm text-destructive'>{createError}</p>}
            {createProgress && <p className='text-sm text-muted-foreground'>{createProgress}</p>}
          </div>

          <SheetFooter className='mt-4'>
            <Button variant='outline' onClick={() => setSheetOpen(false)} disabled={creating}>Cancel</Button>
            <Button
              onClick={createDeliveries}
              disabled={creating || !testVersionId || (audienceType === 'assignment' && selectedUserIds.length === 0)}
            >
              {creating ? 'Creating…' : audienceType === 'campaign' ? 'Open test' : `Assign to ${selectedUserIds.length} employee${selectedUserIds.length !== 1 ? 's' : ''}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
