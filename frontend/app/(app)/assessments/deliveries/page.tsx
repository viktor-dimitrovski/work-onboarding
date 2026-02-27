'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentDelivery, AssessmentTest } from '@/lib/types';

interface DeliveryListResponse {
  items: AssessmentDelivery[];
  meta: { page: number; page_size: number; total: number };
}

interface TestListResponse {
  items: AssessmentTest[];
  meta: { page: number; page_size: number; total: number };
}

export default function AssessmentDeliveriesPage() {
  const { accessToken } = useAuth();
  const [deliveries, setDeliveries] = useState<AssessmentDelivery[]>([]);
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [testVersionId, setTestVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [audienceType, setAudienceType] = useState('campaign');
  const [participantUserId, setParticipantUserId] = useState('');
  const [attemptsAllowed, setAttemptsAllowed] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await api.get<DeliveryListResponse>('/assessments/deliveries?page=1&page_size=100', accessToken);
      setDeliveries(response.items);
      const testsResponse = await api.get<TestListResponse>('/assessments/tests?page=1&page_size=100', accessToken);
      setTests(testsResponse.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading deliveries...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Deliveries</h2>
          <p className='text-sm text-muted-foreground'>Schedule assessments for employees or campaigns.</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>New delivery</Button>
      </div>

      {deliveries.length === 0 ? (
        <EmptyState title='No deliveries yet' description='Create a delivery to assign an assessment.' />
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {deliveries.map((delivery) => (
            <Card key={delivery.id}>
              <CardHeader>
                <CardTitle className='text-base'>{delivery.title}</CardTitle>
                <CardDescription>{delivery.audience_type}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='text-xs text-muted-foreground'>
                  <p>Test version: {delivery.test_version_id}</p>
                  <p>Attempts allowed: {delivery.attempts_allowed}</p>
                  {delivery.due_date && <p>Due: {delivery.due_date}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='flex h-full flex-col'>
          <SheetHeader>
            <SheetTitle>New delivery</SheetTitle>
          </SheetHeader>
          <div className='mt-4 flex-1 space-y-4 overflow-auto pr-1'>
            <div className='space-y-2'>
              <Label>Test version</Label>
              <select
                className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                value={testVersionId}
                onChange={(event) => setTestVersionId(event.target.value)}
              >
                <option value=''>Select a published version</option>
                {tests.flatMap((test) =>
                  test.versions
                    .filter((version) => version.status === 'published')
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        {test.title} v{version.version_number}
                      </option>
                    )),
                )}
              </select>
            </div>
            <div className='space-y-2'>
              <Label>Title</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Audience type</Label>
              <select
                className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                value={audienceType}
                onChange={(event) => setAudienceType(event.target.value)}
              >
                <option value='campaign'>Campaign</option>
                <option value='assignment'>Assignment</option>
              </select>
            </div>
            <div className='space-y-2'>
              <Label>Participant user id (optional)</Label>
              <Input
                value={participantUserId}
                onChange={(event) => setParticipantUserId(event.target.value)}
                placeholder='UUID for a single user'
              />
            </div>
            <div className='grid gap-3 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Attempts allowed</Label>
                <Input
                  type='number'
                  min={1}
                  value={attemptsAllowed}
                  onChange={(event) => setAttemptsAllowed(Number(event.target.value || 1))}
                />
              </div>
              <div className='space-y-2'>
                <Label>Duration (minutes)</Label>
                <Input
                  type='number'
                  min={1}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value ? Number(event.target.value) : '')}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Due date</Label>
              <Input type='date' value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
          </div>
          <SheetFooter className='mt-4'>
            <Button variant='outline' onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!accessToken || !testVersionId) return;
                await api.post(
                  '/assessments/deliveries',
                  {
                    test_version_id: testVersionId,
                    title: title.trim() || null,
                    audience_type: audienceType,
                    participant_user_id: participantUserId.trim() || null,
                    attempts_allowed: attemptsAllowed,
                    duration_minutes: durationMinutes || null,
                    due_date: dueDate || null,
                  },
                  accessToken,
                );
                setSheetOpen(false);
                setTitle('');
                setAudienceType('campaign');
                setParticipantUserId('');
                setAttemptsAllowed(1);
                setDurationMinutes('');
                setDueDate('');
                await load();
              }}
            >
              Create delivery
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
