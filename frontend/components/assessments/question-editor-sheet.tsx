import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { AssessmentQuestion, AssessmentQuestionOption } from '@/lib/types';

const DEFAULT_OPTION: AssessmentQuestionOption = {
  id: '',
  option_text: '',
  is_correct: false,
  order_index: 0,
};

interface QuestionEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AssessmentQuestion | null;
  onSave: (payload: {
    prompt: string;
    question_type: string;
    difficulty?: string | null;
    tags: string[];
    status: string;
    explanation?: string | null;
    options: { option_text: string; is_correct: boolean; order_index: number }[];
  }) => Promise<void>;
}

export function QuestionEditorSheet({ open, onOpenChange, initial, onSave }: QuestionEditorSheetProps) {
  const [prompt, setPrompt] = useState('');
  const [questionType, setQuestionType] = useState('mcq_single');
  const [difficulty, setDifficulty] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('draft');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState<AssessmentQuestionOption[]>([DEFAULT_OPTION]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setPrompt(initial.prompt || '');
      setQuestionType(initial.question_type || 'mcq_single');
      setDifficulty(initial.difficulty || '');
      setTags((initial.tags || []).join(', '));
      setStatus(initial.status || 'draft');
      setExplanation(initial.explanation || '');
      setOptions(
        (initial.options || []).map((option, idx) => ({
          ...option,
          order_index: option.order_index ?? idx,
        })),
      );
    } else {
      setPrompt('');
      setQuestionType('mcq_single');
      setDifficulty('');
      setTags('');
      setStatus('draft');
      setExplanation('');
      setOptions([DEFAULT_OPTION]);
    }
  }, [initial, open]);

  const canSave = useMemo(() => prompt.trim().length > 0 && options.some((opt) => opt.option_text.trim()), [
    prompt,
    options,
  ]);

  const updateOption = (index: number, update: Partial<AssessmentQuestionOption>) => {
    setOptions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next.map((item, idx) => ({ ...item, order_index: idx }));
    });
  };

  const addOption = () => {
    setOptions((prev) => [...prev, { ...DEFAULT_OPTION, order_index: prev.length }]);
  };

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, idx) => idx !== index).map((item, idx) => ({ ...item, order_index: idx })));
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave({
        prompt: prompt.trim(),
        question_type: questionType,
        difficulty: difficulty.trim() || null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        status,
        explanation: explanation.trim() || null,
        options: options
          .filter((opt) => opt.option_text.trim())
          .map((opt, idx) => ({
            option_text: opt.option_text.trim(),
            is_correct: Boolean(opt.is_correct),
            order_index: idx,
          })),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='flex h-full flex-col'>
        <SheetHeader>
          <SheetTitle>{initial ? 'Edit question' : 'New question'}</SheetTitle>
        </SheetHeader>

        <div className='mt-4 flex-1 space-y-4 overflow-auto pr-1'>
          <div className='space-y-2'>
            <Label>Prompt</Label>
            <Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </div>

          <div className='grid gap-3 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Type</Label>
              <select
                className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                value={questionType}
                onChange={(event) => setQuestionType(event.target.value)}
              >
                <option value='mcq_single'>Multiple choice (single)</option>
                <option value='mcq_multi'>Multiple choice (multi)</option>
              </select>
            </div>
            <div className='space-y-2'>
              <Label>Difficulty</Label>
              <select
                className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              >
                <option value=''>Unspecified</option>
                <option value='easy'>Easy</option>
                <option value='medium'>Medium</option>
                <option value='hard'>Hard</option>
              </select>
            </div>
          </div>

          <div className='grid gap-3 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Status</Label>
              <select
                className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value='draft'>Draft</option>
                <option value='published'>Published</option>
                <option value='archived'>Archived</option>
              </select>
            </div>
            <div className='space-y-2'>
              <Label>Tags</Label>
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder='security, devops, compliance'
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Explanation (optional)</Label>
            <Textarea rows={3} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
          </div>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <Label>Options</Label>
              <Button type='button' variant='outline' size='sm' onClick={addOption}>
                Add option
              </Button>
            </div>
            <div className='space-y-2'>
              {options.map((option, idx) => (
                <div key={`${option.id}-${idx}`} className='flex flex-wrap items-center gap-2 rounded-md border p-2'>
                  <Input
                    className='flex-1'
                    value={option.option_text}
                    onChange={(event) => updateOption(idx, { option_text: event.target.value })}
                    placeholder={`Option ${idx + 1}`}
                  />
                  <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                    <input
                      type='checkbox'
                      checked={option.is_correct}
                      onChange={(event) => updateOption(idx, { is_correct: event.target.checked })}
                    />
                    Correct
                  </label>
                  {options.length > 1 && (
                    <Button type='button' variant='ghost' size='sm' onClick={() => removeOption(idx)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className='mt-4'>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='button' disabled={!canSave || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save question'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
