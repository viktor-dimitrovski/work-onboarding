"use client";

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatPercent } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { Assignment } from '@/lib/types';

type ReleaseMetadataOut = {
  assignment_id: string;
  metadata: Record<string, unknown>;
};

export default function ReleaseCenterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const load = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const assignmentData = await api.get<Assignment>(`/assignments/${id}`, accessToken);
      setAssignment(assignmentData);
      const meta = await api.get<ReleaseMetadataOut>(`/release-center/${id}/metadata`, accessToken);
      setMetadata(meta.metadata || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, id]);

  const saveMetadata = async () => {
    if (!accessToken || !id) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api.put<ReleaseMetadataOut>(
        `/release-center/${id}/metadata`,
        { metadata },
        accessToken,
      );
      setMetadata(response.metadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save metadata');
    } finally {
      setSaving(false);
    }
  };

  const environment = String(metadata.environment ?? '');
  const versionTag = String(metadata.version_tag ?? '');
  const relId = String(metadata.rel_id ?? '');
  const runbook = String((metadata.links as any)?.runbook ?? '');

  const updateMeta = (key: string, value: unknown) => {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  };

  const updateLink = (key: string, value: string) => {
    setMetadata((prev) => ({
      ...prev,
      links: { ...(prev.links as Record<string, unknown>), [key]: value },
    }));
  };

  const phases = useMemo(() => assignment?.phases?.slice().sort((a, b) => a.order_index - b.order_index) || [], [
    assignment,
  ]);

  if (loading) return <LoadingState label='Loading release...' />;
  if (!assignment) return <EmptyState title='Release not found' description='This release plan does not exist.' />;

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <CardTitle>{assignment.title}</CardTitle>
              <p className='text-xs text-muted-foreground'>
                Start {assignment.start_date} • Target {assignment.target_date}
              </p>
            </div>
            <StatusChip status={assignment.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className='flex items-center gap-3'>
            <Progress value={assignment.progress_percent} className='flex-1' />
            <span className='w-12 text-right text-xs text-muted-foreground'>
              {formatPercent(assignment.progress_percent)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Release metadata</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Environment</label>
            <Input
              value={environment}
              onChange={(event) => updateMeta('environment', event.target.value)}
              placeholder='prod'
            />
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Version tag</label>
            <Input value={versionTag} onChange={(event) => updateMeta('version_tag', event.target.value)} />
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>REL ID</label>
            <Input value={relId} onChange={(event) => updateMeta('rel_id', event.target.value)} />
          </div>
          <div className='space-y-2'>
            <label className='text-xs text-muted-foreground'>Runbook URL</label>
            <Input value={runbook} onChange={(event) => updateLink('runbook', event.target.value)} />
          </div>
          <div className='md:col-span-2 flex items-center gap-2'>
            {error && <p className='text-xs text-destructive'>{error}</p>}
            <Button onClick={saveMetadata} disabled={!canWrite || saving}>
              {saving ? 'Saving…' : 'Save metadata'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Phase timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type='multiple' className='space-y-2'>
            {phases.map((phase) => (
              <AccordionItem key={phase.id} value={phase.id} className='rounded-md border px-3'>
                <AccordionTrigger>
                  <div>
                    <p>{phase.title}</p>
                    <p className='text-xs text-muted-foreground'>
                      {phase.tasks.length} tasks • {formatPercent(phase.progress_percent)} complete
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className='space-y-2'>
                    {phase.tasks
                      .slice()
                      .sort((a, b) => a.order_index - b.order_index)
                      .map((task) => (
                        <div key={task.id} className='rounded-md border bg-muted/30 p-3'>
                          <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                              <p className='font-medium'>{task.title}</p>
                              <p className='text-xs text-muted-foreground'>
                                {task.task_type} • due {task.due_date || 'n/a'}
                              </p>
                            </div>
                            <StatusChip status={task.status} />
                          </div>
                        </div>
                      ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
