'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AssessmentCategory, AssessmentQuestion, AssessmentQuestionOption } from '@/lib/types';

const DEFAULT_OPTION: AssessmentQuestionOption = {
  id: '',
  option_text: '',
  is_correct: false,
  order_index: 0,
};

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const selectCls =
  'h-8 w-full rounded-md border border-input bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1';

// Build id→fullPath map once from a flat category list.
// e.g. { 'uuid-8th' → 'School/History/8th Grade' }
function buildCategoryPathMap(categories: AssessmentCategory[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cache = new Map<string, string>();

  const getPath = (id: string): string => {
    if (cache.has(id)) return cache.get(id)!;
    const cat = byId.get(id);
    if (!cat) return '';
    const path = cat.parent_id ? `${getPath(cat.parent_id)}/${cat.name}` : cat.name;
    cache.set(id, path);
    return path;
  };

  categories.forEach((c) => getPath(c.id));
  return cache;
}

interface QuestionEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AssessmentQuestion | null;
  categories?: AssessmentCategory[];
  onSave: (payload: {
    prompt: string;
    question_type: string;
    difficulty?: string | null;
    category_id?: string | null;
    /** When non-empty, backend resolves/creates the hierarchy and overrides category_id */
    category_path?: string | null;
    tags: string[];
    status: string;
    explanation?: string | null;
    options: { option_text: string; is_correct: boolean; order_index: number }[];
  }) => Promise<void>;
}

