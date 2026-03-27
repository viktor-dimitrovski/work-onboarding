'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { HierarchicalCategoryMenu } from '@/components/assessments/hierarchical-category-menu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentCategory, AssessmentCategoryTreeNode, AssessmentQuestion, AssessmentTest, AssessmentTestVersion, AssessmentTestVersionHistory } from '@/lib/types';
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
// Section suggestions — edit this list to add / remove / reorder entries
// ---------------------------------------------------------------------------

const SECTION_SUGGESTIONS = [
  'General Engineering',
  '.NET Core / C#',
  'Entity Framework & Data Access',
  'SQL',
  'REST API & Security',
  'JWT & Authentication',
  'Postman & cURL',
  'Bash & Scripting',
  'Kubernetes',
  'Serverless',
  'PSD2 & Open Banking',
  'Payments',
  'HTML / CSS / JavaScript',
  'AI-Era Engineering',
  'Scenario Questions',
];

const formatRelativeDate = (dateString?: string | null) => {
  if (!dateString) return 'recently';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'recently';
  const diffMs = Math.max(0, Date.now() - date.getTime());
  if (diffMs < 60_000) return 'just now';
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

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
  section: string;
  prompt: string;
};

type AssessmentTestVersionSummary = Omit<AssessmentTestVersion, 'questions'>;

