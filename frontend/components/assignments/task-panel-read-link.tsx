import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TaskResourceList } from '@/components/assignments/task-resource-list';
import type { AssignmentTask, TaskResource } from '@/lib/types';

interface TaskPanelReadLinkProps {
  task: AssignmentTask;
  resources?: TaskResource[];
  comment: string;
  onCommentChange: (value: string) => void;
  commentOpen: boolean;
  onToggleComment: () => void;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
}

export function TaskPanelReadLink({
  task,
  resources,
  comment,
  onCommentChange,
  commentOpen,
  onToggleComment,
  submitting,
  disabled,
  onSubmit,
}: TaskPanelReadLinkProps) {
  const helper = useMemo(() => {
    if (task.task_type === 'video') return 'Watch the resource and mark as complete.';
    if (task.task_type === 'external_link') return 'Open the link and confirm when finished.';
    return 'Read the material and mark as complete.';
  }, [task.task_type]);

  return (
    <div className='space-y-4'>
      {task.instructions ? (
        <div className='rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground'>{task.instructions}</div>
      ) : null}

      <TaskResourceList resources={resources} />

      <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
        {helper}
      </div>

      {commentOpen ? (
        <div className='space-y-2'>
          <Label>Comment (optional)</Label>
          <Textarea
            rows={4}
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder='Add a short note about what you learned or verified.'
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className='flex flex-wrap gap-2'>
        <Button onClick={onSubmit} disabled={disabled || submitting}>
          {submitting ? 'Saving...' : 'Mark complete'}
        </Button>
        <Button type='button' variant='outline' onClick={onToggleComment} disabled={disabled}>
          {commentOpen ? 'Hide comment' : 'Add comment'}
        </Button>
      </div>
    </div>
  );
}