export function QuestionEditorSheet({
  open,
  onOpenChange,
  initial,
  categories = [],
  onSave,
}: QuestionEditorSheetProps) {
  const [prompt, setPrompt] = useState('');
  const [questionType, setQuestionType] = useState('mcq_single');
  const [difficulty, setDifficulty] = useState('');
  const [categoryId, setCategoryId] = useState('');
  /** Slash-separated path typed by the user; takes priority over categoryId on save */
  const [categoryPathInput, setCategoryPathInput] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('draft');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState<AssessmentQuestionOption[]>([
    DEFAULT_OPTION,
    { ...DEFAULT_OPTION, order_index: 1 },
  ]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build the path map once per categories array reference — O(n), not O(n²)
  const categoryPathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);

  // Sorted dropdown options with full paths
  const categoryOptions = useMemo(
    () =>
      categories
        .map((c) => ({ id: c.id, label: categoryPathMap.get(c.id) ?? c.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories, categoryPathMap],
  );

  // Reset form when the sheet opens for a new/different question.
  // NOTE: `categories` is intentionally NOT in the dep array — we don't want
  // category list refreshes to reset a form the user is actively editing.
  useEffect(() => {
    if (!open) return;
    setSaveError(null);
    if (initial) {
      setPrompt(initial.prompt || '');
      setQuestionType(initial.question_type || 'mcq_single');
      setDifficulty(initial.difficulty || '');
      setCategoryId(initial.category_id || '');
      setCategoryPathInput(
        initial.category_id ? (categoryPathMap.get(initial.category_id) ?? '') : '',
      );
      setTags((initial.tags || []).join(', '));
      setStatus(initial.status || 'draft');
      setExplanation(initial.explanation || '');
      setOptions(
        (initial.options || []).map((opt, idx) => ({
          ...opt,
          order_index: opt.order_index ?? idx,
        })),
      );
    } else {
      setPrompt('');
      setQuestionType('mcq_single');
      setDifficulty('');
      setCategoryId('');
      setCategoryPathInput('');
      setTags('');
      setStatus('draft');
      setExplanation('');
      setOptions([DEFAULT_OPTION, { ...DEFAULT_OPTION, order_index: 1 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, open]);

  const canSave = useMemo(
    () => prompt.trim().length > 0 && options.some((o) => o.option_text.trim()),
    [prompt, options],
  );

  const updateOption = (index: number, update: Partial<AssessmentQuestionOption>) => {
    setOptions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next.map((item, idx) => ({ ...item, order_index: idx }));
    });
  };

  const addOption = () => {
    if (options.length >= 6) return;
    setOptions((prev) => [...prev, { ...DEFAULT_OPTION, order_index: prev.length }]);
  };

  const removeOption = (index: number) => {
    setOptions((prev) =>
      prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, order_index: i })),
    );
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const pathTrim = categoryPathInput.trim();
      await onSave({
        prompt: prompt.trim(),
        question_type: questionType,
        difficulty: difficulty.trim() || null,
        // When the path field is filled it takes priority; backend creates missing levels.
        ...(pathTrim
          ? { category_path: pathTrim }
          : { category_id: categoryId || null }),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        status,
        explanation: explanation.trim() || null,
        options: options
          .filter((o) => o.option_text.trim())
          .map((o, idx) => ({
            option_text: o.option_text.trim(),
            is_correct: Boolean(o.is_correct),
            order_index: idx,
          })),
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex h-full w-[500px] max-w-full flex-col overflow-hidden p-0 sm:w-[540px]'
      >
        {/* ── Header ── */}
        <div className='flex shrink-0 items-center justify-between border-b px-4 py-2.5'>
          <h2 className='text-sm font-semibold text-foreground'>
            {initial ? 'Edit question' : 'New question'}
          </h2>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              status === 'published' && 'bg-emerald-100 text-emerald-700',
              status === 'draft' && 'bg-amber-100 text-amber-700',
              status === 'archived' && 'bg-muted text-muted-foreground',
            )}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>

        {/* ── Scrollable body ── */}
        <div className='flex-1 overflow-y-auto px-4 py-3'>
          <div className='space-y-3'>

            {/* Prompt */}
            <div>
              <label className='mb-1 block text-xs font-medium text-muted-foreground'>
                Question prompt <span className='text-destructive'>*</span>
              </label>
              <Textarea
                rows={3}
                className='resize-none text-sm leading-snug'
                placeholder='Enter the question text…'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            {/* Type + Difficulty */}
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <label className='mb-1 block text-xs font-medium text-muted-foreground'>Type</label>
                <select className={selectCls} value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                  <option value='mcq_single'>Single answer</option>
                  <option value='mcq_multi'>Multi answer</option>
                </select>
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-muted-foreground'>Difficulty</label>
                <select className={selectCls} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value=''>Unspecified</option>
                  <option value='easy'>Easy</option>
                  <option value='medium'>Medium</option>
                  <option value='hard'>Hard</option>
                </select>
              </div>
            </div>

            {/* Category — full width, two-step UX */}
            <div className='space-y-1.5'>
              <label className='block text-xs font-medium text-muted-foreground'>Category</label>
              {/* 1. Pick an existing category */}
              <select
                className={selectCls}
                value={categoryId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCategoryId(id);
                  // Sync the path field so the user can see and further edit the full path
                  setCategoryPathInput(id ? (categoryPathMap.get(id) ?? '') : '');
                }}
              >
                <option value=''>Unclassified</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label.replace(/\//g, ' / ')}
                  </option>
                ))}
              </select>

              {/* 2. Or type / edit a slash-separated path directly */}
              <Input
                className='h-8 text-xs'
                placeholder='Or type: School/History/8th Grade'
                value={categoryPathInput}
                onChange={(e) => {
                  setCategoryPathInput(e.target.value);
                  // Decouple from dropdown when the user types freely
                  setCategoryId('');
                }}
              />
              <p className='text-[10px] text-muted-foreground'>
                Use <span className='font-mono font-bold'>/</span> between levels. Missing folders are created automatically on save.
              </p>
            </div>

            {/* Status + Tags */}
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <label className='mb-1 block text-xs font-medium text-muted-foreground'>Status</label>
                <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value='draft'>Draft</option>
                  <option value='published'>Published</option>
                  <option value='archived'>Archived</option>
                </select>
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-muted-foreground'>Tags</label>
                <Input
                  className='h-8 text-xs'
                  placeholder='security, compliance'
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
            </div>

            <div className='border-t' />

            {/* Answer options */}
            <div>
              <div className='mb-2 flex items-center justify-between'>
                <label className='text-xs font-medium text-muted-foreground'>
                  Answer options
                  <span className='ml-1.5 text-[10px] font-normal text-muted-foreground/60'>
                    ({questionType === 'mcq_multi' ? 'check all correct' : 'check one correct'})
                  </span>
                </label>
                <button
                  type='button'
                  onClick={addOption}
                  disabled={options.length >= 6}
                  className='text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40'
                >
                  + Add option
                </button>
              </div>

              <div className='space-y-1.5'>
                {options.map((opt, idx) => (
                  <div key={`opt-${idx}`} className='flex items-center gap-2'>
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                        opt.is_correct ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {OPTION_LETTERS[idx] ?? idx + 1}
                    </span>

                    <Input
                      className='h-8 flex-1 text-sm'
                      value={opt.option_text}
                      placeholder={`Option ${OPTION_LETTERS[idx] ?? idx + 1}`}
                      onChange={(e) => updateOption(idx, { option_text: e.target.value })}
                    />

                    <label className='flex cursor-pointer select-none items-center gap-1 text-xs'>
                      <input
                        type={questionType === 'mcq_multi' ? 'checkbox' : 'radio'}
                        name='correct-option'
                        checked={opt.is_correct}
                        onChange={(e) => {
                          if (questionType === 'mcq_single') {
                            setOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === idx })));
                          } else {
                            updateOption(idx, { is_correct: e.target.checked });
                          }
                        }}
                        className='h-3.5 w-3.5 accent-emerald-600'
                      />
                      <span className={cn('whitespace-nowrap', opt.is_correct ? 'font-medium text-emerald-700' : 'text-muted-foreground')}>
                        Correct
                      </span>
                    </label>

                    {options.length > 2 ? (
                      <button
                        type='button'
                        onClick={() => removeOption(idx)}
                        className='shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-destructive'
                      >
                        <X className='h-3.5 w-3.5' />
                      </button>
                    ) : (
                      <span className='w-5 shrink-0' />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className='border-t' />

            {/* Explanation */}
            <div>
              <label className='mb-1 block text-xs font-medium text-muted-foreground'>
                Explanation{' '}
                <span className='text-[11px] font-normal text-muted-foreground/60'>
                  — shown after answering (optional)
                </span>
              </label>
              <Textarea
                rows={2}
                className='resize-none text-sm leading-snug'
                placeholder='Why is this the correct answer?'
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
              />
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <div className='flex shrink-0 flex-col gap-1 border-t bg-muted/20 px-4 py-2.5'>
          {saveError && (
            <p className='text-xs text-destructive'>{saveError}</p>
          )}
          <div className='flex items-center justify-end gap-2'>
            <Button type='button' variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type='button' size='sm' disabled={!canSave || saving} onClick={save}>
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Create question'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
