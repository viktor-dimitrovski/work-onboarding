import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TaskResourceList } from '@/components/assignments/task-resource-list';
import type { AssignmentTask, TaskResource } from '@/lib/types';

interface TaskPanelReviewRequiredProps {
  task: AssignmentTask;
  resources?: TaskResource[];
  answerText: string;
  onAnswerChange: (value: string) => void;
  fileUrl: string;
  onFileUrlChange: (value: string) => void;
  submitting: boolean;
  disabled: boolean;
  pendingReview: boolean;
  onSubmit: () => void;
}

export function TaskPanelReviewRequired({
  task,
  resources,
  answerText,
  onAnswerChange,
  fileUrl,
  onFileUrlChange,
  submitting,
  disabled,
  pendingReview,
  onSubmit,
}: TaskPanelReviewRequiredProps) {
  return (
    <div className='space-y-4'>
      {task.instructions ? (
        <div className='rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground'>{task.instructions}</div>
      ) : null}

      <TaskResourceList resources={resources} />

      {pendingReview && (
        <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
          Waiting for mentor review. You can resubmit only if revisions are requested.
        </div>
      )}

      <div className='space-y-2'>
        <Label>Response</Label>
        <Textarea
          rows={5}
          placeholder='Describe what you completed, answers, or links to evidence.'
          value={answerText}
          onChange={(event) => onAnswerChange(event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className='space-y-2'>
        <Label>File URL (optional)</Label>
        <input
          value={fileUrl}
          onChange={(event) => onFileUrlChange(event.target.value)}
          placeholder='https://files.example.com/...'
          className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
          disabled={disabled}
        />
      </div>

      <Button onClick={onSubmit} disabled={disabled || submitting}>
        {submitting ? 'Submitting...' : 'Submit for review'}
      </Button>
    </div>
  );
}

