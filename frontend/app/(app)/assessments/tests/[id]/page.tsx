'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentCategory, AssessmentQuestion, AssessmentTest, AssessmentTestVersion } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CheckSquare,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared sub-components (from question bank pattern)
// ---------------------------------------------------------------------------

type FilterOption = { value: string; label: string; count?: number };

function FilterMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={selected.length > 0 ? 'secondary' : 'outline'} size='sm' className='h-8 text-xs'>
          {label}
          {selected.length > 0 && ` (${selected.length})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-52'>
        {options.length === 0 ? (
          <p className='px-2 py-1 text-xs text-muted-foreground'>No options</p>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem key={o.value} checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)}>
              {o.label}
              {typeof o.count === 'number' ? ` (${o.count})` : ''}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuestionBadges({ question }: { question: AssessmentQuestion }) {
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <Badge variant='secondary' className='text-[10px]'>{question.question_type.replace(/_/g, ' ')}</Badge>
      <Badge variant='outline' className='text-[10px] capitalize'>{question.difficulty ?? 'unspecified'}</Badge>
      {question.category && <Badge variant='outline' className='text-[10px]'>{question.category.name}</Badge>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface QuestionListResponse {
  items: AssessmentQuestion[];
  meta: { page: number; page_size: number; total: number };
}

type VersionQuestion = {
  question_id: string;
  order_index: number;
  points: number;
  prompt: string;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AssessmentTestBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  // -- Core data --
  const [test, setTest] = useState<AssessmentTest | null>(null);
  const [version, setVersion] = useState<AssessmentTestVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -- Metadata --
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [roleTarget, setRoleTarget] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);

  // -- Version settings --
  const [passingScore, setPassingScore] = useState(80);
  const [timeLimit, setTimeLimit] = useState<number | ''>('');
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [attemptsAllowed, setAttemptsAllowed] = useState<number | ''>('');

  // -- Composition --
  const [versionQuestions, setVersionQuestions] = useState<VersionQuestion[]>([]);

  // -- Bank: paginated --
  const [bankQuestions, setBankQuestions] = useState<AssessmentQuestion[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankTotal, setBankTotal] = useState(0);
  const bankPageSize = 20;
  const [bankQuery, setBankQuery] = useState('');
  const [bankDifficulties, setBankDifficulties] = useState<string[]>([]);
  const [bankCategories, setBankCategories] = useState<string[]>([]);
  const [bankChecked, setBankChecked] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<AssessmentCategory[]>([]);

  // ---------------------------------------------------------------------------
  // Load test + version
  // ---------------------------------------------------------------------------
  const loadTest = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const t = await api.get<AssessmentTest>(`/assessments/tests/${id}`, accessToken);
      setTest(t);
      setTitle(t.title);
      setDescription(t.description || '');
      setCategory(t.category || '');
      setRoleTarget(t.role_target || '');

      let draft = t.versions.find((v) => v.status === 'draft') || null;
      if (!draft) {
        draft = await api.post<AssessmentTestVersion>(`/assessments/tests/${id}/versions`, {}, accessToken);
      }
      setVersion(draft);
      setPassingScore(draft.passing_score || 80);
      setTimeLimit(draft.time_limit_minutes ?? '');
      setShuffleQuestions(Boolean(draft.shuffle_questions));
      setAttemptsAllowed(draft.attempts_allowed ?? '');
      setVersionQuestions(
        draft.questions
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .filter((q) => Boolean(q.question_id))
          .map((q, idx) => ({
            question_id: q.question_id as string,
            order_index: idx,
            points: q.points || 1,
            prompt: (q.question_snapshot?.prompt as string) || 'Untitled',
          })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  // ---------------------------------------------------------------------------
  // Load bank (paginated)
  // ---------------------------------------------------------------------------
  const loadBank = useCallback(async () => {
    if (!accessToken) return;
    setBankLoading(true);
    try {
      const params = new URLSearchParams({ page: String(bankPage), page_size: String(bankPageSize), status: 'published' });
      if (bankQuery.trim()) params.set('q', bankQuery.trim());
      if (bankDifficulties.length) params.set('difficulty', bankDifficulties.join(','));
      if (bankCategories.length) params.set('category', bankCategories.join(','));
      const resp = await api.get<QuestionListResponse>(`/assessments/questions?${params}`, accessToken);
      setBankQuestions(resp.items);
      setBankTotal(resp.meta.total);
    } finally {
      setBankLoading(false);
    }
  }, [accessToken, bankPage, bankQuery, bankDifficulties, bankCategories]);

  const loadCategories = useCallback(async () => {
    if (!accessToken) return;
    try {
      const resp = await api.get<{ items: AssessmentCategory[] }>('/assessments/categories', accessToken);
      setCategories(resp.items);
    } catch {
      setCategories([]);
    }
  }, [accessToken]);

  useEffect(() => { void loadTest(); }, [loadTest]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  useEffect(() => {
    const t = setTimeout(() => void loadBank(), 200);
    return () => clearTimeout(t);
  }, [loadBank]);

  useEffect(() => { setBankPage(1); }, [bankQuery, bankDifficulties, bankCategories]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const selectedIds = useMemo(() => new Set(versionQuestions.map((q) => q.question_id)), [versionQuestions]);

  const totalPoints = useMemo(() => versionQuestions.reduce((s, q) => s + (q.points || 0), 0), [versionQuestions]);

  const validationErrors = useMemo(() => {
    const e: string[] = [];
    if (!title.trim()) e.push('Missing title');
    if (versionQuestions.length === 0) e.push('No questions added');
    if (passingScore < 0 || passingScore > 100) e.push('Invalid passing score');
    return e;
  }, [title, versionQuestions, passingScore]);

  const bankTotalPages = Math.max(1, Math.ceil(bankTotal / bankPageSize));

  const difficultyOptions: FilterOption[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ];

  const categoryOptions: FilterOption[] = [
    { value: 'unclassified', label: 'Unclassified' },
    ...categories.map((c) => ({ value: c.slug, label: c.name })),
  ];

  // ---------------------------------------------------------------------------
  // Bank: selection
  // ---------------------------------------------------------------------------
  const visibleBankIds = bankQuestions.filter((q) => !selectedIds.has(q.id)).map((q) => q.id);
  const allVisibleChecked = visibleBankIds.length > 0 && visibleBankIds.every((id) => bankChecked.has(id));
  const checkedCount = bankChecked.size;

  const toggleCheck = (qid: string) => {
    setBankChecked((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleChecked) setBankChecked(new Set());
    else setBankChecked(new Set(visibleBankIds));
  };

  const addChecked = () => {
    const toAdd = bankQuestions.filter((q) => bankChecked.has(q.id) && !selectedIds.has(q.id));
    if (!toAdd.length) return;
    setVersionQuestions((prev) => {
      const next = [...prev];
      toAdd.forEach((q) => next.push({ question_id: q.id, order_index: next.length, points: 1, prompt: q.prompt }));
      return next.map((item, idx) => ({ ...item, order_index: idx }));
    });
    setBankChecked(new Set());
  };

  const addSingle = (q: AssessmentQuestion) => {
    setVersionQuestions((prev) => [...prev, { question_id: q.id, order_index: prev.length, points: 1, prompt: q.prompt }]);
  };

  // ---------------------------------------------------------------------------
  // Composition: reorder / remove / points
  // ---------------------------------------------------------------------------
  const moveQuestion = (from: number, to: number) => {
    if (to < 0 || to >= versionQuestions.length) return;
    const next = [...versionQuestions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setVersionQuestions(next.map((item, idx) => ({ ...item, order_index: idx })));
  };

  const updatePoints = (idx: number, pts: number) => {
    setVersionQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, points: Math.max(1, pts) } : q)));
  };

  const removeQuestion = (idx: number) => {
    setVersionQuestions((prev) => prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order_index: i })));
  };

  // ---------------------------------------------------------------------------
  // Save / Publish
  // ---------------------------------------------------------------------------
  const saveDraft = async () => {
    if (!accessToken || !version) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/assessments/test-versions/${version.id}`, {
        passing_score: passingScore,
        time_limit_minutes: timeLimit || null,
        shuffle_questions: shuffleQuestions,
        attempts_allowed: attemptsAllowed || null,
        questions: versionQuestions.map((q, idx) => ({ question_id: q.question_id, order_index: idx, points: q.points || 1 })),
      }, accessToken);
      await api.put(`/assessments/tests/${id}`, {
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        role_target: roleTarget.trim() || null,
      }, accessToken);
      await loadTest();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!accessToken || !version) return;
    setSaving(true);
    setError(null);
    try {
      await saveDraft();
      await api.post(`/assessments/test-versions/${version.id}/publish`, {}, accessToken);
      await loadTest();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Loading / Not found
  // ---------------------------------------------------------------------------
  if (loading) return <LoadingState label='Loading assessment test...' />;
  if (!test || !version) return <EmptyState title='Test not found' description='This assessment does not exist.' />;

  const hasErrors = validationErrors.length > 0;

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* ── Header bar ── */}
      <div className='flex shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-2.5'>
        <div className='flex min-w-0 items-center gap-3'>
          <Button variant='ghost' size='sm' onClick={() => router.back()} className='shrink-0'>
            <ArrowUp className='mr-1 h-3.5 w-3.5 -rotate-90' />
            Back
          </Button>

          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setEditingTitle(false); }}
              className='min-w-[200px] border-b border-primary bg-transparent text-lg font-semibold outline-none'
            />
          ) : (
            <button
              type='button'
              onClick={() => setEditingTitle(true)}
              className='flex min-w-0 items-center gap-1.5 text-lg font-semibold hover:text-primary'
              title='Click to edit title'
            >
              <span className='truncate'>{title || 'Untitled test'}</span>
              <Pencil className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
            </button>
          )}

          <button
            type='button'
            onClick={() => setMetaSheetOpen(true)}
            className='shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline'
          >
            Edit details
          </button>

          <Badge variant='outline' className='shrink-0'>v{version.version_number} {version.status}</Badge>
        </div>

        <div className='flex items-center gap-2'>
          {error && <span className='text-xs text-red-600 max-w-[200px] truncate' title={error}>{error}</span>}
          <Button variant='outline' size='sm' onClick={saveDraft} disabled={saving}>
            {saving ? 'Saving...' : 'Save draft'}
          </Button>
          <Button size='sm' onClick={publish} disabled={saving || hasErrors}>
            Publish
          </Button>
        </div>
      </div>

      {/* ── 3-column body ── */}
      <div className='flex min-h-0 flex-1'>
        {/* ── LEFT SIDEBAR ── */}
        <aside className='flex w-52 shrink-0 flex-col border-r bg-muted/20'>
          {/* Category tree */}
          <div className='flex-1 overflow-auto p-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Categories</p>
            <div className='space-y-0.5'>
              <button
                type='button'
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs',
                  bankCategories.length === 0 ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
                )}
                onClick={() => setBankCategories([])}
              >
                All categories
              </button>
              <button
                type='button'
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs',
                  bankCategories.includes('unclassified') ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
                )}
                onClick={() => setBankCategories((prev) => prev.includes('unclassified') ? prev.filter((c) => c !== 'unclassified') : [...prev, 'unclassified'])}
              >
                Unclassified
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  type='button'
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs',
                    bankCategories.includes(cat.slug) ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
                  )}
                  onClick={() => setBankCategories((prev) => prev.includes(cat.slug) ? prev.filter((c) => c !== cat.slug) : [...prev, cat.slug])}
                >
                  <span className='truncate'>{cat.name}</span>
                </button>
              ))}
            </div>

            {/* Settings */}
            <div className='mt-6 space-y-3'>
              <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Test settings</p>
              <div className='space-y-2'>
                <label className='block text-[11px] text-muted-foreground'>Passing score (%)</label>
                <Input type='number' min={0} max={100} value={passingScore} onChange={(e) => setPassingScore(Number(e.target.value || 0))} className='h-8 text-xs' />
              </div>
              <div className='space-y-2'>
                <label className='block text-[11px] text-muted-foreground'>Time limit (min)</label>
                <Input type='number' min={1} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value ? Number(e.target.value) : '')} className='h-8 text-xs' placeholder='No limit' />
              </div>
              <div className='space-y-2'>
                <label className='block text-[11px] text-muted-foreground'>Max attempts</label>
                <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(e.target.value ? Number(e.target.value) : '')} className='h-8 text-xs' placeholder='Unlimited' />
              </div>
              <label className='flex items-center gap-2 text-xs'>
                <input type='checkbox' checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} className='h-3.5 w-3.5' />
                Shuffle questions
              </label>
            </div>
          </div>

          {/* Validation */}
          {hasErrors && (
            <div className='border-t p-3'>
              <div className='flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2'>
                <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600' />
                <div className='space-y-0.5'>
                  {validationErrors.map((e) => (
                    <p key={e} className='text-[11px] text-amber-800'>{e}</p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ── CENTER: Question Bank ── */}
        <div className='flex min-w-0 flex-1 flex-col'>
          {/* Bank toolbar */}
          <div className='flex shrink-0 flex-wrap items-center gap-2 border-b bg-background/80 px-4 py-2'>
            <div className='relative flex-1'>
              <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} placeholder='Search published questions...' className='h-8 pl-8 text-xs' />
            </div>
            <FilterMenu label='Difficulty' options={difficultyOptions} selected={bankDifficulties} onChange={setBankDifficulties} />
            <FilterMenu label='Category' options={categoryOptions} selected={bankCategories} onChange={setBankCategories} />
            {(bankQuery || bankDifficulties.length > 0 || bankCategories.length > 0) && (
              <Button variant='ghost' size='sm' className='h-8 text-xs' onClick={() => { setBankQuery(''); setBankDifficulties([]); setBankCategories([]); }}>
                <X className='mr-1 h-3 w-3' />Clear
              </Button>
            )}
            <span className='ml-auto text-xs text-muted-foreground'>{bankTotal} question{bankTotal !== 1 ? 's' : ''}</span>
          </div>

          {/* Select all + bulk add bar */}
          <div className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1.5'>
            <button type='button' className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground' onClick={toggleAllVisible}>
              {allVisibleChecked ? <CheckSquare className='h-3.5 w-3.5 text-primary' /> : <Square className='h-3.5 w-3.5' />}
              {allVisibleChecked ? 'Deselect page' : 'Select page'}
            </button>
            {checkedCount > 0 && (
              <Button size='sm' className='h-7 text-xs' onClick={addChecked}>
                <Plus className='mr-1 h-3 w-3' />
                Add selected ({checkedCount})
              </Button>
            )}
          </div>

          {/* Question list */}
          <div className='flex-1 overflow-auto'>
            {bankLoading && bankQuestions.length === 0 ? (
              <div className='flex items-center justify-center py-12'>
                <p className='text-sm text-muted-foreground'>Loading questions...</p>
              </div>
            ) : bankQuestions.length === 0 ? (
              <div className='flex items-center justify-center py-12'>
                <p className='text-sm text-muted-foreground'>No published questions match the filters.</p>
              </div>
            ) : (
              <div className='divide-y'>
                {bankQuestions.map((q) => {
                  const isAdded = selectedIds.has(q.id);
                  const isChecked = bankChecked.has(q.id);
                  return (
                    <div key={q.id} className={cn('flex items-start gap-3 px-4 py-2.5 transition-colors', isAdded ? 'bg-emerald-50/50' : 'hover:bg-muted/30')}>
                      <button
                        type='button'
                        onClick={() => !isAdded && toggleCheck(q.id)}
                        className={cn('mt-1 shrink-0', isAdded ? 'cursor-default' : 'cursor-pointer')}
                        disabled={isAdded}
                      >
                        {isAdded ? (
                          <CheckCircle2 className='h-4 w-4 text-emerald-600' />
                        ) : isChecked ? (
                          <CheckSquare className='h-4 w-4 text-primary' />
                        ) : (
                          <Square className='h-4 w-4 text-muted-foreground/40' />
                        )}
                      </button>
                      <div className='min-w-0 flex-1'>
                        <p className={cn('text-sm leading-snug line-clamp-2', isAdded && 'text-muted-foreground')}>{q.prompt}</p>
                        <div className='mt-1'>
                          <QuestionBadges question={q} />
                        </div>
                      </div>
                      {isAdded ? (
                        <Badge variant='outline' className='shrink-0 border-emerald-300 text-emerald-700 text-[10px]'>
                          <Check className='mr-0.5 h-3 w-3' />Added
                        </Badge>
                      ) : (
                        <Button variant='outline' size='sm' className='h-7 shrink-0 text-xs' onClick={() => addSingle(q)}>
                          <Plus className='mr-1 h-3 w-3' />Add
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className='flex shrink-0 items-center justify-between border-t px-4 py-2'>
            <span className='text-xs text-muted-foreground'>
              Page {bankPage} of {bankTotalPages}
            </span>
            <div className='flex gap-1'>
              <Button variant='outline' size='sm' className='h-7 text-xs' disabled={bankPage <= 1} onClick={() => setBankPage((p) => p - 1)}>Prev</Button>
              <Button variant='outline' size='sm' className='h-7 text-xs' disabled={bankPage >= bankTotalPages} onClick={() => setBankPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Test Composition ── */}
        <aside className='flex w-80 shrink-0 flex-col border-l bg-background'>
          {/* Header */}
          <div className='shrink-0 border-b px-4 py-3'>
            <div className='flex items-center justify-between'>
              <p className='text-sm font-semibold'>Test composition</p>
              <Badge variant='secondary' className='text-[10px]'>
                {versionQuestions.length} Q &middot; {totalPoints} pts
              </Badge>
            </div>
          </div>

          {/* Question list */}
          <div className='flex-1 overflow-auto'>
            {versionQuestions.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-12 px-4 text-center'>
                <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted'>
                  <Plus className='h-5 w-5 text-muted-foreground' />
                </div>
                <p className='text-sm font-medium'>No questions yet</p>
                <p className='mt-1 text-xs text-muted-foreground'>Select questions from the bank on the left to build your test.</p>
              </div>
            ) : (
              <div className='divide-y'>
                {versionQuestions.map((q, idx) => (
                  <div key={`${q.question_id}-${idx}`} className='group flex items-center gap-2 px-3 py-2 hover:bg-muted/20'>
                    <GripVertical className='h-3.5 w-3.5 shrink-0 text-muted-foreground/30' />
                    <span className='w-5 shrink-0 text-center text-[10px] font-medium text-muted-foreground'>{idx + 1}</span>
                    <p className='min-w-0 flex-1 truncate text-xs'>{q.prompt}</p>
                    <Input
                      type='number'
                      min={1}
                      value={q.points}
                      onChange={(e) => updatePoints(idx, Number(e.target.value || 1))}
                      className='h-6 w-12 text-center text-[11px] px-1'
                      title='Points'
                    />
                    <div className='flex items-center opacity-0 group-hover:opacity-100 transition-opacity'>
                      <button type='button' onClick={() => moveQuestion(idx, idx - 1)} disabled={idx === 0} className='p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30'>
                        <ArrowUp className='h-3 w-3' />
                      </button>
                      <button type='button' onClick={() => moveQuestion(idx, idx + 1)} disabled={idx === versionQuestions.length - 1} className='p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30'>
                        <ArrowDown className='h-3 w-3' />
                      </button>
                      <button type='button' onClick={() => removeQuestion(idx)} className='p-0.5 text-red-500 hover:text-red-700'>
                        <Trash2 className='h-3 w-3' />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer: summary */}
          <div className='shrink-0 space-y-2 border-t px-4 py-3'>
            <div className='grid grid-cols-2 gap-2 text-xs'>
              <div className='rounded border px-2 py-1.5'>
                <span className='text-muted-foreground'>Questions</span>
                <p className='text-sm font-bold'>{versionQuestions.length}</p>
              </div>
              <div className='rounded border px-2 py-1.5'>
                <span className='text-muted-foreground'>Points</span>
                <p className='text-sm font-bold'>{totalPoints}</p>
              </div>
              <div className='rounded border px-2 py-1.5'>
                <span className='text-muted-foreground'>Pass at</span>
                <p className='text-sm font-bold'>{passingScore}%</p>
              </div>
              <div className='rounded border px-2 py-1.5'>
                <span className='text-muted-foreground'>Time</span>
                <p className='text-sm font-bold'>{timeLimit || 'No limit'}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Metadata Sheet ── */}
      <Sheet open={metaSheetOpen} onOpenChange={setMetaSheetOpen}>
        <SheetContent side='right' className='sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>Test details</SheetTitle>
          </SheetHeader>
          <div className='mt-4 space-y-4'>
            <div className='space-y-2'>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className='space-y-2'>
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Role target</Label>
              <Input value={roleTarget} onChange={(e) => setRoleTarget(e.target.value)} />
            </div>
          </div>
          <SheetFooter className='mt-6'>
            <Button variant='outline' onClick={() => setMetaSheetOpen(false)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
