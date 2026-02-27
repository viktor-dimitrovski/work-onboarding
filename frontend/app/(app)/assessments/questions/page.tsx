'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { QuestionEditorSheet } from '@/components/assessments/question-editor-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentCategory, AssessmentClassificationJob, AssessmentQuestion } from '@/lib/types';
import { LayoutGrid, List, Sparkles, X } from 'lucide-react';

interface QuestionListResponse {
  items: AssessmentQuestion[];
  meta: { page: number; page_size: number; total: number };
}

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm'>
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

export default function AssessmentQuestionsPage() {
  const { accessToken } = useAuth();
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [categories, setCategories] = useState<AssessmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
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
      const params = new URLSearchParams({ page: '1', page_size: '100' });
      if (query.trim()) params.set('q', query.trim());
      if (selectedStatuses.length) params.set('status', selectedStatuses.join(','));
      if (selectedDifficulties.length) params.set('difficulty', selectedDifficulties.join(','));
      if (selectedTags.length) params.set('tag', selectedTags.join(','));
      if (selectedCategories.length) params.set('category', selectedCategories.join(','));
      const response = await api.get<QuestionListResponse>(`/assessments/questions?${params.toString()}`, accessToken);
      setQuestions(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCategories();
  }, [accessToken]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(handle);
  }, [accessToken, query, selectedStatuses, selectedDifficulties, selectedTags, selectedCategories]);

  useEffect(() => {
    if (!accessToken || !classifyJob) return;
    if (!['queued', 'running'].includes(classifyJob.status)) return;
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

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    questions.forEach((question) => question.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of questions) {
      const slug = question.category?.slug ?? 'unclassified';
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }, [questions]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of questions) {
      const status = question.status || 'draft';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }, [questions]);

  const difficultyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of questions) {
      const difficulty = question.difficulty || 'unspecified';
      counts.set(difficulty, (counts.get(difficulty) ?? 0) + 1);
    }
    return counts;
  }, [questions]);

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

  const categoryOptions: FilterOption[] = [
    { value: 'unclassified', label: 'Unclassified', count: categoryCounts.get('unclassified') ?? 0 },
    ...categories.map((category) => ({
      value: category.slug,
      label: category.name,
      count: categoryCounts.get(category.slug) ?? 0,
    })),
  ];

  const tagOptions: FilterOption[] = availableTags.map((tag) => ({ value: tag, label: tag }));

  const hasActiveFilters =
    query.trim() ||
    selectedStatuses.length ||
    selectedDifficulties.length ||
    selectedCategories.length ||
    selectedTags.length;

  const classifyReport = (classifyJob?.report_json as Record<string, unknown> | undefined) ?? undefined;
  const classifyUpdated = Number(classifyReport?.updated ?? 0);
  const classifyCreatedCategories = Number(classifyReport?.created_categories ?? 0);
  const classifyProgress =
    classifyJob && classifyJob.total > 0
      ? Math.round((classifyJob.processed / classifyJob.total) * 100)
      : 0;

  if (loading) return <LoadingState label='Loading questions...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Question Bank</h2>
          <p className='text-sm text-muted-foreground'>Maintain reusable questions for assessments.</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='outline' onClick={() => setClassifyOpen(true)}>
            <Sparkles className='mr-2 h-4 w-4' />
            Smart classify
          </Button>
          <Button variant='outline' onClick={() => setImportOpen(true)}>
            Import PDF
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

      <div className='grid gap-6 lg:grid-cols-[240px,1fr]'>
        <Card className='h-fit'>
          <CardHeader>
            <CardTitle className='text-base'>Categories</CardTitle>
            <CardDescription>Group questions by topic.</CardDescription>
          </CardHeader>
          <CardContent className='space-y-1'>
            <Button
              type='button'
              variant={selectedCategories.length === 0 ? 'secondary' : 'ghost'}
              className='w-full justify-between'
              onClick={() => setSelectedCategories([])}
            >
              <span>All categories</span>
              <span className='text-xs text-muted-foreground'>
                {questions.length}
              </span>
            </Button>
            {categoryOptions.map((category) => (
              <Button
                key={category.value}
                type='button'
                variant={selectedCategories.includes(category.value) ? 'secondary' : 'ghost'}
                className='w-full justify-between'
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
          </CardContent>
        </Card>

        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search prompt...'
              className='max-w-sm'
            />
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
                label='Categories'
                options={categoryOptions}
                selected={selectedCategories}
                onChange={setSelectedCategories}
              />
            </div>
            <FilterMenu label='Tags' options={tagOptions} selected={selectedTags} onChange={setSelectedTags} />
            <Button variant='outline' onClick={() => void load()}>
              Refresh
            </Button>
            <div className='ml-auto flex items-center gap-1 rounded-md border p-1'>
              <Button
                type='button'
                size='sm'
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className='h-4 w-4' />
              </Button>
              <Button
                type='button'
                size='sm'
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('list')}
              >
                <List className='h-4 w-4' />
              </Button>
            </div>
          </div>

          {hasActiveFilters && (
            <div className='flex flex-wrap items-center gap-2'>
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
                <Badge key={`status-${value}`} variant='secondary' className='flex items-center gap-1'>
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
                <Badge key={`difficulty-${value}`} variant='secondary' className='flex items-center gap-1'>
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
                  Tag: {value}
                  <button
                    type='button'
                    className='rounded p-0.5 hover:bg-muted'
                    onClick={() => setSelectedTags((prev) => prev.filter((item) => item !== value))}
                  >
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              ))}
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => {
                  setQuery('');
                  setSelectedStatuses([]);
                  setSelectedDifficulties([]);
                  setSelectedCategories([]);
                  setSelectedTags([]);
                }}
              >
                Clear all
              </Button>
            </div>
          )}

          {questions.length === 0 ? (
            <EmptyState title='No questions found' description='Add your first assessment question.' />
          ) : viewMode === 'grid' ? (
            <div className='grid gap-4 md:grid-cols-2'>
              {questions.map((question) => (
                <Card key={question.id} className='hover:border-primary/40'>
                  <CardHeader>
                    <CardTitle className='text-base'>{question.prompt}</CardTitle>
                    <CardDescription className='flex flex-wrap gap-2'>
                      <Badge variant='secondary'>{question.question_type.replace('_', ' ')}</Badge>
                      <Badge variant='outline'>{question.status}</Badge>
                      {question.difficulty && <Badge variant='outline'>{question.difficulty}</Badge>}
                      <Badge variant='outline'>
                        {question.category?.name ?? 'Unclassified'}
                      </Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className='text-xs text-muted-foreground'>{question.options.length} options</p>
                    {question.tags.length > 0 && (
                      <div className='mt-2 flex flex-wrap gap-2'>
                        {question.tags.map((tag) => (
                          <Badge key={tag} variant='outline'>
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className='mt-3 flex gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          setEditing(question);
                          setEditorOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className='overflow-hidden'>
              <CardContent className='p-0'>
                <div className='divide-y'>
                  {questions.map((question) => (
                    <div key={question.id} className='px-4 py-3'>
                      <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <p className='font-medium'>{question.prompt}</p>
                          <div className='mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                            <Badge variant='secondary'>{question.question_type.replace('_', ' ')}</Badge>
                            <Badge variant='outline'>{question.status}</Badge>
                            {question.difficulty && <Badge variant='outline'>{question.difficulty}</Badge>}
                            <Badge variant='outline'>
                              {question.category?.name ?? 'Unclassified'}
                            </Badge>
                            <span>{question.options.length} options</span>
                          </div>
                        </div>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            setEditing(question);
                            setEditorOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                      {question.tags.length > 0 && (
                        <div className='mt-3 flex flex-wrap gap-2'>
                          {question.tags.map((tag) => (
                            <Badge key={tag} variant='outline'>
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
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
            setClassifyJob(null);
            setClassifyMode('unclassified_only');
            setClassifyDryRun(false);
            setClassifyBatchSize(25);
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
                <span className='font-medium'>{categoryCounts.get('unclassified') ?? 0}</span>
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
