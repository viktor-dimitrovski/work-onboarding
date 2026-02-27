import { useEffect, useMemo, useState } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ArrowDown, ArrowUp, ChevronDown, Copy, MoreHorizontal, Trash2 } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { taskTypeOptions } from '@/lib/constants';
import { TaskDetailsSheet } from './task-details-sheet';
import { cn } from '@/lib/utils';

const DEFAULT_HOURS_PER_DAY = 6;

export type TaskType =
  | 'read_material'
  | 'video'
  | 'checklist'
  | 'quiz'
  | 'code_assignment'
  | 'external_link'
  | 'mentor_approval'
  | 'file_upload'
  | 'assessment_test';

export type QuizQuestion = {
  type: 'single' | 'multi';
  prompt: string;
  options: string[];
  correct_option_ids: number[];
  points: number;
  difficulty?: 'easy' | 'medium' | 'hard';
};

export interface DraftResource {
  client_id: string;
  resource_type: string;
  title: string;
  url?: string | null;
  content_text?: string | null;
  order_index: number;
  metadata?: Record<string, unknown>;
}

export interface DraftTask {
  client_id: string;
  title: string;
  task_type: TaskType;
  order_index: number;
  required: boolean;
  instructions: string;
  estimated_minutes: number;
  passing_score?: number | null;
  metadata?: Record<string, unknown>;
  resources?: DraftResource[];
  due_days_offset?: number | null;
  source_task_id?: string | null;
}

export interface DraftPhase {
  client_id: string;
  title: string;
  description: string;
  order_index: number;
  tasks: DraftTask[];
  source_phase_id?: string | null;
}

export interface TrackBuilderState {
  phases: DraftPhase[];
  setPhases: (next: DraftPhase[]) => void;
  estimatedDurationDays: number;
  onAddPhase?: () => void;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string | null) => void;
  selectedPhaseId?: string | null;
}

function buildId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePhaseOrder(phases: DraftPhase[]): DraftPhase[] {
  return phases.map((phase, idx) => ({ ...phase, order_index: idx }));
}

function normalizeTaskOrder(tasks: DraftTask[]): DraftTask[] {
  return tasks.map((task, idx) => ({ ...task, order_index: idx }));
}

function createEmptyTask(): DraftTask {
  return {
    client_id: buildId('task'),
    title: 'New task',
    task_type: 'checklist',
    order_index: 0,
    required: true,
    instructions: '',
    estimated_minutes: 15,
    metadata: {},
    resources: [],
  };
}

function createEmptyPhase(index: number): DraftPhase {
  return {
    client_id: buildId('phase'),
    title: `Phase ${index + 1}`,
    description: '',
    order_index: index,
    tasks: [createEmptyTask()],
  };
}

function parseBulkTasks(raw: string): DraftTask[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const minutesMatch = line.match(/\((\d{1,3})m\)$/i);
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 30;
    const title = minutesMatch ? line.replace(minutesMatch[0], '').trim() : line;
    return {
      ...createEmptyTask(),
      title: title || 'New task',
      estimated_minutes: Number.isFinite(minutes) ? Math.min(120, Math.max(5, minutes)) : 30,
    };
  });
}

function phaseTotals(phase: DraftPhase) {
  const totalMinutes = phase.tasks.reduce((sum, task) => sum + (task.estimated_minutes || 0), 0);
  const requiredCount = phase.tasks.filter((task) => task.required).length;
  return { totalMinutes, requiredCount };
}

