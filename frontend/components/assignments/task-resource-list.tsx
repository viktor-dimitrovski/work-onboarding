import { ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { TaskResource } from '@/lib/types';

function resourceLabel(resource: TaskResource) {
  return resource.title || resource.resource_type.replace('_', ' ');
}

export function TaskResourceList({ resources }: { resources?: TaskResource[] }) {
  if (!resources || resources.length === 0) return null;

  return (
    <div className='space-y-2'>
      {resources.map((resource) => (
        <div key={resource.id} className='flex items-center justify-between rounded-md border bg-white px-3 py-2'>
          <div className='min-w-0'>
            <p className='truncate text-sm font-medium'>{resourceLabel(resource)}</p>
            {resource.content_text ? (
              <p className='mt-1 text-xs text-muted-foreground line-clamp-2'>{resource.content_text}</p>
            ) : null}
          </div>
          {resource.url ? (
            <Button asChild size='sm' variant='outline'>
              <a href={resource.url} target='_blank' rel='noreferrer'>
                Open
                <ExternalLink className='ml-2 h-3.5 w-3.5' />
              </a>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

