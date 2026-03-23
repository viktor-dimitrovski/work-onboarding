'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { AiInstructionsPanel } from '@/components/assessments/ai-instructions-panel';
import { QuestionEditorSheet } from '@/components/assessments/question-editor-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { HierarchicalCategoryMenu } from '@/components/assessments/hierarchical-category-menu';
import type { ImportTemplate } from '@/lib/import-templates';
import type { AssessmentCategory, AssessmentCategoryTreeNode, AssessmentClassificationJob, AssessmentQuestion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Check, FolderOpen, LayoutGrid, List, MoreVertical, RefreshCw, Search, Sparkles, X } from 'lucide-react';

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
        <Button variant={isActive ? 'secondary' : 'outline'} size='sm' className='h-8 text-xs font-normal'>
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

function QuestionActionsMenu({
  onEdit,
  onPreview,
  onDuplicate,
  onPublish,
  onArchive,
  onSetCategory,
}: {
  onEdit: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onArchive: () => void;
  onSetCategory: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='h-8 w-8'>
          <MoreVertical className='h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={onPreview}>Preview</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem onSelect={onPublish}>Publish</DropdownMenuItem>
        <DropdownMenuItem onSelect={onSetCategory}>
          <FolderOpen className='mr-2 h-3.5 w-3.5' />
          Set category
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchive} className='text-destructive focus:text-destructive'>
          Archive
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
    <div className='flex animate-pulse items-center gap-2 px-3 py-1.5'>
      <div className='h-3.5 w-3.5 rounded bg-muted/40' />
      <div className='h-4 flex-1 rounded bg-muted/40' />
      <div className='flex items-center gap-1'>
        <div className='h-5 w-16 rounded-full bg-muted/40' />
        <div className='h-5 w-12 rounded-full bg-muted/40' />
        <div className='h-5 w-14 rounded-full bg-muted/40' />
      </div>
      <div className='h-3 w-16 rounded bg-muted/40' />
      <div className='h-6 w-6 rounded bg-muted/40' />
    </div>
  );
}