export function TrackBuilder({
  phases,
  setPhases,
  estimatedDurationDays,
  onAddPhase,
  selectedTaskId,
  onSelectTask,
  selectedPhaseId,
}: TrackBuilderState) {
  const [bulkInputs, setBulkInputs] = useState<Record<string, string>>({});
  type QuickAddState = {
    title: string;
    task_type: TaskType;
    estimated_minutes: number;
    required: boolean;
    addAnother: boolean;
  };

  const [quickAddInputs, setQuickAddInputs] = useState<Record<string, QuickAddState>>({});
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(phases[0]?.client_id ?? null);
  const [phaseToDelete, setPhaseToDelete] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<{ phaseId: string; taskId: string } | null>(null);

  const totals = useMemo(() => {
    const totalMinutes = phases.reduce((sum, phase) => sum + phaseTotals(phase).totalMinutes, 0);
    const totalRequired = phases.reduce((sum, phase) => sum + phaseTotals(phase).requiredCount, 0);
    return { totalMinutes, totalRequired };
  }, [phases]);

  const estimatedCapacityMinutes = Math.max(1, estimatedDurationDays) * DEFAULT_HOURS_PER_DAY * 60;

  const getQuickAdd = (phaseId: string) => {
    return (
      quickAddInputs[phaseId] ?? {
        title: '',
        task_type: 'checklist',
        estimated_minutes: 15,
        required: true,
        addAnother: true,
      }
    );
  };

  const updateQuickAdd = (phaseId: string, update: Partial<QuickAddState>) => {
    const current = getQuickAdd(phaseId);
    setQuickAddInputs((prev) => ({
      ...prev,
      [phaseId]: { ...current, ...update },
    }));
  };

  useEffect(() => {
    if (!openPhaseId && phases[0]) {
      setOpenPhaseId(phases[0].client_id);
      return;
    }
    if (openPhaseId && !phases.some((phase) => phase.client_id === openPhaseId)) {
      setOpenPhaseId(phases[0]?.client_id ?? null);
    }
  }, [openPhaseId, phases]);

  useEffect(() => {
    if (selectedPhaseId) {
      setOpenPhaseId(selectedPhaseId);
    }
  }, [selectedPhaseId]);

  const selectedTaskLocation = useMemo(() => {
    if (!selectedTaskId) return null;
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
      const taskIndex = phases[phaseIndex].tasks.findIndex((task) => task.client_id === selectedTaskId);
      if (taskIndex >= 0) {
        return { phaseIndex, taskIndex };
      }
    }
    return null;
  }, [selectedTaskId, phases]);

  useEffect(() => {
    if (!selectedTaskLocation) return;
    const phase = phases[selectedTaskLocation.phaseIndex];
    if (phase) {
      setOpenPhaseId(phase.client_id);
    }
  }, [selectedTaskLocation, phases]);

  const selectedTask = selectedTaskLocation
    ? phases[selectedTaskLocation.phaseIndex]?.tasks[selectedTaskLocation.taskIndex] ?? null
    : null;
  const selectedPhase = selectedTaskLocation ? phases[selectedTaskLocation.phaseIndex] : null;

  const handlePhaseUpdate = (index: number, update: Partial<DraftPhase>) => {
    const next = [...phases];
    next[index] = { ...next[index], ...update };
    setPhases(next);
  };

  const handleTaskUpdate = (phaseIndex: number, taskIndex: number, update: Partial<DraftTask>) => {
    const next = [...phases];
    const tasks = [...next[phaseIndex].tasks];
    tasks[taskIndex] = { ...tasks[taskIndex], ...update };
    next[phaseIndex] = { ...next[phaseIndex], tasks };
    setPhases(next);
  };

  const updateSelectedTask = (update: Partial<DraftTask>) => {
    if (!selectedTaskLocation) return;
    handleTaskUpdate(selectedTaskLocation.phaseIndex, selectedTaskLocation.taskIndex, update);
  };

  const movePhase = (from: number, to: number) => {
    if (to < 0 || to >= phases.length) return;
    const next = [...phases];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPhases(normalizePhaseOrder(next));
  };

  const duplicatePhase = (index: number) => {
    const next = [...phases];
    const copy = next[index];
    const cloned: DraftPhase = {
      ...copy,
      client_id: buildId('phase'),
      title: `${copy.title} (Copy)`,
      tasks: copy.tasks.map((task) => ({
        ...task,
        client_id: buildId('task'),
        source_task_id: task.source_task_id ?? null,
      })),
    };
    next.splice(index + 1, 0, cloned);
    setPhases(normalizePhaseOrder(next));
  };

  const deletePhase = (index: number) => {
    const deletingPhase = phases[index];
    if (deletingPhase && selectedTaskId) {
      const isSelectedInPhase = deletingPhase.tasks.some((task) => task.client_id === selectedTaskId);
      if (isSelectedInPhase) {
        onSelectTask?.(null);
      }
    }
    const next = phases.filter((_, idx) => idx !== index);
    setPhases(normalizePhaseOrder(next));
  };

  const moveTask = (phaseIndex: number, from: number, to: number) => {
    const tasks = [...phases[phaseIndex].tasks];
    if (to < 0 || to >= tasks.length) return;
    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    const next = [...phases];
    next[phaseIndex] = { ...next[phaseIndex], tasks: normalizeTaskOrder(tasks) };
    setPhases(next);
  };

  const duplicateTask = (phaseIndex: number, taskIndex: number) => {
    const tasks = [...phases[phaseIndex].tasks];
    const copy = tasks[taskIndex];
    tasks.splice(taskIndex + 1, 0, {
      ...copy,
      client_id: buildId('task'),
      title: `${copy.title} (Copy)`,
      source_task_id: copy.source_task_id ?? null,
    });
    const next = [...phases];
    next[phaseIndex] = { ...next[phaseIndex], tasks: normalizeTaskOrder(tasks) };
    setPhases(next);
  };

  const deleteTask = (phaseIndex: number, taskIndex: number) => {
    const deletingTask = phases[phaseIndex]?.tasks[taskIndex];
    if (deletingTask && deletingTask.client_id === selectedTaskId) {
      onSelectTask?.(null);
    }
    const tasks = phases[phaseIndex].tasks.filter((_, idx) => idx !== taskIndex);
    const next = [...phases];
    next[phaseIndex] = { ...next[phaseIndex], tasks: normalizeTaskOrder(tasks) };
    setPhases(next);
  };

  const confirmDeletePhase = () => {
    if (!phaseToDelete) return;
    const phaseIndex = phases.findIndex((phase) => phase.client_id === phaseToDelete);
    if (phaseIndex >= 0) {
      deletePhase(phaseIndex);
    }
    setPhaseToDelete(null);
  };

  const confirmDeleteTask = () => {
    if (!taskToDelete) return;
    const phaseIndex = phases.findIndex((phase) => phase.client_id === taskToDelete.phaseId);
    if (phaseIndex >= 0) {
      const taskIndex = phases[phaseIndex].tasks.findIndex((task) => task.client_id === taskToDelete.taskId);
      if (taskIndex >= 0) {
        deleteTask(phaseIndex, taskIndex);
      }
    }
    setTaskToDelete(null);
  };

  const addTask = (phaseIndex: number) => {
    const phaseId = phases[phaseIndex].client_id;
    const quick = getQuickAdd(phaseId);
    const newTask = {
      ...createEmptyTask(),
      title: quick.title.trim() || 'New task',
      task_type: quick.task_type,
      estimated_minutes: quick.estimated_minutes,
      required: quick.required,
      passing_score: quick.task_type === 'quiz' ? 80 : null,
    };
    const next = [...phases];
    next[phaseIndex].tasks = normalizeTaskOrder([...next[phaseIndex].tasks, newTask]);
    setPhases(next);
    if (quick.addAnother) {
      updateQuickAdd(phaseId, { title: '' });
    }
  };

  const addBulkTasks = (phaseIndex: number) => {
    const raw = bulkInputs[phases[phaseIndex].client_id] || '';
    const parsed = parseBulkTasks(raw);
    if (parsed.length === 0) return;
    const next = [...phases];
    next[phaseIndex].tasks = normalizeTaskOrder([...next[phaseIndex].tasks, ...parsed]);
    setPhases(next);
    setBulkInputs((prev) => ({ ...prev, [phases[phaseIndex].client_id]: '' }));
  };

  const handleAddPhase = () => {
    if (onAddPhase) {
      onAddPhase();
      return;
    }
    const newPhase = createEmptyPhase(phases.length);
    const next = normalizePhaseOrder([...phases, newPhase]);
    setPhases(next);
    setOpenPhaseId(newPhase.client_id);
  };

  return (
    <Card className='border-2 border-dashed bg-white'>
      <CardHeader>
        <CardTitle className='text-base'>Phase builder</CardTitle>
        <p className='text-xs text-muted-foreground'>
          Total: {totals.totalMinutes} min • Required tasks: {totals.totalRequired} • Estimated capacity:{' '}
          {estimatedCapacityMinutes} min ({estimatedDurationDays} days × {DEFAULT_HOURS_PER_DAY}h)
        </p>
      </CardHeader>
      <CardContent className='space-y-5 pb-8'>
        <Accordion
          type='single'
          collapsible
          value={openPhaseId ?? undefined}
          onValueChange={(value) => setOpenPhaseId(value || null)}
          className='space-y-5'
        >
          {phases.map((phase, phaseIndex) => {
            const { totalMinutes, requiredCount } = phaseTotals(phase);
            return (
              <AccordionItem
                key={phase.client_id}
                value={phase.client_id}
                className='rounded-xl border-2 border-border bg-card shadow-sm transition-colors data-[state=open]:border-primary/40'
              >
                <AccordionPrimitive.Header className='flex'>
                  <div
                    className={cn(
                      'flex flex-1 items-start justify-between gap-3 px-4 py-3 text-left',
                      openPhaseId === phase.client_id ? 'bg-primary/5' : 'hover:bg-muted/30',
                    )}
                  >
                    <div className='text-left'>
                      <div className='flex items-center gap-2'>
                        <Badge variant='secondary'>Phase {phaseIndex + 1}</Badge>
                        <p className='font-medium'>{phase.title || `Phase ${phaseIndex + 1}`}</p>
                      </div>
                      <div className='mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                        <span>{phase.tasks.length} tasks</span>
                        <span>{requiredCount} required</span>
                        <span>{totalMinutes} min</span>
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type='button' variant='ghost' size='icon' aria-label='Phase actions'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem
                            onSelect={() => movePhase(phaseIndex, phaseIndex - 1)}
                            disabled={phaseIndex === 0}
                          >
                            <ArrowUp className='mr-2 h-4 w-4' />
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => movePhase(phaseIndex, phaseIndex + 1)}
                            disabled={phaseIndex === phases.length - 1}
                          >
                            <ArrowDown className='mr-2 h-4 w-4' />
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => duplicatePhase(phaseIndex)}>
                            <Copy className='mr-2 h-4 w-4' />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className='text-destructive focus:text-destructive'
                            onSelect={() => setPhaseToDelete(phase.client_id)}
                          >
                            <Trash2 className='mr-2 h-4 w-4' />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <AccordionPrimitive.Trigger
                        aria-label='Toggle phase'
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition hover:text-foreground',
                          openPhaseId === phase.client_id ? 'bg-muted/30' : 'bg-white',
                        )}
                        onClick={() =>
                          setOpenPhaseId((current) => (current === phase.client_id ? null : phase.client_id))
                        }
                      >
                        <span className='[&>svg]:transition-transform [&>svg]:duration-200 data-[state=open]:[&>svg]:rotate-180'>
                          <ChevronDown className='h-4 w-4' />
                        </span>
                      </AccordionPrimitive.Trigger>
                    </div>
                  </div>
                </AccordionPrimitive.Header>
                <AccordionContent className='space-y-4 border-t border-border/80 bg-white/70 px-5 pt-4 pb-5 pr-6'>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <Input
                      value={phase.title}
                      onChange={(event) => handlePhaseUpdate(phaseIndex, { title: event.target.value })}
                      placeholder='Phase title'
                    />
                    <Input
                      value={phase.description}
                      onChange={(event) => handlePhaseUpdate(phaseIndex, { description: event.target.value })}
                      placeholder='Phase description'
                    />
                  </div>

                  <div className='mt-3 space-y-3'>
                    {phase.tasks.map((task, taskIndex) => (
                      <div
                        key={task.client_id}
                        className={`flex flex-wrap items-center gap-3 rounded-md border border-border/80 bg-white pl-3 pr-5 py-2 shadow-sm transition-colors hover:border-primary/40 ${
                          task.required ? 'border-l-4 border-l-primary/50' : 'border-l-4 border-l-border'
                        }`}
                      >
                        <button
                          type='button'
                          className='flex min-w-[200px] flex-1 flex-col text-left pr-2'
                          onClick={() => onSelectTask?.(task.client_id)}
                        >
                          <span className='text-sm font-medium'>{task.title || 'Untitled task'}</span>
                          <span className='text-xs text-muted-foreground'>
                            {task.instructions ? task.instructions.slice(0, 80) : 'No instructions yet'}
                          </span>
                        </button>

                        <Badge variant='secondary' className='capitalize'>
                          {task.task_type.replace('_', ' ')}
                        </Badge>

                        <span className='text-xs text-muted-foreground'>{task.estimated_minutes || 0}m</span>

                        <Badge variant='outline'>{task.required ? 'Required' : 'Optional'}</Badge>

                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectTask?.(task.client_id);
                          }}
                        >
                          Edit details
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              onClick={(event) => event.stopPropagation()}
                              aria-label='Task actions'
                            >
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onSelect={() => moveTask(phaseIndex, taskIndex, taskIndex - 1)}
                              disabled={taskIndex === 0}
                            >
                              <ArrowUp className='mr-2 h-4 w-4' />
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => moveTask(phaseIndex, taskIndex, taskIndex + 1)}
                              disabled={taskIndex === phase.tasks.length - 1}
                            >
                              <ArrowDown className='mr-2 h-4 w-4' />
                              Move down
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => duplicateTask(phaseIndex, taskIndex)}>
                              <Copy className='mr-2 h-4 w-4' />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className='text-destructive focus:text-destructive'
                              onSelect={() =>
                                setTaskToDelete({ phaseId: phase.client_id, taskId: task.client_id })
                              }
                            >
                              <Trash2 className='mr-2 h-4 w-4' />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                  <div className='mt-3 space-y-3'>
                  <div className='rounded-md border-2 border-border/80 bg-muted/20 p-3'>
                    <p className='text-xs font-medium text-muted-foreground'>Quick add</p>
                    <div className='mt-2 grid gap-2 md:grid-cols-[2fr,1fr,90px,120px,auto]'>
                      <Input
                        value={getQuickAdd(phase.client_id).title}
                        onChange={(event) => updateQuickAdd(phase.client_id, { title: event.target.value })}
                        placeholder='Task title'
                      />
                      <select
                        className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                        value={getQuickAdd(phase.client_id).task_type}
                        onChange={(event) =>
                          updateQuickAdd(phase.client_id, { task_type: event.target.value as TaskType })
                        }
                      >
                        {taskTypeOptions.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <Input
                        type='number'
                        min={5}
                        max={120}
                        value={getQuickAdd(phase.client_id).estimated_minutes}
                        onChange={(event) =>
                          updateQuickAdd(phase.client_id, { estimated_minutes: Number(event.target.value || 0) })
                        }
                        placeholder='Minutes'
                      />
                      <label className='flex items-center gap-2 text-sm'>
                        <input
                          type='checkbox'
                          checked={getQuickAdd(phase.client_id).required}
                          onChange={(event) => updateQuickAdd(phase.client_id, { required: event.target.checked })}
                        />
                        Required
                      </label>
                      <Button type='button' variant='secondary' onClick={() => addTask(phaseIndex)}>
                        Add task
                      </Button>
                    </div>
                    <label className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                      <input
                        type='checkbox'
                        checked={getQuickAdd(phase.client_id).addAnother}
                        onChange={(event) => updateQuickAdd(phase.client_id, { addAnother: event.target.checked })}
                      />
                      Add another after saving
                    </label>
                  </div>
                  </div>
                  <div className='mt-5 flex flex-wrap gap-2'>
                    <div className='flex-1 min-w-0'>
                      <details className='rounded-md border px-3 py-2'>
                        <summary className='cursor-pointer text-sm text-muted-foreground'>Add multiple tasks</summary>
                        <div className='mt-2 space-y-2'>
                          <Textarea
                            rows={4}
                            value={bulkInputs[phase.client_id] || ''}
                            onChange={(event) =>
                              setBulkInputs((prev) => ({ ...prev, [phase.client_id]: event.target.value }))
                            }
                            placeholder='One task per line (optional minutes like: Review policy (30m))'
                          />
                          <Button type='button' variant='secondary' onClick={() => addBulkTasks(phaseIndex)}>
                            Parse tasks
                          </Button>
                        </div>
                      </details>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className='flex flex-wrap gap-2 pt-2 pb-2'>
          <Button type='button' variant='secondary' onClick={handleAddPhase}>
            Add phase
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        title='Delete phase?'
        description='This removes the phase and all tasks inside it.'
        confirmText='Delete'
        open={phaseToDelete !== null}
        onOpenChange={(open) => !open && setPhaseToDelete(null)}
        onConfirm={confirmDeletePhase}
      />
      <ConfirmDialog
        title='Delete task?'
        description='This removes the task from the phase.'
        confirmText='Delete'
        open={taskToDelete !== null}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
        onConfirm={confirmDeleteTask}
      />

      <TaskDetailsSheet
        open={Boolean(selectedTask)}
        onOpenChange={(open: boolean) => {
          if (!open) {
            onSelectTask?.(null);
          }
        }}
        task={selectedTask}
        phase={selectedPhase}
        onUpdateTask={updateSelectedTask}
      />
    </Card>
  );
}
