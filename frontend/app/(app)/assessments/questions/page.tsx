'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { QuestionEditorSheet } from '@/components/assessments/question-editor-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentCategory, AssessmentClassificationJob, AssessmentQuestion } from '@/lib/types';
import { LayoutGrid, List, MoreVertical, RefreshCw, Search, Sparkles, X } from 'lucide-react';

interface QuestionListResponse {
  items: AssessmentQuestion[];
  meta: { page: number; page_size: number; total: number };
}

type QuestionStatsResponse = {
  total: number;
  unclassified_category: number;
  unclassified_difficulty: number;
  by_status: Record<string, number>;
  by_difficulty: Record<string, number>;
  by_category: Record<string, number>;
};

type PdfImportResponse = {
  imported_count: number;
  question_ids: string[];
  warnings?: string[];
};

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
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const isActive = selected.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={isActive ? 'secondary' : 'outline'} size='sm' className='h-9'>
          {label}
          {selected.length > 0 ? ` (${selected.length})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-56'>
        {options.length === 0 ? (
          <p className='px-2 py-1 text-xs text-muted-foreground'>No options</p>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
            >
              {option.label}
              {typeof option.count === 'number' ? ` (${option.count})` : ''}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SortOption = 'updated_desc' | 'updated_asc' | 'title_asc' | 'title_desc';

const tagLabel = (tag: string) => (tag === 'pdf_import' ? 'Imported' : tag);

const formatQuestionType = (value: string) => value.replace(/_/g, ' ');

const formatRelativeDate = (dateString?: string | null) => {
  if (!dateString) return 'Updated recently';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  const diffMs = Math.max(0, Date.now() - date.getTime());
  if (diffMs < 60_000) return 'Updated just now';
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
};

const getImportSource = (tags: string[]) => {
  const sourceTag = tags.find((tag) => tag.startsWith('source:'));
  if (!sourceTag) return null;
  const value = sourceTag.slice('source:'.length).trim();
  return value || null;
};

function QuestionActionsMenu({ onEdit }: { onEdit: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='h-8 w-8'>
          <MoreVertical className='h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem disabled>Preview</DropdownMenuItem>
        <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className='text-destructive'>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuestionMetaBadges({ question }: { question: AssessmentQuestion }) {
  return (
    <div className='flex flex-wrap items-center gap-1.5 text-xs'>
      <Badge variant='secondary' className='text-[10px] font-medium'>
        {formatQuestionType(question.question_type)}
      </Badge>
      <Badge variant='outline' className='text-[10px] capitalize'>
        {question.status}
      </Badge>
      <Badge variant='outline' className='text-[10px] capitalize'>
        {question.difficulty ?? 'unspecified'}
      </Badge>
      <Badge variant='outline' className='text-[10px]'>
        {question.category?.name ?? 'Unclassified'}
      </Badge>
    </div>
  );
}

function QuestionFooterMeta({ question }: { question: AssessmentQuestion }) {
  const isImported = question.tags.includes('pdf_import');
  const source = getImportSource(question.tags);

  return (
    <div className='mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
      <span>{question.options.length} options</span>
      {isImported && (
        <Badge variant='outline' className='border-primary/30 bg-primary/5 text-[10px] text-primary/80'>
          Imported
        </Badge>
      )}
      {isImported && source && (
        <span className='max-w-[160px] truncate' title={source}>
          Source: {source}
        </span>
      )}
      <span className='ml-auto'>{formatRelativeDate(question.updated_at)}</span>
    </div>
  );
}

function QuestionCardSkeleton() {
  return (
    <Card className='flex h-full flex-col animate-pulse'>
      <CardHeader className='space-y-3 pb-2'>
        <div className='flex items-start justify-between gap-2'>
          <div className='h-4 w-4/5 rounded bg-muted/40' />
          <div className='h-8 w-8 rounded bg-muted/40' />
        </div>
        <div className='flex flex-wrap gap-2'>
          <div className='h-5 w-16 rounded-full bg-muted/40' />
          <div className='h-5 w-12 rounded-full bg-muted/40' />
          <div className='h-5 w-14 rounded-full bg-muted/40' />
          <div className='h-5 w-20 rounded-full bg-muted/40' />
        </div>
      </CardHeader>
      <CardContent className='mt-auto space-y-2 pt-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='h-3 w-16 rounded bg-muted/40' />
          <div className='h-3 w-16 rounded bg-muted/40' />
          <div className='h-3 w-20 rounded bg-muted/40' />
        </div>
        <div className='h-3 w-24 rounded bg-muted/40' />
      </CardContent>
    </Card>
  );
}

function QuestionRowSkeleton() {
  return (
    <Card className='animate-pulse'>
      <CardContent className='flex items-start justify-between gap-4 py-3'>
        <div className='flex-1 space-y-3'>
          <div className='h-4 w-4/5 rounded bg-muted/40' />
          <div className='flex flex-wrap gap-2'>
            <div className='h-5 w-16 rounded-full bg-muted/40' />
            <div className='h-5 w-12 rounded-full bg-muted/40' />
            <div className='h-5 w-14 rounded-full bg-muted/40' />
            <div className='h-5 w-20 rounded-full bg-muted/40' />
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='h-3 w-16 rounded bg-muted/40' />
            <div className='h-3 w-20 rounded bg-muted/40' />
            <div className='h-3 w-24 rounded bg-muted/40' />
          </div>
        </div>
        <div className='h-8 w-8 rounded bg-muted/40' />
      </CardContent>
    </Card>
  );
}

export default function AssessmentQuestionsPage() {
  const { accessToken } = useAuth();
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [categories, setCategories] = useState<AssessmentCategory[]>([]);
  const [stats, setStats] = useState<QuestionStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>('updated_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<AssessmentQuestion | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCount, setImportCount] = useState(20);
  const [importTags, setImportTags] = useState('');
  const [importDifficulty, setImportDifficulty] = useState('');
  const [importMaxPages, setImportMaxPages] = useState<number | ''>('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<PdfImportResponse | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyJob, setClassifyJob] = useState<AssessmentClassificationJob | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [classifyMode, setClassifyMode] = useState<'unclassified_only' | 'reclassify_all'>('unclassified_only');
  const [classifyDryRun, setClassifyDryRun] = useState(false);
  const [classifyBatchSize, setClassifyBatchSize] = useState(25);
  const [classifyScope, setClassifyScope] = useState<'all_matching' | 'selected'>('all_matching');

  const selectedQuestionIds = useMemo(() => [], []);

  const loadCategories = async () => {
    if (!accessToken) return;
    try {
      const response = await api.get<{ items: AssessmentCategory[] }>('/assessments/categories', accessToken);
      setCategories(response.items);
    } catch {
      setCategories([]);
    }
  };

  const startClassification = async () => {
    if (!accessToken) return;
    setClassifyError(null);
    try {
      const job = await api.post<AssessmentClassificationJob>(
        '/assessments/questions/classify',
        {
          mode: classifyMode,
          dry_run: classifyDryRun,
          batch_size: classifyBatchSize,
          scope: classifyScope,
          question_ids: classifyScope === 'selected' ? selectedQuestionIds : [],
          status: selectedStatuses.length ? selectedStatuses.join(',') : null,
          q: query.trim() ? query.trim() : null,
          tag: selectedTags.length ? selectedTags.join(',') : null,
          difficulty: selectedDifficulties.length ? selectedDifficulties.join(',') : null,
          category: selectedCategories.length ? selectedCategories.join(',') : null,
        },
        accessToken,
      );
      setClassifyJob(job);
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : 'Failed to start classification');
    }
  };

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (query.trim()) params.set('q', query.trim());
      if (selectedStatuses.length) params.set('status', selectedStatuses.join(','));
      if (selectedDifficulties.length) params.set('difficulty', selectedDifficulties.join(','));
      if (selectedTags.length) params.set('tag', selectedTags.join(','));
      if (selectedCategories.length) params.set('category', selectedCategories.join(','));
      const response = await api.get<QuestionListResponse>(`/assessments/questions?${params.toString()}`, accessToken);
      setQuestions(response.items);
      setTotal(response.meta.total ?? 0);
      setStats(await api.get<QuestionStatsResponse>(`/assessments/questions/stats?${params.toString()}`, accessToken));
    } finally {
      setLoading(false);
    }
  };

  const loadLatestJob = async () => {
    if (!accessToken) return;
    try {
      const latest = await api.get<AssessmentClassificationJob>('/assessments/questions/classify/jobs/latest', accessToken);
      if (['queued', 'running', 'paused'].includes(latest.status)) {
        setClassifyJob(latest);
      }
    } catch {
      // ignore (no jobs yet)
    }
  };

  useEffect(() => {
    void loadCategories();
  }, [accessToken]);

  useEffect(() => {
    void loadLatestJob();
  }, [accessToken]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(handle);
  }, [accessToken, page, pageSize, query, selectedStatuses, selectedDifficulties, selectedTags, selectedCategories]);

  useEffect(() => {
    if (!accessToken || !classifyJob) return;
    if (!['queued', 'running', 'paused'].includes(classifyJob.status)) return;
    const interval = setInterval(async () => {
      try {
        const nextJob = await api.get<AssessmentClassificationJob>(
          `/assessments/questions/classify/jobs/${classifyJob.id}`,
          accessToken,
        );
        setClassifyJob(nextJob);
        if (nextJob.status === 'completed') {
          void load();
        }
      } catch (err) {
        setClassifyError(err instanceof Error ? err.message : 'Failed to refresh job status');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [accessToken, classifyJob, classifyJob?.id, classifyJob?.status]);

  // Reset paging when filters change
  useEffect(() => {
    setPage(1);
  }, [query, selectedStatuses, selectedDifficulties, selectedTags, selectedCategories]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    questions.forEach((question) => {
      question.tags.forEach((tag) => {
        if (tag.startsWith('source:')) return;
        tags.add(tag);
      });
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const from = stats?.by_category ?? {};
    Object.entries(from).forEach(([slug, count]) => counts.set(slug, count));
    return counts;
  }, [stats]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const from = stats?.by_status ?? {};
    Object.entries(from).forEach(([key, count]) => counts.set(key, count));
    return counts;
  }, [stats]);

  const difficultyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const from = stats?.by_difficulty ?? {};
    Object.entries(from).forEach(([key, count]) => counts.set(key, count));
    return counts;
  }, [stats]);

  const statusOptions: FilterOption[] = [
    { value: 'draft', label: 'Draft', count: statusCounts.get('draft') ?? 0 },
    { value: 'published', label: 'Published', count: statusCounts.get('published') ?? 0 },
    { value: 'archived', label: 'Archived', count: statusCounts.get('archived') ?? 0 },
  ];

  const difficultyOptions: FilterOption[] = [
    { value: 'easy', label: 'Easy', count: difficultyCounts.get('easy') ?? 0 },
    { value: 'medium', label: 'Medium', count: difficultyCounts.get('medium') ?? 0 },
    { value: 'hard', label: 'Hard', count: difficultyCounts.get('hard') ?? 0 },
  ];

  const categoryOptions: FilterOption[] = categories.map((category) => ({
    value: category.slug,
    label: category.name,
    count: categoryCounts.get(category.slug) ?? 0,
  }));

  const categoryFilterOptions: FilterOption[] = [
    { value: 'unclassified', label: 'Unclassified', count: stats?.unclassified_category ?? 0 },
    ...categoryOptions,
  ];

  const tagOptions: FilterOption[] = availableTags.map((tag) => ({ value: tag, label: tagLabel(tag) }));

  const hasActiveFilters =
    query.trim() ||
    selectedStatuses.length ||
    selectedDifficulties.length ||
    selectedCategories.length ||
    selectedTags.length;

  const clearFilters = () => {
    setQuery('');
    setSelectedStatuses([]);
    setSelectedDifficulties([]);
    setSelectedCategories([]);
    setSelectedTags([]);
  };

  const sortedQuestions = useMemo(() => {
    const next = [...questions];
    switch (sort) {
      case 'updated_asc':
        next.sort((a, b) => (new Date(a.updated_at ?? 0).getTime() || 0) - (new Date(b.updated_at ?? 0).getTime() || 0));
        break;
      case 'title_asc':
        next.sort((a, b) => a.prompt.localeCompare(b.prompt));
        break;
      case 'title_desc':
        next.sort((a, b) => b.prompt.localeCompare(a.prompt));
        break;
      case 'updated_desc':
      default:
        next.sort((a, b) => (new Date(b.updated_at ?? 0).getTime() || 0) - (new Date(a.updated_at ?? 0).getTime() || 0));
        break;
    }
    return next;
  }, [questions, sort]);

  const classifyReport = (classifyJob?.report_json as Record<string, unknown> | undefined) ?? undefined;
  const classifyUpdated = Number(classifyReport?.updated ?? 0);
  const classifyCreatedCategories = Number(classifyReport?.created_categories ?? 0);
  const classifyProgress =
    classifyJob && classifyJob.total > 0
      ? Math.round((classifyJob.processed / classifyJob.total) * 100)
      : 0;

  const isClassifyActive = !!classifyJob && ['queued', 'running', 'paused'].includes(classifyJob.status);
  const isInitialLoading = loading && questions.length === 0;
  const isRefreshing = loading && questions.length > 0;
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const fromRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = Math.min(total, page * pageSize);
  const totalCount = stats?.total ?? total;
  const resultsLabel = totalCount === 1 ? '1 question' : `${totalCount} questions`;
  const selectedCount = selectedQuestionIds.length;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1'>
          <h1 className='text-3xl font-semibold tracking-tight'>Question Bank</h1>
          <p className='text-sm text-muted-foreground'>Maintain reusable questions for assessments.</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='outline' onClick={() => setImportOpen(true)}>
            Import PDF
          </Button>
          <Button variant='outline' onClick={() => setClassifyOpen(true)}>
            <Sparkles className='mr-2 h-4 w-4' />
            Smart classify
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            New question
          </Button>
        </div>
      </div>

      {isClassifyActive && classifyJob && (
        <Card className='border-primary/30 bg-primary/5'>
          <CardContent className='flex flex-wrap items-center gap-3 py-3'>
            <div className='min-w-[220px]'>
              <p className='text-sm font-medium'>Smart classify is {classifyJob.status}</p>
              <p className='text-xs text-muted-foreground'>
                Processed {classifyJob.processed} / {classifyJob.total}
              </p>
            </div>
            <div className='flex-1'>
              <Progress value={classifyProgress} className='h-2' />
            </div>
            <div className='flex items-center gap-2'>
              {classifyJob.status === 'paused' || classifyJob.pause_requested ? (
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={async () => {
                    if (!accessToken) return;
                    await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/resume`, {}, accessToken);
                    await loadLatestJob();
                  }}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={async () => {
                    if (!accessToken) return;
                    await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/pause`, {}, accessToken);
                    await loadLatestJob();
                  }}
                >
                  Pause
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                onClick={async () => {
                  if (!accessToken) return;
                  await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/cancel`, {}, accessToken);
                  await loadLatestJob();
                }}
              >
                Stop
              </Button>
              <Button size='sm' variant='outline' onClick={() => setClassifyOpen(true)}>
                Details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-6 lg:grid-cols-[240px,1fr]'>
        <aside className='sticky top-4 h-fit rounded-lg border bg-muted/20 p-3'>
          <div className='flex items-center justify-between'>
            <p className='text-sm font-semibold'>Categories</p>
          </div>
          <div className='mt-3 space-y-1'>
            <Button
              type='button'
              variant={selectedCategories.length === 0 ? 'secondary' : 'ghost'}
              className='w-full justify-between px-2 py-1.5 text-sm'
              onClick={() => setSelectedCategories([])}
            >
              <span>All categories</span>
              <span className='text-xs text-muted-foreground'>{totalCount}</span>
            </Button>
            <Button
              type='button'
              variant={selectedCategories.includes('unclassified') ? 'secondary' : 'ghost'}
              className='w-full justify-between px-2 py-1.5 text-sm'
              onClick={() => {
                setSelectedCategories((prev) =>
                  prev.includes('unclassified') ? prev.filter((item) => item !== 'unclassified') : [...prev, 'unclassified'],
                );
              }}
            >
              <span>Unclassified</span>
              <span className='text-xs text-muted-foreground'>{stats?.unclassified_category ?? 0}</span>
            </Button>
            {categoryOptions.map((category) => (
              <Button
                key={category.value}
                type='button'
                variant={selectedCategories.includes(category.value) ? 'secondary' : 'ghost'}
                className='w-full justify-between px-2 py-1.5 text-sm'
                onClick={() => {
                  setSelectedCategories((prev) =>
                    prev.includes(category.value)
                      ? prev.filter((item) => item !== category.value)
                      : [...prev, category.value],
                  );
                }}
              >
                <span>{category.label}</span>
                <span className='text-xs text-muted-foreground'>{category.count ?? 0}</span>
              </Button>
            ))}
          </div>
        </aside>

        <div className='space-y-4'>
          <div className='sticky top-0 z-10 rounded-md border bg-background/80 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/70'>
            <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
              <div className='flex flex-wrap items-center gap-2'>
                <div className='relative w-full sm:max-w-xs'>
                  <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search questions…'
                    className='pl-9'
                  />
                </div>
                <FilterMenu
                  label='Status'
                  options={statusOptions}
                  selected={selectedStatuses}
                  onChange={setSelectedStatuses}
                />
                <FilterMenu
                  label='Difficulty'
                  options={difficultyOptions}
                  selected={selectedDifficulties}
                  onChange={setSelectedDifficulties}
                />
                <div className='lg:hidden'>
                  <FilterMenu
                    label='Category'
                    options={categoryFilterOptions}
                    selected={selectedCategories}
                    onChange={setSelectedCategories}
                  />
                </div>
                <FilterMenu label='Tags' options={tagOptions} selected={selectedTags} onChange={setSelectedTags} />
                <div className='flex items-center gap-2'>
                  <span className='text-xs text-muted-foreground'>Sort</span>
                  <select
                    className='h-9 rounded-md border border-input bg-background px-2 text-xs'
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortOption)}
                  >
                    <option value='updated_desc'>Updated: newest</option>
                    <option value='updated_asc'>Updated: oldest</option>
                    <option value='title_asc'>Title: A–Z</option>
                    <option value='title_desc'>Title: Z–A</option>
                  </select>
                </div>
                <Button variant='outline' size='icon' onClick={() => void load()} aria-label='Refresh'>
                  <RefreshCw className='h-4 w-4' />
                </Button>
              </div>
              <div className='flex flex-wrap items-center gap-2 lg:ml-auto'>
                {hasActiveFilters && (
                  <Button variant='ghost' size='sm' onClick={clearFilters}>
                    <X className='mr-1 h-3 w-3' />
                    Clear filters
                  </Button>
                )}
                <span className='text-sm font-medium text-muted-foreground'>{resultsLabel}</span>
                {selectedCount > 0 && (
                  <span className='text-xs text-muted-foreground'>{selectedCount} selected</span>
                )}
                {isRefreshing && <span className='text-xs text-muted-foreground'>Updating…</span>}
                <select
                  className='h-9 rounded-md border border-input bg-background px-2 text-xs'
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value || 24))}
                >
                  <option value={12}>12 / page</option>
                  <option value={24}>24 / page</option>
                  <option value={48}>48 / page</option>
                </select>
                <div className='flex items-center gap-1 rounded-md border p-1'>
                  <Button
                    type='button'
                    size='sm'
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('grid')}
                    aria-label='Grid view'
                  >
                    <LayoutGrid className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('list')}
                    aria-label='List view'
                  >
                    <List className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </div>

            {hasActiveFilters && (
              <div className='mt-3 flex flex-wrap items-center gap-2 border-t pt-3'>
                {query.trim() && (
                  <Badge variant='secondary' className='flex items-center gap-1'>
                    Search: {query.trim()}
                    <button
                      type='button'
                      className='rounded p-0.5 hover:bg-muted'
                      onClick={() => setQuery('')}
                      aria-label='Clear search'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                )}
                {selectedStatuses.map((value) => (
                  <Badge key={`status-${value}`} variant='secondary' className='flex items-center gap-1 capitalize'>
                    Status: {value}
                    <button
                      type='button'
                      className='rounded p-0.5 hover:bg-muted'
                      onClick={() => setSelectedStatuses((prev) => prev.filter((item) => item !== value))}
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
                {selectedDifficulties.map((value) => (
                  <Badge key={`difficulty-${value}`} variant='secondary' className='flex items-center gap-1 capitalize'>
                    Difficulty: {value}
                    <button
                      type='button'
                      className='rounded p-0.5 hover:bg-muted'
                      onClick={() => setSelectedDifficulties((prev) => prev.filter((item) => item !== value))}
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
                {selectedCategories.map((value) => {
                  const label =
                    value === 'unclassified'
                      ? 'Unclassified'
                      : categories.find((cat) => cat.slug === value)?.name || value;
                  return (
                    <Badge key={`category-${value}`} variant='secondary' className='flex items-center gap-1'>
                      Category: {label}
                      <button
                        type='button'
                        className='rounded p-0.5 hover:bg-muted'
                        onClick={() => setSelectedCategories((prev) => prev.filter((item) => item !== value))}
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </Badge>
                  );
                })}
                {selectedTags.map((value) => (
                  <Badge key={`tag-${value}`} variant='secondary' className='flex items-center gap-1'>
                    Tag: {tagLabel(value)}
                    <button
                      type='button'
                      className='rounded p-0.5 hover:bg-muted'
                      onClick={() => setSelectedTags((prev) => prev.filter((item) => item !== value))}
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {isInitialLoading ? (
            viewMode === 'grid' ? (
              <div className='grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3'>
                {Array.from({ length: 6 }).map((_, idx) => (
                  <QuestionCardSkeleton key={`grid-skeleton-${idx}`} />
                ))}
              </div>
            ) : (
              <div className='space-y-2'>
                {Array.from({ length: 6 }).map((_, idx) => (
                  <QuestionRowSkeleton key={`list-skeleton-${idx}`} />
                ))}
              </div>
            )
          ) : sortedQuestions.length === 0 ? (
            hasActiveFilters ? (
              <div className='rounded-lg border border-dashed bg-white/80 p-8 text-center'>
                <h3 className='text-base font-semibold'>No questions match your filters</h3>
                <p className='mt-2 text-sm text-muted-foreground'>
                  Try adjusting your search or clearing the current filters.
                </p>
                <Button variant='outline' size='sm' className='mt-4' onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <EmptyState title='No questions found' description='Add your first assessment question.' />
            )
          ) : viewMode === 'grid' ? (
            <div className='grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {sortedQuestions.map((question) => (
                <Card key={question.id} className='flex h-full flex-col transition-colors hover:border-primary/40'>
                  <CardHeader className='space-y-2 pb-2'>
                    <div className='flex items-start justify-between gap-2'>
                      <CardTitle className='text-base font-semibold leading-snug line-clamp-2'>
                        {question.prompt}
                      </CardTitle>
                      <QuestionActionsMenu
                        onEdit={() => {
                          setEditing(question);
                          setEditorOpen(true);
                        }}
                      />
                    </div>
                    <QuestionMetaBadges question={question} />
                  </CardHeader>
                  <CardContent className='flex flex-1 flex-col pt-0'>
                    <QuestionFooterMeta question={question} />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className='space-y-2'>
              {sortedQuestions.map((question) => (
                <Card key={question.id} className='transition-colors hover:border-primary/40'>
                  <CardContent className='flex items-start justify-between gap-4 py-3'>
                    <div className='min-w-0 flex-1 space-y-2'>
                      <p className='text-sm font-semibold leading-snug line-clamp-2'>{question.prompt}</p>
                      <QuestionMetaBadges question={question} />
                      <QuestionFooterMeta question={question} />
                    </div>
                    <QuestionActionsMenu
                      onEdit={() => {
                        setEditing(question);
                        setEditorOpen(true);
                      }}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className='flex flex-wrap items-center justify-between gap-3 pt-2'>
            <p className='text-xs text-muted-foreground'>
              Showing {fromRow}–{toRow} of {total}
            </p>
            <div className='flex items-center gap-2'>
              <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Prev
              </Button>
              <span className='text-xs text-muted-foreground'>
                Page {page} / {totalPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>

      <QuestionEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        categories={categories}
        onSave={async (payload) => {
          if (!accessToken) return;
          if (editing) {
            await api.put(`/assessments/questions/${editing.id}`, payload, accessToken);
          } else {
            await api.post('/assessments/questions', payload, accessToken);
          }
          await load();
        }}
      />

      <Sheet
        open={classifyOpen}
        onOpenChange={(open) => {
          setClassifyOpen(open);
          if (!open) {
            setClassifyError(null);
            setClassifyMode('unclassified_only');
            setClassifyDryRun(false);
            setClassifyBatchSize(25);
            setClassifyScope('all_matching');
          }
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle className='text-lg font-semibold'>Smart classify questions</SheetTitle>
            <p className='text-sm text-muted-foreground'>
              Automatically assign category and difficulty using OpenAI. New categories will be created when detected.
            </p>
          </SheetHeader>

          <div className='mt-5 space-y-4'>
            <div className='rounded-md border bg-muted/20 p-3 text-sm'>
              <p>
                Unclassified in current view:{' '}
                <span className='font-medium'>{stats?.unclassified_category ?? 0}</span>
              </p>
              <p className='text-xs text-muted-foreground'>
                Classification runs across all questions, not just the current filters.
              </p>
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='classify-mode'>Mode</Label>
                <select
                  id='classify-mode'
                  className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                  value={classifyMode}
                  onChange={(event) =>
                    setClassifyMode(event.target.value as 'unclassified_only' | 'reclassify_all')
                  }
                >
                  <option value='unclassified_only'>Unclassified only</option>
                  <option value='reclassify_all'>Reclassify all</option>
                </select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='classify-batch'>Batch size</Label>
                <Input
                  id='classify-batch'
                  type='number'
                  min={5}
                  max={50}
                  value={classifyBatchSize}
                  onChange={(event) => setClassifyBatchSize(Number(event.target.value || 25))}
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='classify-scope'>Scope</Label>
              <select
                id='classify-scope'
                className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                value={classifyScope}
                onChange={(event) => setClassifyScope(event.target.value as 'all_matching' | 'selected')}
              >
                <option value='all_matching'>Current filters (recommended)</option>
                <option value='selected' disabled>
                  Selected questions (coming next)
                </option>
              </select>
              <p className='text-xs text-muted-foreground'>
                Current filters uses your search + Status/Difficulty/Tags/Category filters.
              </p>
            </div>

            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={classifyDryRun}
                onChange={(event) => setClassifyDryRun(event.target.checked)}
              />
              Dry run (preview only, no changes saved)
            </label>

            {classifyError && <p className='text-sm text-destructive'>{classifyError}</p>}

            {classifyJob && (
              <div className='space-y-3 rounded-md border bg-muted/20 p-3 text-sm'>
                <div className='flex items-center justify-between'>
                  <p className='font-medium'>Job status</p>
                  <Badge variant='outline'>{classifyJob.status}</Badge>
                </div>
                <p>
                  Processed {classifyJob.processed} / {classifyJob.total}
                </p>
                <Progress value={classifyProgress} className='h-2' />
                {['queued', 'running', 'paused'].includes(classifyJob.status) && (
                  <div className='flex flex-wrap gap-2'>
                    {classifyJob.status === 'paused' || classifyJob.pause_requested ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={async () => {
                          if (!accessToken) return;
                          await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/resume`, {}, accessToken);
                          await loadLatestJob();
                        }}
                      >
                        Resume
                      </Button>
                    ) : (
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={async () => {
                          if (!accessToken) return;
                          await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/pause`, {}, accessToken);
                          await loadLatestJob();
                        }}
                      >
                        Pause
                      </Button>
                    )}
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={async () => {
                        if (!accessToken) return;
                        await api.post(`/assessments/questions/classify/jobs/${classifyJob.id}/cancel`, {}, accessToken);
                        await loadLatestJob();
                      }}
                    >
                      Stop
                    </Button>
                  </div>
                )}
                {classifyJob.status === 'failed' && classifyJob.error_summary && (
                  <p className='text-xs text-destructive'>{classifyJob.error_summary}</p>
                )}
                {classifyJob.status === 'completed' && (
                  <div className='space-y-1 text-xs text-muted-foreground'>
                    <p>Updated: {classifyUpdated}</p>
                    <p>New categories: {classifyCreatedCategories}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className='mt-6'>
            <Button type='button' variant='outline' onClick={() => setClassifyOpen(false)}>
              Close
            </Button>
            <Button
              type='button'
              onClick={startClassification}
              disabled={!accessToken || classifyJob?.status === 'running' || classifyJob?.status === 'queued'}
            >
              {classifyJob ? 'Re-run classification' : 'Start classification'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportError(null);
            setImportResult(null);
            setImportFile(null);
            setImportCount(20);
            setImportTags('');
            setImportDifficulty('');
            setImportMaxPages('');
          }
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle className='text-lg font-semibold'>Import questions from PDF</SheetTitle>
            <p className='text-sm text-muted-foreground'>
              Upload a text-based PDF (scanned PDFs need OCR). Questions are imported as <span className='font-medium'>draft</span>.
            </p>
          </SheetHeader>

          <div className='mt-5 space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='pdf'>PDF file</Label>
              <Input
                id='pdf'
                type='file'
                accept='application/pdf'
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='count'>Questions to generate</Label>
                <Input
                  id='count'
                  type='number'
                  min={1}
                  max={100}
                  value={importCount}
                  onChange={(event) => setImportCount(Number(event.target.value || 20))}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='difficulty'>Difficulty</Label>
                <select
                  id='difficulty'
                  className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                  value={importDifficulty}
                  onChange={(event) => setImportDifficulty(event.target.value)}
                >
                  <option value=''>Mixed</option>
                  <option value='easy'>Easy</option>
                  <option value='medium'>Medium</option>
                  <option value='hard'>Hard</option>
                </select>
              </div>
              <div className='space-y-2 sm:col-span-2'>
                <Label htmlFor='tags'>Tags (comma separated)</Label>
                <Input
                  id='tags'
                  value={importTags}
                  onChange={(event) => setImportTags(event.target.value)}
                  placeholder='security, sdlc, iam'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='max_pages'>Max pages (optional)</Label>
                <Input
                  id='max_pages'
                  type='number'
                  min={1}
                  max={500}
                  value={importMaxPages}
                  onChange={(event) => {
                    const v = event.target.value;
                    setImportMaxPages(v ? Number(v) : '');
                  }}
                  placeholder='e.g. 40'
                />
              </div>
            </div>

            {importError && <p className='text-sm text-destructive'>{importError}</p>}
            {importResult && (
              <div className='rounded-md border bg-muted/20 p-3 text-sm'>
                <p className='font-medium'>Imported {importResult.imported_count} questions</p>
                {importResult.warnings && importResult.warnings.length > 0 && (
                  <div className='mt-2 space-y-1 text-xs text-muted-foreground'>
                    {importResult.warnings.slice(0, 6).map((w, idx) => (
                      <p key={idx}>- {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className='mt-6'>
            <Button
              type='button'
              variant='outline'
              onClick={() => setImportOpen(false)}
              disabled={importing}
            >
              Close
            </Button>
            <Button
              type='button'
              disabled={!accessToken || importing || !importFile}
              onClick={async () => {
                if (!accessToken || !importFile) return;
                setImporting(true);
                setImportError(null);
                setImportResult(null);
                try {
                  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
                  const formData = new FormData();
                  formData.append('file', importFile);
                  formData.append('question_count', String(importCount));
                  formData.append('tags', importTags);
                  formData.append('difficulty', importDifficulty);
                  if (importMaxPages !== '') {
                    formData.append('max_pages', String(importMaxPages));
                  }

                  const resp = await fetch(`${apiBase}/assessments/questions/import-pdf`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}` },
                    body: formData,
                  });

                  if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(text || `Import failed (${resp.status})`);
                  }

                  const data = (await resp.json()) as PdfImportResponse;
                  setImportResult(data);
                  await load();
                } catch (err) {
                  setImportError(err instanceof Error ? err.message : 'Failed to import PDF');
                } finally {
                  setImporting(false);
                }
              }}
            >
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
