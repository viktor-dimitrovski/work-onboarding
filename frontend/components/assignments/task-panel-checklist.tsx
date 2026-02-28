import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AssignmentTask } from '@/lib/types';

interface ChecklistItem {
  id: string;
  text: string;
  required?: boolean;
}

interface TaskPanelChecklistProps {
  task: AssignmentTask;
  onToggleItem: (itemId: string, checked: boolean, comment?: string | null) => void;
  updatingItemId?: string | null;
  disabled?: boolean;
}

export function TaskPanelChecklist({ task, onToggleItem, updatingItemId, disabled }: TaskPanelChecklistProps) {
  const checklistMeta = (task.metadata?.checklist as Record<string, unknown>) || {};
  const checklistItems = (checklistMeta.items as ChecklistItem[]) || [];
  const checklistState = (task.metadata?.checklist_state as Record<string, unknown>) || {};
  const completedIds = new Set((checklistState.completed_item_ids as string[]) || []);
  const existingComments = (checklistState.comments as Record<string, string>) || {};

  const [commentOpen, setCommentOpen] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setCommentOpen({});
    setCommentDrafts(existingComments);
  }, [task.id]);

  const summary = useMemo(() => {
    const required = checklistItems.filter((item) => item.required !== false);
    const requiredCompleted = required.filter((item) => completedIds.has(item.id)).length;
    return { requiredCount: required.length, requiredCompleted };
  }, [checklistItems, completedIds]);

  if (checklistItems.length === 0) {
    return (
      <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
        No checklist items configured for this task.
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
        Required items: {summary.requiredCompleted}/{summary.requiredCount}
      </div>

      <div className='space-y-2'>
        {checklistItems.map((item) => {
          const checked = completedIds.has(item.id);
          const isUpdating = updatingItemId === item.id;
          const open = Boolean(commentOpen[item.id]);
          return (
            <div key={item.id} className='rounded-md border bg-white p-3'>
              <div className='flex items-start gap-3'>
                <input
                  type='checkbox'
                  checked={checked}
                  disabled={isUpdating || disabled}
                  onChange={(event) => onToggleItem(item.id, event.target.checked, commentDrafts[item.id])}
                />
                <div className='flex-1'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <p className='text-sm font-medium'>{item.text}</p>
                    {item.required === false ? (
                      <span className='text-xs text-muted-foreground'>Optional</span>
                    ) : null}
                  </div>
                  {existingComments[item.id] && !open ? (
                    <p className='mt-1 text-xs text-muted-foreground'>Note: {existingComments[item.id]}</p>
                  ) : null}
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    setCommentOpen((prev) => ({
                      ...prev,
                      [item.id]: !prev[item.id],
                    }))
                  }
                  disabled={disabled}
                >
                  {open ? 'Hide note' : 'Add note'}
                </Button>
              </div>

              {open && (
                <div className='mt-3 space-y-2'>
                  <Input
                    value={commentDrafts[item.id] ?? ''}
                    onChange={(event) =>
                      setCommentDrafts((prev) => ({
                        ...prev,
                        [item.id]: event.target.value,
                      }))
                    }
                    placeholder='Short note (optional)'
                  />
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      variant='secondary'
                    disabled={isUpdating || disabled}
                      onClick={() => onToggleItem(item.id, checked, commentDrafts[item.id])}
                    >
                      {isUpdating ? 'Saving...' : 'Save note'}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={() =>
                        setCommentDrafts((prev) => ({
                          ...prev,
                          [item.id]: '',
                        }))
                      }
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