export default function AssessmentQuestionsPage() {
  const { accessToken } = useAuth();
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [categories, setCategories] = useState<AssessmentCategory[]>([]);
  const [categoryTree, setCategoryTree] = useState<AssessmentCategoryTreeNode[]>([]);
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
  const [importCategory, setImportCategory] = useState('');
  const [importMaxPages, setImportMaxPages] = useState<number | ''>('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<PdfImportResponse | null>(null);
  const [textImportOpen, setTextImportOpen] = useState(false);
  const [textImportText, setTextImportText] = useState('');
  const [textImportCount, setTextImportCount] = useState(20);
  const [textImportTags, setTextImportTags] = useState('');
  const [textImportDifficulty, setTextImportDifficulty] = useState('');
  const [textImportCategory, setTextImportCategory] = useState('');
  const [textImporting, setTextImporting] = useState(false);
  const [textImportError, setTextImportError] = useState<string | null>(null);
  const [textImportResult, setTextImportResult] = useState<PdfImportResponse | null>(null);
  const [textImportProgress, setTextImportProgress] = useState(0);
  const [textImportPhase, setTextImportPhase] = useState('');
  const [textImportJobId, setTextImportJobId] = useState<string | null>(null);
  const [textImportCancelling, setTextImportCancelling] = useState(false);
  const textImportPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shared AI Instructions state — used by both import forms
  const [aiUserTemplates, setAiUserTemplates] = useState<ImportTemplate[]>([]);
  const [importAiTemplate, setImportAiTemplate] = useState('');
  const [importMaterialContext, setImportMaterialContext] = useState('');
  const [importExtraInstructions, setImportExtraInstructions] = useState('');
  const [importAutoCount, setImportAutoCount] = useState(false);

  const IMPORT_JOB_KEY = 'textImportJobId';
  const [dedupePreview, setDedupePreview] = useState<{ duplicate_groups: number; archived_count: number } | null>(null);
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [dedupeError, setDedupeError] = useState<string | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyJob, setClassifyJob] = useState<AssessmentClassificationJob | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [classifyMode, setClassifyMode] = useState<'unclassified_only' | 'reclassify_all'>('unclassified_only');
  const [classifyDryRun, setClassifyDryRun] = useState(false);
  const [classifyBatchSize, setClassifyBatchSize] = useState(25);
  const [classifyScope, setClassifyScope] = useState<'all_matching' | 'selected'>('all_matching');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [previewQuestion, setPreviewQuestion] = useState<AssessmentQuestion | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [classifyingQuestion, setClassifyingQuestion] = useState<AssessmentQuestion | null>(null);
  const [categoryPickerSearch, setCategoryPickerSearch] = useState('');
  const [classifyingSaving, setClassifyingSaving] = useState(false);

  const loadCategories = async () => {
    if (!accessToken) return;
    try {
      const [flat, tree] = await Promise.all([
        api.get<{ items: AssessmentCategory[] }>('/assessments/categories', accessToken),
        api.get<{ items: AssessmentCategoryTreeNode[] }>('/assessments/categories/tree', accessToken),
      ]);
      setCategories(flat.items);
      setCategoryTree(tree.items);
    } catch {
      setCategories([]);
      setCategoryTree([]);
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

  const loadAiUserTemplates = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await api.get<Array<{
        id: string; name: string; context_placeholder: string | null;
        extra_instructions: string; auto_question_count: boolean; sort_order: number;
      }>>('/assessments/ai-import-templates', accessToken);
      setAiUserTemplates(data.map((t) => ({
        id: t.id,
        name: t.name,
        context_placeholder: t.context_placeholder ?? '',
        extra_instructions: t.extra_instructions,
        auto_question_count: t.auto_question_count,
      })));
    } catch {
      // silently fail — templates are optional
    }
  }, [accessToken]);

  const resetAiInstructions = useCallback(() => {
    setImportAiTemplate('');
    setImportMaterialContext('');
    setImportExtraInstructions('');
    setImportAutoCount(false);
  }, []);

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
      // Facet counts should not collapse to zero when a category filter is active.
      // We compute stats for the current query/status/tag/difficulty, but exclude the category filter itself.
      const statsParams = new URLSearchParams(params);
      statsParams.delete('category');
      setStats(await api.get<QuestionStatsResponse>(`/assessments/questions/stats?${statsParams.toString()}`, accessToken));
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

  useEffect(() => {
    setSelectedQuestionIds((prev) => prev.filter((id) => questions.some((question) => question.id === id)));
  }, [questions]);

  // Resume polling if a job was running before a page refresh
  useEffect(() => {
    if (!accessToken) return;
    const savedJobId = localStorage.getItem(IMPORT_JOB_KEY);
    if (!savedJobId) return;

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
    // Peek at the job status; only resume if it is still running
    fetch(`${apiBase}/assessments/questions/import-jobs/${savedJobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((job) => {
        if (!job || job.status !== 'running') {
          localStorage.removeItem(IMPORT_JOB_KEY);
          return;
        }
        // Restore in-progress state and open the sheet
        setTextImportJobId(savedJobId);
        setTextImporting(true);
        setTextImportProgress(job.percent ?? 0);
        setTextImportPhase(job.phase ?? 'Resuming…');
        setTextImportOpen(true);
        startPolling(savedJobId, accessToken, apiBase);
      })
      .catch(() => localStorage.removeItem(IMPORT_JOB_KEY));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

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

  type ImportJobStatus = {
    status: string;
    percent: number;
    phase: string;
    questions_created: number;
    total_chunks: number;
    done_chunks: number;
    cancel_requested?: boolean;
    warnings?: string[];
    error?: string | null;
    imported_count?: number | null;
    question_ids?: string[] | null;
  };

  const startPolling = (jobId: string, token: string, apiBase: string) => {
    if (textImportPollRef.current) clearInterval(textImportPollRef.current);

    textImportPollRef.current = setInterval(async () => {
      try {
        const pollResp = await fetch(`${apiBase}/assessments/questions/import-jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!pollResp.ok) {
          clearInterval(textImportPollRef.current!);
          textImportPollRef.current = null;
          setTextImportError(`Polling failed (${pollResp.status})`);
          setTextImporting(false);
          setTextImportCancelling(false);
          localStorage.removeItem(IMPORT_JOB_KEY);
          return;
        }

        const job = (await pollResp.json()) as ImportJobStatus;
        setTextImportProgress(job.percent);
        setTextImportPhase(job.phase);

        if (job.status === 'done') {
          clearInterval(textImportPollRef.current!);
          textImportPollRef.current = null;
          setTextImportProgress(100);
          setTextImportResult({
            imported_count: job.imported_count ?? job.questions_created,
            question_ids: job.question_ids ?? [],
            warnings: job.warnings ?? [],
          });
          setTextImporting(false);
          setTextImportCancelling(false);
          setTextImportJobId(null);
          localStorage.removeItem(IMPORT_JOB_KEY);
          await load();
        } else if (job.status === 'cancelled') {
          clearInterval(textImportPollRef.current!);
          textImportPollRef.current = null;
          setTextImportError('Import was cancelled.');
          setTextImportProgress(0);
          setTextImportPhase('');
          setTextImporting(false);
          setTextImportCancelling(false);
          setTextImportJobId(null);
          localStorage.removeItem(IMPORT_JOB_KEY);
        } else if (job.status === 'error') {
          clearInterval(textImportPollRef.current!);
          textImportPollRef.current = null;
          setTextImportError(job.error ?? 'Import failed on the server.');
          setTextImportProgress(0);
          setTextImportPhase('');
          setTextImporting(false);
          setTextImportCancelling(false);
          setTextImportJobId(null);
          localStorage.removeItem(IMPORT_JOB_KEY);
        }
      } catch {
        // network hiccup – keep polling
      }
    }, 2000);
  };

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

  const hasActiveFilters = !!(
    query.trim() ||
    selectedStatuses.length ||
    selectedDifficulties.length ||
    selectedCategories.length ||
    selectedTags.length
  );

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

  // Build a map of category id → full path string (e.g. "School / History / 8th Grade")
  const categoryPathMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const buildPath = (id: string): string => {
      const cat = categories.find((c) => c.id === id);
      if (!cat) return '';
      const prefix = cat.parent_id ? buildPath(cat.parent_id) : '';
      return prefix ? `${prefix} / ${cat.name}` : cat.name;
    };
    categories.forEach((c) => map.set(c.id, buildPath(c.id)));
    return map;
  }, [categories]);

  const visibleQuestionIds = useMemo(() => sortedQuestions.map((question) => question.id), [sortedQuestions]);
  const allVisibleSelected =
    visibleQuestionIds.length > 0 && visibleQuestionIds.every((id) => selectedQuestionIds.includes(id));

  // When true, bulk actions target ALL matching questions (all pages) using all_matching scope
  const [selectAllMode, setSelectAllMode] = useState(false);

  // Current filter params forwarded to all_matching bulk actions
  const currentFilterParams = useMemo(() => ({
    status: selectedStatuses.length ? selectedStatuses.join(',') : undefined,
    q: query.trim() || undefined,
    tag: selectedTags.length ? selectedTags.join(',') : undefined,
    difficulty: selectedDifficulties.length ? selectedDifficulties.join(',') : undefined,
    category: selectedCategories.length ? selectedCategories.join(',') : undefined,
  }), [selectedStatuses, query, selectedTags, selectedDifficulties, selectedCategories]);

  const toggleSelect = (questionId: string) => {
    setSelectAllMode(false);
    setSelectedQuestionIds((prev) =>
      prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId],
    );
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectAllMode(false);
    setSelectedQuestionIds(checked ? visibleQuestionIds : []);
  };

  const buildBulkPayload = (action: string, extra?: Record<string, unknown>) => {
    if (selectAllMode) {
      return { scope: 'all_matching', action, ...currentFilterParams, ...extra };
    }
    return { scope: 'selected', question_ids: selectedQuestionIds, action, ...extra };
  };

  const archiveQuestions = async (ids: string[]) => {
    if (!accessToken || (ids.length === 0 && !selectAllMode)) return;
    setArchiving(true);
    try {
      await api.post(
        '/assessments/questions/bulk-update',
        buildBulkPayload('set_status', { status_value: 'archived' }),
        accessToken,
      );
      setSelectAllMode(false);
      setSelectedQuestionIds((prev) => prev.filter((id) => !ids.includes(id)));
      await load();
    } finally {
      setArchiving(false);
    }
  };

  const deleteQuestions = async (ids: string[]) => {
    if (!accessToken || (ids.length === 0 && !selectAllMode)) return;
    setDeleting(true);
    try {
      await api.post(
        '/assessments/questions/bulk-update',
        buildBulkPayload('delete_permanently'),
        accessToken,
      );
      setSelectAllMode(false);
      setSelectedQuestionIds((prev) => prev.filter((id) => !ids.includes(id)));
      await load();
    } finally {
      setDeleting(false);
    }
  };

  const classifyQuestion = async (questionId: string, categoryId: string | null) => {
    if (!accessToken) return;
    setClassifyingSaving(true);
    try {
      await api.put(`/assessments/questions/${questionId}`, { category_id: categoryId }, accessToken);
      setClassifyingQuestion(null);
      setCategoryPickerSearch('');
      await load();
    } finally {
      setClassifyingSaving(false);
    }
  };

  const [publishing, setPublishing] = useState(false);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  const publishQuestions = async (ids: string[]) => {
    if (!accessToken || (ids.length === 0 && !selectAllMode)) return;
    setPublishing(true);
    setPublishedCount(null);
    try {
      await api.post(
        '/assessments/questions/bulk-update',
        buildBulkPayload('set_status', { status_value: 'published' }),
        accessToken,
      );
      setSelectAllMode(false);
      setSelectedQuestionIds((prev) => prev.filter((id) => !ids.includes(id)));
      setPublishedCount(ids.length);
      await load();
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishedCount(null), 3000);
    }
  };

  const duplicateQuestion = async (question: AssessmentQuestion) => {
    if (!accessToken) return;
    const payload = {
      prompt: `${question.prompt} (Copy)`,
      question_type: question.question_type,
      difficulty: question.difficulty,
      category_id: question.category_id,
      tags: question.tags,
      status: 'draft',
      explanation: question.explanation,
      options: question.options.map((option) => ({
        option_text: option.option_text,
        is_correct: option.is_correct,
        order_index: option.order_index,
      })),
    };
    await api.post('/assessments/questions', payload, accessToken);
    await load();
  };

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
  const resultsLabel = total === 1 ? '1 question' : `${total} questions`;
  const selectedCount = selectedQuestionIds.length;
  const allCategoriesCount = stats?.total ?? total;

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-xl font-semibold tracking-tight'>Question Bank</h1>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Button variant='outline' size='sm' onClick={() => { setImportOpen(true); loadAiUserTemplates(); }}>
            Import PDF
          </Button>
          <Button variant='outline' size='sm' onClick={() => { setTextImportOpen(true); loadAiUserTemplates(); }}>
            Import Text
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={async () => {
              if (!accessToken) return;
              setDedupeRunning(true);
              setDedupeError(null);
              setDedupePreview(null);
              try {
                const result = await api.post<{ duplicate_groups: number; archived_count: number; dry_run: boolean }>(
                  '/assessments/questions/deduplicate?dry_run=true',
                  {},
                  accessToken,
                );
                setDedupePreview(result);
              } catch (err) {
                setDedupeError(err instanceof Error ? err.message : 'Failed to scan for duplicates');
              } finally {
                setDedupeRunning(false);
              }
            }}
            disabled={dedupeRunning}
          >
            {dedupeRunning ? 'Scanning…' : 'Remove duplicates'}
          </Button>
          <Button variant='outline' size='sm' onClick={() => setClassifyOpen(true)}>
            <Sparkles className='mr-1.5 h-3.5 w-3.5' />
            Smart classify
          </Button>
          <Button
            size='sm'
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

      {dedupeError && (
        <p className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
          {dedupeError}
        </p>
      )}

      <div className='grid gap-6 lg:grid-cols-[240px,1fr]'>
        <aside className='sticky top-4 h-fit rounded-lg border bg-muted/20 p-3'>
          <p className='mb-2 text-sm font-semibold'>Categories</p>
          <HierarchicalCategoryMenu
            tree={categoryTree}
            unclassifiedCount={stats?.unclassified_category ?? 0}
            countsBySlag={Object.fromEntries(
              categories.map((c) => [c.slug, categoryCounts.get(c.slug) ?? 0]),
            )}
            totalCount={allCategoriesCount}
            selectedSlugs={selectedCategories}
            onChange={setSelectedCategories}
          />
        </aside>

        <div className='space-y-4'>
          <div className='sticky top-0 z-10 rounded-md border bg-background/90 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
            <div className='flex flex-wrap items-center gap-1.5'>
              <div className='relative'>
                <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder='Search…'
                  className='h-8 w-44 pl-8 text-xs'
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
              <select
                className='h-8 rounded-md border border-input bg-background px-2 text-xs'
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOption)}
              >
                <option value='updated_desc'>Newest</option>
                <option value='updated_asc'>Oldest</option>
                <option value='title_asc'>Name A–Z</option>
                <option value='title_desc'>Name Z–A</option>
              </select>
              <Button variant='outline' size='icon' className='h-8 w-8 shrink-0' onClick={() => void load()} aria-label='Refresh'>
                <RefreshCw className='h-3.5 w-3.5' />
              </Button>

              <div className='ml-auto flex items-center gap-2'>
                {hasActiveFilters && (
                  <Button variant='ghost' size='sm' className='h-8 px-2 text-xs' onClick={clearFilters}>
                    <X className='mr-1 h-3 w-3' />
                    Clear
                  </Button>
                )}
                {/* Select preset: checkbox toggles current page; chevron opens options */}
                <div className='flex items-center'>
                  <label className='flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer pr-0.5'>
                    <input
                      type='checkbox'
                      className='h-3.5 w-3.5 rounded border-input'
                      checked={selectAllMode || allVisibleSelected}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      aria-label='Select all questions on page'
                    />
                    Select
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className='flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
                        aria-label='Selection options'
                      >
                        <svg className='h-3 w-3' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'><polyline points='6 9 12 15 18 9'/></svg>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-48 text-xs'>
                      <DropdownMenuItem
                        className='text-xs'
                        onSelect={() => {
                          setSelectAllMode(false);
                          setSelectedQuestionIds(visibleQuestionIds);
                        }}
                      >
                        This page ({visibleQuestionIds.length})
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className='text-xs'
                        onSelect={() => {
                          setSelectAllMode(true);
                          setSelectedQuestionIds(visibleQuestionIds);
                        }}
                      >
                        All matching ({total})
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className='text-xs text-muted-foreground'
                        onSelect={() => {
                          setSelectAllMode(false);
                          setSelectedQuestionIds([]);
                        }}
                      >
                        Deselect all
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <span className='whitespace-nowrap text-xs font-medium text-muted-foreground'>{resultsLabel}</span>
                <span
                  className={cn(
                    'whitespace-nowrap text-xs text-muted-foreground tabular-nums',
                    selectedCount === 0 && !selectAllMode && 'invisible',
                  )}
                >
                  {selectAllMode ? `${total} selected (all matching)` : `${selectedCount} selected`}
                </span>
              </div>

                <Button
                  size='sm'
                  variant='outline'
                  className={cn(
                    'h-8 text-xs',
                    selectedCount === 0 && !selectAllMode && !publishing && 'invisible pointer-events-none',
                    publishedCount !== null && 'border-green-500 text-green-600',
                  )}
                  tabIndex={selectedCount === 0 && !selectAllMode && !publishing ? -1 : 0}
                  aria-hidden={selectedCount === 0 && !selectAllMode && !publishing}
                  disabled={publishing}
                  onClick={() => void publishQuestions(selectedQuestionIds)}
                >
                  {publishing ? (
                    <>
                      <svg className='mr-2 h-3.5 w-3.5 animate-spin' viewBox='0 0 24 24' fill='none'>
                        <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
                        <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v8H4z' />
                      </svg>
                      Publishing…
                    </>
                  ) : publishedCount !== null ? (
                    <>
                      <svg className='mr-1.5 h-3.5 w-3.5 text-green-500' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
                        <polyline points='20 6 9 17 4 12' />
                      </svg>
                      {publishedCount} published
                    </>
                  ) : (
                    'Publish'
                  )}
                </Button>

                <Button
                  size='sm'
                  variant='outline'
                  className={cn('h-8 text-xs', selectedCount === 0 && !selectAllMode && 'invisible pointer-events-none')}
                  tabIndex={selectedCount === 0 && !selectAllMode ? -1 : 0}
                  aria-hidden={selectedCount === 0 && !selectAllMode}
                  onClick={() =>
                    setArchiveTarget({
                      ids: selectedQuestionIds,
                      label: selectAllMode ? `${total} matching question${total === 1 ? '' : 's'}` : `${selectedCount} question${selectedCount === 1 ? '' : 's'}`,
                    })
                  }
                >
                  Archive
                </Button>

                <Button
                  size='sm'
                  variant='outline'
                  className={cn('h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40', selectedCount === 0 && !selectAllMode && 'invisible pointer-events-none')}
                  tabIndex={selectedCount === 0 && !selectAllMode ? -1 : 0}
                  aria-hidden={selectedCount === 0 && !selectAllMode}
                  onClick={() =>
                    setDeleteTarget({
                      ids: selectedQuestionIds,
                      label: selectAllMode ? `${total} matching question${total === 1 ? '' : 's'}` : `${selectedCount} question${selectedCount === 1 ? '' : 's'}`,
                    })
                  }
                >
                  Delete
                </Button>

                {isRefreshing && <span className='text-xs text-muted-foreground'>Updating…</span>}
                <select
                  className='h-8 rounded-md border border-input bg-background px-1.5 text-xs'
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value || 24)); setPage(1); }}
                >
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                  <option value={48}>48</option>
                  <option value={100}>100</option>
                  <option value={9999}>All</option>
                </select>
                <div className='flex h-8 items-center gap-0.5 rounded-md border p-0.5'>
                  <Button
                    type='button'
                    size='sm'
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('grid')}
                    aria-label='Grid view'
                    className='h-7 px-1.5'
                  >
                    <LayoutGrid className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('list')}
                    aria-label='List view'
                    className='h-7 px-1.5'
                  >
                    <List className='h-3.5 w-3.5' />
                  </Button>
                </div>
            </div>

            {hasActiveFilters && (
              <div className='mt-1.5 flex flex-wrap items-center gap-1 border-t pt-1.5'>
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
              <div className='divide-y rounded-md border'>
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
                      <div className='flex items-start gap-2'>
                        <input
                          type='checkbox'
                          className='mt-1 h-4 w-4 rounded border-input'
                          checked={selectedQuestionIds.includes(question.id)}
                          onChange={() => toggleSelect(question.id)}
                          aria-label='Select question'
                        />
                        <CardTitle className='text-base font-semibold leading-snug line-clamp-2'>
                          {question.prompt}
                        </CardTitle>
                      </div>
                      <QuestionActionsMenu
                        onEdit={() => {
                          setEditing(question);
                          setEditorOpen(true);
                        }}
                        onPreview={() => setPreviewQuestion(question)}
                        onDuplicate={() => void duplicateQuestion(question)}
                        onPublish={() => void publishQuestions([question.id])}
                        onArchive={() => setArchiveTarget({ ids: [question.id], label: 'this question' })}
                        onSetCategory={() => { setClassifyingQuestion(question); setCategoryPickerSearch(''); }}
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
            <div className='divide-y rounded-md border'>
              {sortedQuestions.map((question) => (
                <div
                  key={question.id}
                  className='flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/40'
                >
                  <input
                    type='checkbox'
                    className='h-3.5 w-3.5 shrink-0 rounded border-input'
                    checked={selectedQuestionIds.includes(question.id)}
                    onChange={() => toggleSelect(question.id)}
                    aria-label='Select question'
                  />
                  <p className='min-w-0 flex-1 truncate text-sm font-medium' title={question.prompt}>
                    {question.prompt.length > 90 ? `${question.prompt.slice(0, 90)}…` : question.prompt}
                  </p>
                  <div className='flex shrink-0 items-center gap-1'>
                    <Badge variant='secondary' className='text-[10px] font-medium'>
                      {formatQuestionType(question.question_type)}
                    </Badge>
                    <Badge variant='outline' className='text-[10px] capitalize'>
                      {question.status}
                    </Badge>
                    <Badge variant='outline' className='text-[10px] capitalize'>
                      {question.difficulty ?? 'unspecified'}
                    </Badge>
                    <Badge variant='outline' className='hidden text-[10px] xl:inline-flex'>
                      {question.category?.name ?? 'Unclassified'}
                    </Badge>
                  </div>
                  <span className='hidden shrink-0 whitespace-nowrap text-right text-[11px] text-muted-foreground lg:block'>
                    {formatRelativeDate(question.updated_at)}
                  </span>
                  <QuestionActionsMenu
                    onEdit={() => {
                      setEditing(question);
                      setEditorOpen(true);
                    }}
                    onPreview={() => setPreviewQuestion(question)}
                    onDuplicate={() => void duplicateQuestion(question)}
                    onPublish={() => void publishQuestions([question.id])}
                    onArchive={() => setArchiveTarget({ ids: [question.id], label: 'this question' })}
                    onSetCategory={() => { setClassifyingQuestion(question); setCategoryPickerSearch(''); }}
                  />
                </div>
              ))}
            </div>
          )}

          <div className='flex flex-wrap items-center justify-between gap-3 pt-2'>
            <p className='text-xs text-muted-foreground'>
              {pageSize >= 9999
                ? `Showing all ${total}`
                : `Showing ${fromRow}–${toRow} of ${total}`}
            </p>
            {pageSize < 9999 && (
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
            )}
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
        open={!!previewQuestion}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewQuestion(null);
          }
        }}
      >
        <SheetContent side='right' className='w-full sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle className='text-lg font-semibold'>Question preview</SheetTitle>
            <p className='text-sm text-muted-foreground'>Read-only view of the selected question.</p>
          </SheetHeader>
          {previewQuestion && (
            <div className='mt-4 space-y-4'>
              <div className='space-y-2'>
                <p className='text-sm font-medium'>Prompt</p>
                <p className='whitespace-pre-wrap text-sm text-muted-foreground'>{previewQuestion.prompt}</p>
              </div>

              <QuestionMetaBadges question={previewQuestion} />

              <div className='space-y-2'>
                <p className='text-sm font-medium'>Options</p>
                <ul className='space-y-2 text-sm'>
                  {previewQuestion.options.map((option, idx) => (
                    <li key={option.id} className='flex items-start gap-2'>
                      <span
                        className={cn(
                          'mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                          option.is_correct
                            ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-900'
                            : 'text-muted-foreground',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className={option.is_correct ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {option.option_text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {previewQuestion.explanation && (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>Explanation</p>
                  <p className='whitespace-pre-wrap text-sm text-muted-foreground'>{previewQuestion.explanation}</p>
                </div>
              )}

              {previewQuestion.tags.length > 0 && (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>Tags</p>
                  <div className='flex flex-wrap gap-1'>
                    {previewQuestion.tags.map((tag) => (
                      <Badge key={tag} variant='secondary' className='text-[10px]'>
                        {tagLabel(tag)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

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
                  <option value='selected' disabled={selectedCount === 0}>
                    Selected questions ({selectedCount || 0})
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
        open={textImportOpen}
        onOpenChange={(open) => {
          setTextImportOpen(open);
          if (!open) {
            // If import is running, keep polling in the background – don't reset state.
            // The resume-on-refresh effect will reopen the sheet if needed.
            if (!textImporting) {
              if (textImportPollRef.current) { clearInterval(textImportPollRef.current); textImportPollRef.current = null; }
              setTextImportError(null);
              setTextImportResult(null);
              setTextImportText('');
              setTextImportCount(20);
              setTextImportTags('');
              setTextImportDifficulty('');
              setTextImportCategory('');
              setTextImportProgress(0);
              setTextImportPhase('');
              setTextImportJobId(null);
              setTextImportCancelling(false);
              resetAiInstructions();
            }
          }
        }}
      >
        <SheetContent className='flex flex-col h-full p-0'>
          <SheetHeader className='flex-none px-4 pt-4 pb-3 border-b'>
            <SheetTitle className='text-base font-semibold'>Import questions from text</SheetTitle>
            <p className='text-xs text-muted-foreground'>
              Paste plain text or Markdown — AI generates questions imported as <span className='font-medium'>draft</span>.
            </p>
          </SheetHeader>

          <div className='flex-1 overflow-y-auto px-4 py-3 space-y-3'>
            {/* Text area */}
            <div className='space-y-1'>
              <Label htmlFor='import-text-content' className='text-xs'>Text or Markdown</Label>
              <textarea
                id='import-text-content'
                className='min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y'
                placeholder={'Paste content here — notes, Markdown, course material…\nMinimum 50 characters.'}
                value={textImportText}
                onChange={(e) => setTextImportText(e.target.value)}
              />
              {textImportText.length > 0 && (
                <p className='text-[11px] text-muted-foreground'>{textImportText.length.toLocaleString()} characters</p>
              )}
            </div>

            {/* Settings row: count + difficulty */}
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <Label htmlFor='text-import-count' className={`text-xs ${importAutoCount ? 'text-muted-foreground/50' : ''}`}>
                  Questions{importAutoCount && <span className='ml-1 text-[10px] font-normal'>(AI decides)</span>}
                </Label>
                <input
                  id='text-import-count'
                  type='number'
                  min={1}
                  max={100}
                  disabled={importAutoCount}
                  className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40'
                  value={textImportCount}
                  onChange={(e) => setTextImportCount(Number(e.target.value || 20))}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='text-import-difficulty' className='text-xs'>Difficulty</Label>
                <select
                  id='text-import-difficulty'
                  className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={textImportDifficulty}
                  onChange={(e) => setTextImportDifficulty(e.target.value)}
                >
                  <option value=''>Mixed</option>
                  <option value='easy'>Easy</option>
                  <option value='medium'>Medium</option>
                  <option value='hard'>Hard</option>
                </select>
              </div>
            </div>

            {/* Tags + Category */}
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <Label htmlFor='text-import-tags' className='text-xs'>Tags</Label>
                <input
                  id='text-import-tags'
                  type='text'
                  className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  placeholder='security, sdlc'
                  value={textImportTags}
                  onChange={(e) => setTextImportTags(e.target.value)}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='text-import-category' className='text-xs'>Category</Label>
                <input
                  id='text-import-category'
                  type='text'
                  list='text-import-category-list'
                  className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  placeholder='e.g. School/History/8th Grade'
                  value={textImportCategory}
                  onChange={(e) => setTextImportCategory(e.target.value)}
                />
                <p className='text-[10px] text-muted-foreground'>Use / to create sub-levels, e.g. School/History/8th Grade</p>
                <datalist id='text-import-category-list'>
                  {(() => {
                    const buildPath = (id: string): string => {
                      const cat = categories.find((c) => c.id === id);
                      if (!cat) return '';
                      return cat.parent_id ? `${buildPath(cat.parent_id)}/${cat.name}` : cat.name;
                    };
                    return categories.map((c) => (
                      <option key={c.id} value={buildPath(c.id)} />
                    ));
                  })()}
                </datalist>
              </div>
            </div>

            {/* AI Instructions */}
            <AiInstructionsPanel
              template={importAiTemplate}
              onTemplateChange={setImportAiTemplate}
              materialContext={importMaterialContext}
              onMaterialContextChange={setImportMaterialContext}
              extraInstructions={importExtraInstructions}
              onExtraInstructionsChange={setImportExtraInstructions}
              autoCount={importAutoCount}
              onAutoCountChange={setImportAutoCount}
              userTemplates={aiUserTemplates}
            />

            {/* Progress */}
            {textImporting && (
              <div className='space-y-1.5 rounded-lg border bg-muted/20 p-3'>
                <div className='flex items-center justify-between text-xs'>
                  <span className='text-muted-foreground'>{textImportPhase}</span>
                  <span className='tabular-nums font-medium'>{Math.round(textImportProgress)}%</span>
                </div>
                <Progress value={textImportProgress} className='h-1.5' />
                <div className='flex items-center justify-between'>
                  <p className='text-[11px] text-muted-foreground'>May take up to a minute.</p>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-[11px] text-destructive hover:text-destructive'
                    disabled={textImportCancelling}
                    onClick={async () => {
                      if (!accessToken || !textImportJobId) return;
                      setTextImportCancelling(true);
                      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
                      try {
                        await fetch(`${apiBase}/assessments/questions/import-jobs/${textImportJobId}/cancel`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${accessToken}` },
                        });
                        setTextImportPhase('Cancellation requested…');
                      } catch {
                        setTextImportCancelling(false);
                      }
                    }}
                  >
                    {textImportCancelling ? 'Stopping…' : 'Stop'}
                  </Button>
                </div>
              </div>
            )}

            {textImportError && <p className='text-sm text-destructive'>{textImportError}</p>}
            {textImportResult && (
              <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm'>
                <p className='font-semibold text-emerald-800'>
                  ✓ Imported {textImportResult.imported_count} question{textImportResult.imported_count !== 1 ? 's' : ''}
                </p>
                {textImportResult.warnings && textImportResult.warnings.length > 0 && (
                  <div className='mt-1.5 space-y-0.5 text-xs text-emerald-700'>
                    {textImportResult.warnings.slice(0, 6).map((w, idx) => (
                      <p key={idx}>· {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className='flex-none border-t px-4 py-3 bg-muted/30'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setTextImportOpen(false)}
            >
              {textImporting ? 'Close (runs in background)' : 'Close'}
            </Button>
            <Button
              type='button'
              size='sm'
              disabled={!accessToken || textImporting || textImportText.trim().length < 50}
              onClick={async () => {
                if (!accessToken) return;

                setTextImporting(true);
                setTextImportError(null);
                setTextImportResult(null);
                setTextImportProgress(0);
                setTextImportPhase('Starting…');

                const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

                try {
                  // 1. Start the background job (returns immediately with job_id)
                  const startResp = await fetch(`${apiBase}/assessments/questions/import-text`, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      text: textImportText.trim(),
                      question_count: textImportCount,
                      tags: textImportTags,
                      difficulty: textImportDifficulty || null,
                      category_path: textImportCategory.trim() || null,
                      extra_instructions: importExtraInstructions.trim() || null,
                      material_context: importMaterialContext.trim() || null,
                      auto_question_count: importAutoCount,
                    }),
                  });

                  if (!startResp.ok) {
                    const errText = await startResp.text();
                    throw new Error(errText || `Import failed (${startResp.status})`);
                  }

                  const { job_id } = (await startResp.json()) as { job_id: string; total_chunks: number };

                  // Persist so polling can resume after a page refresh
                  setTextImportJobId(job_id);
                  localStorage.setItem(IMPORT_JOB_KEY, job_id);

                  // 2. Poll job status every 2 s
                  startPolling(job_id, accessToken, apiBase);
                } catch (err) {
                  if (textImportPollRef.current) { clearInterval(textImportPollRef.current); textImportPollRef.current = null; }
                  setTextImportProgress(0);
                  setTextImportPhase('');
                  setTextImportError(err instanceof Error ? err.message : 'Failed to import text');
                  setTextImporting(false);
                }
              }}
            >
              {textImporting ? 'Importing…' : 'Import'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        title='Archive questions?'
        description={`This will move ${archiveTarget?.label ?? 'the selected questions'} to archived status.`}
        confirmText={archiving ? 'Archiving…' : 'Archive'}
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        onConfirm={() => {
          if (!archiveTarget) return;
          const ids = archiveTarget.ids;
          setArchiveTarget(null);
          void archiveQuestions(ids);
        }}
      />

      <ConfirmDialog
        title='Permanently delete questions?'
        description={`This will permanently delete ${deleteTarget?.label ?? 'the selected questions'}. This action cannot be undone.`}
        confirmText={deleting ? 'Deleting…' : 'Delete permanently'}
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const ids = deleteTarget.ids;
          setDeleteTarget(null);
          void deleteQuestions(ids);
        }}
      />

      <ConfirmDialog
        title='Remove duplicate questions?'
        description={
          dedupePreview
            ? dedupePreview.archived_count === 0
              ? 'No duplicate questions found — your question bank is already clean.'
              : `Found ${dedupePreview.duplicate_groups} duplicate group${dedupePreview.duplicate_groups !== 1 ? 's' : ''}. This will archive ${dedupePreview.archived_count} duplicate question${dedupePreview.archived_count !== 1 ? 's' : ''}, keeping the best copy of each. Archived questions are not deleted and can be reviewed later.`
            : ''
        }
        confirmText={dedupePreview?.archived_count === 0 ? 'OK' : dedupeRunning ? 'Archiving…' : 'Archive duplicates'}
        open={!!dedupePreview}
        onOpenChange={(open) => { if (!open) { setDedupePreview(null); setDedupeError(null); } }}
        onConfirm={async () => {
          if (!accessToken || !dedupePreview) return;
          if (dedupePreview.archived_count === 0) { setDedupePreview(null); return; }
          setDedupeRunning(true);
          try {
            await api.post('/assessments/questions/deduplicate?dry_run=false', {}, accessToken);
            setDedupePreview(null);
            await load();
          } catch (err) {
            setDedupeError(err instanceof Error ? err.message : 'Failed to remove duplicates');
            setDedupePreview(null);
          } finally {
            setDedupeRunning(false);
          }
        }}
      />

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
            setImportCategory('');
            setImportMaxPages('');
            resetAiInstructions();
          }
        }}
      >
        <SheetContent className='flex flex-col h-full p-0'>
          <SheetHeader className='flex-none px-4 pt-4 pb-3 border-b'>
            <SheetTitle className='text-base font-semibold'>Import questions from PDF</SheetTitle>
            <p className='text-xs text-muted-foreground'>
              Upload a text-based PDF — AI generates questions imported as <span className='font-medium'>draft</span>.
            </p>
          </SheetHeader>

          <div className='flex-1 overflow-y-auto px-4 py-3 space-y-3'>
            {/* File picker */}
            <div className='space-y-1'>
              <Label htmlFor='pdf' className='text-xs'>PDF file</Label>
              <Input
                id='pdf'
                type='file'
                accept='application/pdf'
                className='h-8 text-sm file:mr-2 file:h-full file:border-0 file:bg-transparent file:text-xs file:font-medium'
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
            </div>

            {/* Questions + Difficulty + Tags + Max pages in compact grid */}
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <Label htmlFor='count' className={`text-xs ${importAutoCount ? 'text-muted-foreground/50' : ''}`}>
                  Questions{importAutoCount && <span className='ml-1 text-[10px] font-normal'>(AI decides)</span>}
                </Label>
                <Input
                  id='count'
                  type='number'
                  min={1}
                  max={100}
                  disabled={importAutoCount}
                  className='h-8 text-sm disabled:cursor-not-allowed disabled:opacity-40'
                  value={importCount}
                  onChange={(event) => setImportCount(Number(event.target.value || 20))}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='difficulty' className='text-xs'>Difficulty</Label>
                <select
                  id='difficulty'
                  className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={importDifficulty}
                  onChange={(event) => setImportDifficulty(event.target.value)}
                >
                  <option value=''>Mixed</option>
                  <option value='easy'>Easy</option>
                  <option value='medium'>Medium</option>
                  <option value='hard'>Hard</option>
                </select>
              </div>
              <div className='space-y-1'>
                <Label htmlFor='tags' className='text-xs'>Tags</Label>
                <Input
                  id='tags'
                  className='h-8 text-sm'
                  value={importTags}
                  onChange={(event) => setImportTags(event.target.value)}
                  placeholder='security, sdlc'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='max_pages' className='text-xs'>Max pages</Label>
                <Input
                  id='max_pages'
                  type='number'
                  min={1}
                  max={500}
                  className='h-8 text-sm'
                  value={importMaxPages}
                  onChange={(event) => {
                    const v = event.target.value;
                    setImportMaxPages(v ? Number(v) : '');
                  }}
                  placeholder='all'
                />
              </div>
            </div>

            {/* Category (full width) */}
            <div className='space-y-1'>
              <Label htmlFor='pdf-import-category' className='text-xs'>Category</Label>
              <input
                id='pdf-import-category'
                type='text'
                list='pdf-import-category-list'
                className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                placeholder='e.g. School/History/8th Grade'
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
              />
              <p className='text-[10px] text-muted-foreground'>Use / to create sub-levels, e.g. School/History/8th Grade</p>
              <datalist id='pdf-import-category-list'>
                {(() => {
                  const buildPath = (id: string): string => {
                    const cat = categories.find((c) => c.id === id);
                    if (!cat) return '';
                    return cat.parent_id ? `${buildPath(cat.parent_id)}/${cat.name}` : cat.name;
                  };
                  return categories.map((c) => (
                    <option key={c.id} value={buildPath(c.id)} />
                  ));
                })()}
              </datalist>
            </div>

            {/* AI Instructions */}
            <AiInstructionsPanel
              template={importAiTemplate}
              onTemplateChange={setImportAiTemplate}
              materialContext={importMaterialContext}
              onMaterialContextChange={setImportMaterialContext}
              extraInstructions={importExtraInstructions}
              onExtraInstructionsChange={setImportExtraInstructions}
              autoCount={importAutoCount}
              onAutoCountChange={setImportAutoCount}
              userTemplates={aiUserTemplates}
            />

            {importError && <p className='text-sm text-destructive'>{importError}</p>}
            {importResult && (
              <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm'>
                <p className='font-semibold text-emerald-800'>✓ Imported {importResult.imported_count} questions</p>
                {importResult.warnings && importResult.warnings.length > 0 && (
                  <div className='mt-1.5 space-y-0.5 text-xs text-emerald-700'>
                    {importResult.warnings.slice(0, 6).map((w, idx) => (
                      <p key={idx}>· {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className='flex-none border-t px-4 py-3 bg-muted/30'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setImportOpen(false)}
              disabled={importing}
            >
              Close
            </Button>
            <Button
              type='button'
              size='sm'
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
                  if (importCategory.trim()) {
                    formData.append('category_path', importCategory.trim());
                  }
                  if (importMaxPages !== '') {
                    formData.append('max_pages', String(importMaxPages));
                  }
                  if (importExtraInstructions.trim()) {
                    formData.append('extra_instructions', importExtraInstructions.trim());
                  }
                  if (importMaterialContext.trim()) {
                    formData.append('material_context', importMaterialContext.trim());
                  }
                  formData.append('auto_question_count', String(importAutoCount));

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

      {/* Category picker for manual classification */}
      <Sheet
        open={!!classifyingQuestion}
        onOpenChange={(open) => { if (!open) { setClassifyingQuestion(null); setCategoryPickerSearch(''); } }}
      >
        <SheetContent className='flex flex-col h-full p-0'>
          <SheetHeader className='flex-none px-4 pt-4 pb-3 border-b'>
            <SheetTitle className='text-base font-semibold'>Set category</SheetTitle>
            <p className='text-xs text-muted-foreground truncate'>
              {classifyingQuestion?.prompt.slice(0, 80)}{(classifyingQuestion?.prompt.length ?? 0) > 80 ? '…' : ''}
            </p>
          </SheetHeader>
          <div className='flex-none px-3 pt-3'>
            <div className='relative'>
              <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
              <input
                type='text'
                className='h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                placeholder='Search categories…'
                value={categoryPickerSearch}
                onChange={(e) => setCategoryPickerSearch(e.target.value)}
              />
            </div>
          </div>
          <div className='flex-1 overflow-y-auto px-3 py-2 space-y-0.5'>
            {/* Unclassified option */}
            {(!categoryPickerSearch || 'unclassified'.includes(categoryPickerSearch.toLowerCase())) && (
              <button
                type='button'
                disabled={classifyingSaving}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-2 text-sm text-left transition-colors hover:bg-muted',
                  classifyingQuestion?.category_id == null && 'bg-primary/10 font-medium text-primary',
                )}
                onClick={() => classifyingQuestion && void classifyQuestion(classifyingQuestion.id, null)}
              >
                <span className='text-muted-foreground italic'>Unclassified</span>
              </button>
            )}
            {categories
              .filter((cat) => {
                if (!categoryPickerSearch) return true;
                const path = categoryPathMap.get(cat.id) ?? cat.name;
                return path.toLowerCase().includes(categoryPickerSearch.toLowerCase());
              })
              .sort((a, b) => {
                const pa = categoryPathMap.get(a.id) ?? a.name;
                const pb = categoryPathMap.get(b.id) ?? b.name;
                return pa.localeCompare(pb);
              })
              .map((cat) => {
                const fullPath = categoryPathMap.get(cat.id) ?? cat.name;
                const isSelected = classifyingQuestion?.category_id === cat.id;
                return (
                  <button
                    key={cat.id}
                    type='button'
                    disabled={classifyingSaving}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-left transition-colors hover:bg-muted',
                      isSelected && 'bg-primary/10 font-medium text-primary',
                    )}
                    onClick={() => classifyingQuestion && void classifyQuestion(classifyingQuestion.id, cat.id)}
                  >
                    <span className='truncate'>{fullPath}</span>
                    {isSelected && <Check className='ml-2 h-3.5 w-3.5 shrink-0 text-primary' />}
                  </button>
                );
              })}
          </div>
          <div className='flex-none border-t px-4 py-3'>
            <Button variant='ghost' size='sm' className='h-8 text-xs' onClick={() => setClassifyingQuestion(null)}>
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