const buildVersionQuestions = (version: AssessmentTestVersion): VersionQuestion[] => {
  return version.questions
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .filter((q) => Boolean(q.question_id))
    .map((q, idx) => ({
      question_id: q.question_id as string,
      order_index: idx,
      points: q.points || 1,
      section: q.section || '',
      prompt: (q.question_snapshot?.prompt as string) || 'Untitled',
    }));
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AssessmentTestBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, user } = useAuth();
  const router = useRouter();

  // -- Core data --
  const [test, setTest] = useState<AssessmentTest | null>(null);
  const [version, setVersion] = useState<AssessmentTestVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // -- Metadata --
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [roleTarget, setRoleTarget] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

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
  const [bankPageSize, setBankPageSize] = useState(20);
  const [bankQuery, setBankQuery] = useState('');
  const [bankDifficulties, setBankDifficulties] = useState<string[]>([]);
  const [bankCategories, setBankCategories] = useState<string[]>([]);
  const [bankSort, setBankSort] = useState<string>('created_desc');
  const [bankChecked, setBankChecked] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<AssessmentCategory[]>([]);
  const [categoryTree, setCategoryTree] = useState<AssessmentCategoryTreeNode[]>([]);
  const [bankStats, setBankStats] = useState<{ total: number; unclassified_category: number; by_category: Record<string, number> } | null>(null);

  // -- Version history --
  const [versionHistory, setVersionHistory] = useState<AssessmentTestVersionHistory[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [versionActionId, setVersionActionId] = useState<string | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<AssessmentTestVersionHistory | null>(null);

  // -- Resizable sidebars --
  const [leftWidth, setLeftWidth] = useState(208);   // default: w-52
  const [rightWidth, setRightWidth] = useState(320); // default: w-80
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    const storedLeft = localStorage.getItem('test-builder-left-width');
    const storedRight = localStorage.getItem('test-builder-right-width');
    if (storedLeft) setLeftWidth(Number(storedLeft));
    if (storedRight) setRightWidth(Number(storedRight));
  }, []);

  const handleDividerMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { side, startX: e.clientX, startWidth: side === 'left' ? leftWidth : rightWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      if (dragRef.current.side === 'left') {
        const w = Math.max(150, Math.min(480, dragRef.current.startWidth + delta));
        setLeftWidth(w);
        localStorage.setItem('test-builder-left-width', String(w));
      } else {
        const w = Math.max(200, Math.min(560, dragRef.current.startWidth - delta));
        setRightWidth(w);
        localStorage.setItem('test-builder-right-width', String(w));
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [leftWidth, rightWidth]);

  // ---------------------------------------------------------------------------
  // Load test + version
  // ---------------------------------------------------------------------------
  const loadTest = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (!accessToken || !id) return;
    const showLoading = opts?.showLoading ?? true;
    if (showLoading) setLoading(true);
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
      setVersionQuestions(buildVersionQuestions(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test');
    } finally {
      if (showLoading) setLoading(false);
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
      if (bankSort && bankSort !== 'created_desc') params.set('sort_by', bankSort);
      const resp = await api.get<QuestionListResponse>(`/assessments/questions?${params}`, accessToken);
      setBankQuestions(resp.items);
      setBankTotal(resp.meta.total);
    } finally {
      setBankLoading(false);
    }
  }, [accessToken, bankPage, bankPageSize, bankQuery, bankDifficulties, bankCategories, bankSort]);

  const loadCategories = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [flat, tree, stats] = await Promise.all([
        api.get<{ items: AssessmentCategory[] }>('/assessments/categories', accessToken),
        api.get<{ items: AssessmentCategoryTreeNode[] }>('/assessments/categories/tree', accessToken),
        api.get<{ total: number; unclassified_category: number; by_category: Record<string, number> }>(
          '/assessments/questions/stats?status=published',
          accessToken,
        ),
      ]);
      setCategories(flat.items);
      setCategoryTree(tree.items);
      setBankStats(stats);
    } catch {
      setCategories([]);
      setCategoryTree([]);
    }
  }, [accessToken]);

  const loadVersionHistory = useCallback(async () => {
    if (!accessToken || !id) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const resp = await api.get<{ items: AssessmentTestVersionHistory[] }>(
        `/assessments/tests/${id}/versions?include_archived=${showArchived ? '1' : '0'}`,
        accessToken,
      );
      setVersionHistory(resp.items);
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setVersionsLoading(false);
    }
  }, [accessToken, id, showArchived]);

  useEffect(() => { void loadTest(); }, [loadTest]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => { if (versionsOpen) void loadVersionHistory(); }, [versionsOpen, loadVersionHistory]);

  useEffect(() => {
    const t = setTimeout(() => void loadBank(), 200);
    return () => clearTimeout(t);
  }, [loadBank]);

  useEffect(() => { setBankPage(1); }, [bankQuery, bankDifficulties, bankCategories, bankPageSize, bankSort]);

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

  const metaDirty = useMemo(() => {
    if (!test) return false;
    const norm = (v?: string | null) => (v ?? '').trim();
    return (
      norm(title) !== norm(test.title) ||
      norm(description) !== norm(test.description) ||
      norm(category) !== norm(test.category) ||
      norm(roleTarget) !== norm(test.role_target)
    );
  }, [test, title, description, category, roleTarget]);

  const bankTotalPages = Math.max(1, Math.ceil(bankTotal / bankPageSize));

  const difficultyOptions: FilterOption[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ];

  const categoryOptions: FilterOption[] = [
    { value: 'unclassified', label: 'Unclassified' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
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
      toAdd.forEach((q) => next.push({ question_id: q.id, order_index: next.length, points: 1, section: '', prompt: q.prompt }));
      return next.map((item, idx) => ({ ...item, order_index: idx }));
    });
    setBankChecked(new Set());
  };

  const addSingle = (q: AssessmentQuestion) => {
    setVersionQuestions((prev) => [...prev, { question_id: q.id, order_index: prev.length, points: 1, section: '', prompt: q.prompt }]);
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

  const updateSection = (idx: number, sec: string) => {
    setVersionQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, section: sec } : q)));
  };

  const removeQuestion = (idx: number) => {
    setVersionQuestions((prev) => prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order_index: i })));
  };

  // ---------------------------------------------------------------------------
  // Save / Publish
  // ---------------------------------------------------------------------------
  // Shared inner save — throws on failure so callers can react to errors.
  const _doSave = async () => {
    const updatedVersion = await api.put<AssessmentTestVersionSummary>(`/assessments/test-versions/${version!.id}?summary=1`, {
      passing_score: passingScore,
      time_limit_minutes: timeLimit || null,
      shuffle_questions: shuffleQuestions,
      attempts_allowed: attemptsAllowed || null,
      questions: versionQuestions.map((q, idx) => ({ question_id: q.question_id, order_index: idx, points: q.points || 1, section: q.section || null })),
    }, accessToken!);
    let updatedTest: AssessmentTest | null = null;
    if (metaDirty) {
      updatedTest = await api.put<AssessmentTest>(`/assessments/tests/${id}`, {
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        role_target: roleTarget.trim() || null,
      }, accessToken!);
    }

    setVersion((prev) => {
      const next = {
        ...(prev || { questions: [] }),
        ...updatedVersion,
      } as AssessmentTestVersion;
      return next;
    });
    setPassingScore(updatedVersion.passing_score || 80);
    setTimeLimit(updatedVersion.time_limit_minutes ?? '');
    setShuffleQuestions(Boolean(updatedVersion.shuffle_questions));
    setAttemptsAllowed(updatedVersion.attempts_allowed ?? '');
    setTest((prev) => {
      const base = updatedTest || prev;
      if (!base) return base;
      return {
        ...base,
        versions: base.versions.map((v) => (v.id === updatedVersion.id ? { ...v, ...updatedVersion } : v)),
      };
    });
    return { updatedVersion, updatedTest };
  };

  const saveDraft = async () => {
    if (!accessToken || !version) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await _doSave();
      setSuccess('Draft saved');
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
    setSuccess(null);
    try {
      await _doSave();                                                          // save; throws on error — publish is skipped
      const published = await api.post<AssessmentTestVersionSummary>(
        `/assessments/test-versions/${version.id}/publish?summary=1`,
        {},
        accessToken,
      );
      const newDraft = await api.post<AssessmentTestVersionSummary>(
        `/assessments/tests/${id}/versions?summary=1`,
        {},
        accessToken,
      );
      setVersion((prev) => {
        const next = {
          ...(prev || { questions: [] }),
          ...newDraft,
        } as AssessmentTestVersion;
        return next;
      });
      setPassingScore(newDraft.passing_score || 80);
      setTimeLimit(newDraft.time_limit_minutes ?? '');
      setShuffleQuestions(Boolean(newDraft.shuffle_questions));
      setAttemptsAllowed(newDraft.attempts_allowed ?? '');
      setTest((prev) => {
        const base = prev || test;
        if (!base) return base;
        const replaced = base.versions.map((v) => (v.id === published.id ? { ...v, ...published } : v));
        const hasDraft = replaced.some((v) => v.id === newDraft.id);
        return {
          ...base,
          versions: hasDraft ? replaced : [...replaced, { ...newDraft, questions: [] }],
        };
      });
      setSuccess('Published successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleArchiveVersion = async (ver: AssessmentTestVersionHistory, archived: boolean) => {
    if (!accessToken) return;
    setVersionActionId(ver.id);
    try {
      const action = archived ? 'archive' : 'unarchive';
      await api.post(`/assessments/test-versions/${ver.id}/${action}?summary=1`, {}, accessToken);
      await loadVersionHistory();
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Failed to update version');
    } finally {
      setVersionActionId(null);
    }
  };

  const handleDeleteVersion = async (ver: AssessmentTestVersionHistory) => {
    if (!accessToken) return;
    setVersionActionId(ver.id);
    try {
      await api.delete(`/assessments/test-versions/${ver.id}`, accessToken);
      await loadVersionHistory();
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Failed to delete version');
    } finally {
      setVersionActionId(null);
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

          <button
            type='button'
            onClick={() => setVersionsOpen(true)}
            className='shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline'
          >
            Versions
          </button>

          <Badge variant='outline' className='shrink-0'>v{version.version_number} {version.status}</Badge>
        </div>

        <div className='flex items-center gap-2'>
          {error && <span className='text-xs text-red-600 max-w-[200px] truncate' title={error}>{error}</span>}
          {success && (
            <span className='inline-flex items-center gap-1 text-xs text-emerald-600'>
              <CheckCircle2 className='h-3.5 w-3.5' />
              {success}
            </span>
          )}
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
        <aside className='flex shrink-0 flex-col bg-muted/20' style={{ width: leftWidth }}>
          {/* Category tree — scrollable */}
          <div className='flex-1 overflow-auto p-3'>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Categories</p>
            <HierarchicalCategoryMenu
              tree={categoryTree}
              unclassifiedCount={bankStats?.unclassified_category ?? 0}
              countsById={Object.fromEntries(
                categories.map((c) => [c.id, bankStats?.by_category[c.id] ?? 0]),
              )}
              totalCount={bankStats?.total}
              selectedIds={bankCategories}
              onChange={setBankCategories}
              className='text-xs'
            />
                </div>

          {/* Validation */}
          {hasErrors && (
            <div className='shrink-0 border-t px-3 py-2'>
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

          {/* Test settings — pinned to bottom, compact */}
          <div className='shrink-0 border-t bg-muted/30 px-3 py-3'>
            <p className='mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Test settings</p>
            <div className='grid grid-cols-2 gap-x-2 gap-y-1.5'>
              <div>
                <label className='block text-[10px] text-muted-foreground'>Pass score (%)</label>
                <Input type='number' min={0} max={100} value={passingScore} onChange={(e) => setPassingScore(Number(e.target.value || 0))} className='h-6 px-1.5 text-xs' />
                </div>
              <div>
                <label className='block text-[10px] text-muted-foreground'>Time limit (min)</label>
                <Input type='number' min={1} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value ? Number(e.target.value) : '')} className='h-6 px-1.5 text-xs' placeholder='∞' />
                </div>
              <div>
                <label className='block text-[10px] text-muted-foreground'>Max attempts</label>
                <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(e.target.value ? Number(e.target.value) : '')} className='h-6 px-1.5 text-xs' placeholder='∞' />
                </div>
              <div className='flex items-end pb-0.5'>
                <label className='flex cursor-pointer items-center gap-1.5 text-[11px]'>
                  <input type='checkbox' checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} className='h-3 w-3' />
                  Shuffle
                </label>
              </div>
            </div>
          </div>
        </aside>

        {/* ── LEFT DRAG DIVIDER ── */}
        <div
          onMouseDown={(e) => handleDividerMouseDown('left', e)}
          className='group relative w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 active:bg-primary'
          title='Drag to resize'
        >
          <div className='absolute inset-y-0 -left-1 -right-1' />
        </div>

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
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground whitespace-nowrap'>Sort:</span>
              <select
                className='h-8 rounded-md border border-input bg-background px-1.5 text-xs'
                value={bankSort}
                onChange={(e) => setBankSort(e.target.value)}
                title='Sort order'
              >
                <option value='created_desc'>Newest first</option>
                <option value='updated_desc'>Recently updated</option>
                <option value='prompt_asc'>Name A → Z</option>
                <option value='prompt_desc'>Name Z → A</option>
              </select>
            </div>
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
                        <span className='inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700'>
                          <Check className='h-3 w-3' />Added
                        </span>
                      ) : (
                        <button
                          type='button'
                          onClick={() => addSingle(q)}
                          className='inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-input bg-background px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-muted'
                        >
                          <Plus className='h-3 w-3' />Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className='flex shrink-0 items-center justify-between border-t px-4 py-3'>
            <span className='text-xs text-muted-foreground'>
              {bankPageSize >= 9999
                ? `Showing all ${bankTotal}`
                : `Page ${bankPage} of ${bankTotalPages}`}
            </span>
            <div className='flex items-center gap-1'>
              <select
                className='h-7 rounded-md border border-input bg-background px-1.5 text-xs'
                value={bankPageSize}
                onChange={(e) => { setBankPageSize(Number(e.target.value)); setBankPage(1); }}
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={9999}>All</option>
              </select>
              {bankPageSize < 9999 && (
                <>
                  <Button variant='outline' size='sm' className='h-7 text-xs' disabled={bankPage <= 1} onClick={() => setBankPage((p) => p - 1)}>Prev</Button>
                  <Button variant='outline' size='sm' className='h-7 text-xs' disabled={bankPage >= bankTotalPages} onClick={() => setBankPage((p) => p + 1)}>Next</Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT DRAG DIVIDER ── */}
        <div
          onMouseDown={(e) => handleDividerMouseDown('right', e)}
          className='group relative w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 active:bg-primary'
          title='Drag to resize'
        >
          <div className='absolute inset-y-0 -left-1 -right-1' />
        </div>

        {/* ── RIGHT: Test Composition ── */}
        <aside className='flex shrink-0 flex-col bg-background' style={{ width: rightWidth }}>
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
                  <div key={`${q.question_id}-${idx}`} className='group px-3 py-2 hover:bg-muted/20'>
                    {/* Row 1: drag handle · number · prompt · points · actions */}
                    <div className='flex items-center gap-2'>
                      <GripVertical className='h-3.5 w-3.5 shrink-0 text-muted-foreground/30' />
                      <span className='w-5 shrink-0 text-center text-[10px] font-medium text-muted-foreground'>{idx + 1}</span>
                      <p className='min-w-0 flex-1 truncate text-xs'>{q.prompt}</p>
                      <Input
                        type='number'
                        min={1}
                        value={q.points}
                        onChange={(e) => updatePoints(idx, Number(e.target.value || 1))}
                        className='h-6 w-12 shrink-0 text-center text-[11px] px-1'
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
                    {/* Row 2: section tag */}
                    <div className='mt-1 pl-9'>
                      <input
                        list='section-suggestions'
                        value={q.section}
                        onChange={(e) => updateSection(idx, e.target.value)}
                        placeholder='Section (optional)'
                        className='h-5 w-full rounded border border-dashed bg-transparent px-1.5 text-[10px] text-muted-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none'
                      />
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

      {/* Section suggestions datalist — sourced from SECTION_SUGGESTIONS above */}
      <datalist id='section-suggestions'>
        {SECTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
      </datalist>

      {/* ── Versions Sheet ── */}
      <Sheet open={versionsOpen} onOpenChange={setVersionsOpen}>
        <SheetContent side='right' className='sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
          </SheetHeader>
          <div className='mt-4 flex items-center justify-between'>
            <label className='flex items-center gap-2 text-xs text-muted-foreground'>
              <input
                type='checkbox'
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className='h-3.5 w-3.5'
              />
              Show archived
            </label>
            <Button variant='outline' size='sm' className='h-7 text-xs' onClick={loadVersionHistory} disabled={versionsLoading}>
              Refresh
            </Button>
          </div>
          {versionsError && <p className='mt-2 text-xs text-red-600'>{versionsError}</p>}

          <div className='mt-3 divide-y rounded-md border'>
            {versionsLoading ? (
              <div className='px-3 py-4 text-xs text-muted-foreground'>Loading versions…</div>
            ) : versionHistory.length === 0 ? (
              <div className='px-3 py-4 text-xs text-muted-foreground'>No versions found.</div>
            ) : (
              versionHistory.map((v) => {
                const isCurrent = version?.id === v.id;
                const inUse = v.deliveries_count > 0;
                const canDelete = !isCurrent && !inUse;
                const createdBy = v.created_by
                  ? (v.created_by === user?.id ? 'You' : (v.created_by_name || v.created_by_email || v.created_by.slice(0, 8)))
                  : 'Unknown';
                const statusLabel = v.status === 'published' ? 'Published' : v.status === 'archived' ? 'Archived' : 'Draft';
                const statusClass =
                  v.status === 'published'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : v.status === 'archived'
                      ? 'border-slate-200 bg-slate-100 text-slate-600'
                      : 'border-amber-200 bg-amber-50 text-amber-700';
                return (
                  <div key={v.id} className='px-3 py-3'>
                    <div className='flex items-center justify-between gap-2'>
                      <div className='flex items-center gap-2'>
                        <Badge variant='outline' className='text-[10px]'>v{v.version_number}</Badge>
                        <Badge variant='outline' className={cn('text-[10px]', statusClass)}>{statusLabel}</Badge>
                        {isCurrent && <Badge variant='secondary' className='text-[10px]'>Current</Badge>}
                      </div>
                      <div className='flex items-center gap-1'>
                        {v.status === 'published' && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-[10px]'
                            onClick={() => toggleArchiveVersion(v, true)}
                            disabled={versionActionId === v.id}
                          >
                            Archive
                          </Button>
                        )}
                        {v.status === 'archived' && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-[10px]'
                            onClick={() => toggleArchiveVersion(v, false)}
                            disabled={versionActionId === v.id}
                          >
                            Restore
                          </Button>
                        )}
                        {canDelete ? (
                          <ConfirmDialog
                            title='Delete version'
                            description='This will permanently delete the version. This cannot be undone.'
                            confirmText='Delete'
                            onConfirm={() => handleDeleteVersion(v)}
                            trigger={(
                              <Button size='sm' variant='destructive' className='h-7 text-[10px]' disabled={versionActionId === v.id}>
                                Delete
                              </Button>
                            )}
                          />
                        ) : (
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-[10px]'
                            disabled
                            title={isCurrent ? 'Cannot delete the current draft' : inUse ? 'Version has deliveries' : 'Not deletable'}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className='mt-1 text-[11px] text-muted-foreground'>
                      Created {formatRelativeDate(v.created_at)} by {createdBy}
                      {v.published_at && ` · Published ${formatRelativeDate(v.published_at)}`}
                      {` · Deliveries ${v.deliveries_count}`}
                    </div>
                        </div>
                );
              })
            )}
                              </div>
        </SheetContent>
      </Sheet>

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
