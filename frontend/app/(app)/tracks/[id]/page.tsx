'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MarkdownRenderer } from '@/components/common/markdown-renderer';
import { StatusChip } from '@/components/common/status-chip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TrackTemplate } from '@/lib/types';

export default function TrackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [track, setTrack] = useState<TrackTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!accessToken || !id) return;
      setLoading(true);
      try {
        const response = await api.get<TrackTemplate>(`/tracks/${id}`, accessToken);
        setTrack(response);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken, id]);

  if (loading) return <LoadingState label='Loading track template...' />;
  if (!track) return <EmptyState title='Track not found' description='The requested track does not exist.' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>{track.title}</h2>
          <p className='text-sm text-muted-foreground'>{track.description || 'No description provided.'}</p>
        </div>
        <Button variant='secondary' asChild>
          <Link href={`/tracks/${track.id}/publish`}>Manage publish</Link>
        </Button>
      </div>

      {track.versions.length === 0 ? (
        <EmptyState title='No versions' description='Create a version to begin configuring this template.' />
      ) : (
        <div className='space-y-4'>
          {track.versions
            .slice()
            .sort((a, b) => b.version_number - a.version_number)
            .map((version) => (
              <Card key={version.id}>
                <CardHeader>
                  <div className='flex items-center justify-between'>
                    <CardTitle>Version {version.version_number}</CardTitle>
                    <StatusChip status={version.status} />
                  </div>
                  <CardDescription>
                    {version.title} • {version.estimated_duration_days} days • {version.tags.join(', ') || 'no tags'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {version.phases.length === 0 ? (
                    <EmptyState title='No phases' description='Add phases and tasks in this version to publish.' />
                  ) : (
                    <Accordion type='multiple' className='space-y-2'>
                      {version.phases
                        .slice()
                        .sort((a, b) => a.order_index - b.order_index)
                        .map((phase) => (
                          <AccordionItem key={phase.id} value={phase.id} className='rounded-md border px-3'>
                            <AccordionTrigger>
                              <div>
                                <p>{phase.title}</p>
                                <p className='text-xs text-muted-foreground'>
                                  {phase.tasks.length} tasks
                                </p>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <ul className='space-y-2'>
                                {phase.tasks
                                  .slice()
                                  .sort((a, b) => a.order_index - b.order_index)
                                  .map((task) => (
                                    <li key={task.id} className='rounded-md border bg-muted/30 p-3'>
                                      <div className='flex items-center justify-between'>
                                        <p className='font-medium'>{task.title}</p>
                                        <StatusChip status={task.task_type} />
                                      </div>
                                      <p className='mt-1 text-xs text-muted-foreground'>
                                        {task.instructions || task.description || 'No instructions provided.'}
                                      </p>
                                      {task.resources
                                        .filter((resource) => resource.resource_type === 'markdown_text' && resource.content_text)
                                        .slice(0, 1)
                                        .map((resource) => (
                                          <div key={resource.id} className='mt-3 rounded-md bg-white p-3'>
                                            <MarkdownRenderer content={resource.content_text || ''} />
                                          </div>
                                        ))}
                                    </li>
                                  ))}
                              </ul>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
