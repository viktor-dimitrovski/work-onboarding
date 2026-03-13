'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BuilderShell } from '@/components/layout/builder-shell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentQuestion, AssessmentTest, AssessmentTestVersion } from '@/lib/types';
import { ArrowDown, ArrowUp, CheckSquare, Search, Square, Trash2 } from 'lucide-react';

interface QuestionListResponse {
  items: AssessmentQuestion[];
  meta: { page: number; page_size: number; total: number };
}

type ValidationIssue = {
  id: string;
  title: string;
  description: string;
  severity: 'warning' | 'error';
};

type VersionQuestion = {
  question_id: string;
  order_index: number;
  points: number;
  prompt: string;
};

export default function AssessmentTestBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [test, setTest] = useState<AssessmentTest | null>(null);
  const [version, setVersion] = useState<AssessmentTestVersion | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [roleTarget, setRoleTarget] = useState('');
  const [passingScore, setPassingScore] = useState(80);
  const [timeLimit, setTimeLimit] = useState<number | ''>('');
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [attemptsAllowed, setAttemptsAllowed] = useState<number | ''>('');
  const [versionQuestions, setVersionQuestions] = useState<VersionQuestion[]>([]);

  const [bankQuery, setBankQuery] = useState('');
  const [bankDifficulty, setBankDifficulty] = useState('');
  const [bankCategory, setBankCategory] = useState('');
  const [bankChecked, setBankChecked] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const testResponse = await api.get<AssessmentTest>(`/assessments/tests/${id}`, accessToken);
      setTest(testResponse);
      setTitle(testResponse.title);
      setDescription(testResponse.description || '');
      setCategory(testResponse.category || '');
      setRoleTarget(testResponse.role_target || '');

      let draft = testResponse.versions.find((item) => item.status === 'draft') || null;
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
          .filter((item) => Boolean(item.question_id))
          .map((item, idx) => ({
            question_id: item.question_id as string,
            order_index: idx,
            points: item.points || 1,
            prompt: (item.question_snapshot?.prompt as string) || 'Untitled',
          })),
      );

      const allQuestions: AssessmentQuestion[] = [];
      let page = 1;
      while (true) {
        const questionResponse = await api.get<QuestionListResponse>(
          `/assessments/questions?page=${page}&page_size=100&status=published`,
          accessToken,
        );
        allQuestions.push(...questionResponse.items);
        if (allQuestions.length >= questionResponse.meta.total || questionResponse.items.length === 0) break;
        page += 1;
      }
      setQuestions(allQuestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, id]);

  const selectedIds = useMemo(() => new Set(versionQuestions.map((q) => q.question_id)), [versionQuestions]);

  const availableQuestions = useMemo(() => {
    return questions.filter((q) => !selectedIds.has(q.id));
  }, [questions, selectedIds]);

  const filteredBank = useMemo(() => {
    let filtered = availableQuestions;
    const q = bankQuery.trim().toLowerCase();
    if (q) filtered = filtered.filter((item) => item.prompt.toLowerCase().includes(q));
    if (bankDifficulty) filtered = filtered.filter((item) => item.difficulty === bankDifficulty);
    if (bankCategory) {
      if (bankCategory === '__unclassified') {
        filtered = filtered.filter((item) => !item.category);
      } else {
        filtered = filtered.filter((item) => item.category?.slug === bankCategory);
      }
    }
    return filtered;
  }, [availableQuestions, bankQuery, bankDifficulty, bankCategory]);

  const bankCategories = useMemo(() => {
    const cats = new Map<string, string>();
    availableQuestions.forEach((q) => {
      if (q.category) cats.set(q.category.slug, q.category.name);
    });
    return Array.from(cats.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [availableQuestions]);

  const allBankChecked = filteredBank.length > 0 && filteredBank.every((q) => bankChecked.has(q.id));

  const toggleBankCheck = (questionId: string) => {
    setBankChecked((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const toggleAllBankChecked = () => {
    if (allBankChecked) {
      setBankChecked(new Set());
    } else {
      setBankChecked(new Set(filteredBank.map((q) => q.id)));
    }
  };

  const addCheckedToVersion = () => {
    const toAdd = filteredBank.filter((q) => bankChecked.has(q.id));
    if (toAdd.length === 0) return;
    setVersionQuestions((prev) => {
      const next = [...prev];
      toAdd.forEach((q) => {
        next.push({
          question_id: q.id,
          order_index: next.length,
          points: 1,
          prompt: q.prompt,
        });
      });
      return next.map((item, idx) => ({ ...item, order_index: idx }));
    });
    setBankChecked(new Set());
  };

  const addSingleQuestion = (q: AssessmentQuestion) => {
    setVersionQuestions((prev) => [
      ...prev,
      { question_id: q.id, order_index: prev.length, points: 1, prompt: q.prompt },
    ]);
  };

  const summary = useMemo(() => {
    const totalQuestions = versionQuestions.length;
    const totalPoints = versionQuestions.reduce((sum, item) => sum + (item.points || 0), 0);
    return { totalQuestions, totalPoints, passingScore, timeLimit, attemptsAllowed };
  }, [versionQuestions, passingScore, timeLimit, attemptsAllowed]);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = [];
    if (!title.trim()) issues.push({ id: 'title', title: 'Missing title', description: 'Add a test title.', severity: 'error' });
    if (versionQuestions.length === 0) issues.push({ id: 'questions', title: 'No questions', description: 'Add at least one question.', severity: 'error' });
    if (passingScore < 0 || passingScore > 100) issues.push({ id: 'score', title: 'Invalid passing score', description: 'Use 0–100.', severity: 'warning' });
    return issues;
  }, [title, versionQuestions, passingScore]);

  const moveQuestion = (from: number, to: number) => {
    if (to < 0 || to >= versionQuestions.length) return;
    const next = [...versionQuestions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setVersionQuestions(next.map((item, idx) => ({ ...item, order_index: idx })));
  };

  const updatePoints = (idx: number, pts: number) => {
    setVersionQuestions((prev) => prev.map((item, i) => (i === idx ? { ...item, points: Math.max(1, pts) } : item)));
  };

  const removeQuestion = (idx: number) => {
    setVersionQuestions((prev) =>
      prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order_index: i })),
    );
  };

  const saveDraft = async () => {
    if (!accessToken || !version) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(
        `/assessments/test-versions/${version.id}`,
        {
          passing_score: passingScore,
          time_limit_minutes: timeLimit || null,
          shuffle_questions: shuffleQuestions,
          attempts_allowed: attemptsAllowed || null,
          questions: versionQuestions.map((item, idx) => ({
            question_id: item.question_id,
            order_index: idx,
            points: item.points || 1,
          })),
        },
        accessToken,
      );
      await api.put(
        `/assessments/tests/${id}`,
        {
          title: title.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          role_target: roleTarget.trim() || null,
        },
        accessToken,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save test');
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label='Loading assessment test...' />;
  if (!test || !version) return <EmptyState title='Test not found' description='This assessment does not exist.' />;

  const checkedCount = bankChecked.size;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Test builder</h2>
          <p className='text-sm text-muted-foreground'>Draft and publish assessment versions.</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => router.back()}>Back</Button>
          <Button onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
          <Button variant='secondary' onClick={publish} disabled={saving || validationIssues.some((i) => i.severity === 'error')}>Publish</Button>
        </div>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <BuilderShell
        workspaceLabel='Workspace'
        main={
          <div className='space-y-6'>
            <Card>
              <CardHeader><CardTitle>Test metadata</CardTitle></CardHeader>
              <CardContent className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>Role target</Label>
                  <Input value={roleTarget} onChange={(e) => setRoleTarget(e.target.value)} />
                </div>
                <div className='space-y-2 md:col-span-2'>
                  <Label>Description</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
                <div className='space-y-2'>
                  <Label>Category</Label>
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Version settings</CardTitle>
                <CardDescription>Version {version.version_number}</CardDescription>
              </CardHeader>
              <CardContent className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Passing score (%)</Label>
                  <Input type='number' min={0} max={100} value={passingScore} onChange={(e) => setPassingScore(Number(e.target.value || 0))} />
                </div>
                <div className='space-y-2'>
                  <Label>Time limit (minutes)</Label>
                  <Input type='number' min={1} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value ? Number(e.target.value) : '')} />
                </div>
                <div className='space-y-2'>
                  <Label>Attempts allowed</Label>
                  <Input type='number' min={1} value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(e.target.value ? Number(e.target.value) : '')} />
                </div>
                <label className='flex items-center gap-2 text-sm'>
                  <input type='checkbox' checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} />
                  Shuffle questions
                </label>
              </CardContent>
            </Card>

            {/* Question Set */}
            <Card>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <div>
                    <CardTitle>Question set</CardTitle>
                    <CardDescription>{versionQuestions.length} question{versionQuestions.length !== 1 ? 's' : ''} · {summary.totalPoints} point{summary.totalPoints !== 1 ? 's' : ''}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='space-y-2'>
                {versionQuestions.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>No questions yet. Add from the bank below.</p>
                ) : (
                  versionQuestions.map((item, idx) => (
                    <div key={`${item.question_id}-${idx}`} className='flex items-center gap-3 rounded-md border bg-white p-3'>
                      <span className='w-7 shrink-0 text-center text-xs font-medium text-muted-foreground'>{idx + 1}</span>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>{item.prompt}</p>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Input
                          type='number'
                          min={1}
                          value={item.points}
                          onChange={(e) => updatePoints(idx, Number(e.target.value || 1))}
                          className='h-8 w-16 text-center text-xs'
                          title='Points'
                        />
                        <span className='text-xs text-muted-foreground'>pts</span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => moveQuestion(idx, idx - 1)} disabled={idx === 0}>
                          <ArrowUp className='h-3.5 w-3.5' />
                        </Button>
                        <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => moveQuestion(idx, idx + 1)} disabled={idx === versionQuestions.length - 1}>
                          <ArrowDown className='h-3.5 w-3.5' />
                        </Button>
                        <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive hover:text-destructive' onClick={() => removeQuestion(idx)}>
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Question Bank */}
            <Card>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <div>
                    <CardTitle>Question bank</CardTitle>
                    <CardDescription>{filteredBank.length} of {availableQuestions.length} available</CardDescription>
                  </div>
                  {checkedCount > 0 && (
                    <Button size='sm' onClick={addCheckedToVersion}>
                      Add selected ({checkedCount})
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <div className='relative flex-1'>
                    <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                    <Input
                      value={bankQuery}
                      onChange={(e) => setBankQuery(e.target.value)}
                      placeholder='Search questions…'
                      className='pl-9'
                    />
                  </div>
                  <select className='h-10 rounded-md border border-input bg-white px-3 text-sm' value={bankDifficulty} onChange={(e) => setBankDifficulty(e.target.value)}>
                    <option value=''>All difficulties</option>
                    <option value='easy'>Easy</option>
                    <option value='medium'>Medium</option>
                    <option value='hard'>Hard</option>
                  </select>
                  <select className='h-10 rounded-md border border-input bg-white px-3 text-sm' value={bankCategory} onChange={(e) => setBankCategory(e.target.value)}>
                    <option value=''>All categories</option>
                    <option value='__unclassified'>Unclassified</option>
                    {bankCategories.map(([slug, name]) => (
                      <option key={slug} value={slug}>{name}</option>
                    ))}
                  </select>
                </div>

                {filteredBank.length > 0 && (
                  <div className='flex items-center gap-2 border-b pb-2'>
                    <button type='button' className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground' onClick={toggleAllBankChecked}>
                      {allBankChecked ? <CheckSquare className='h-4 w-4' /> : <Square className='h-4 w-4' />}
                      {allBankChecked ? 'Deselect all' : `Select all (${filteredBank.length})`}
                    </button>
                  </div>
                )}

                <div className='max-h-[400px] space-y-1 overflow-auto'>
                  {filteredBank.length === 0 ? (
                    <p className='py-4 text-center text-xs text-muted-foreground'>No questions match the current filters.</p>
                  ) : (
                    filteredBank.map((question) => (
                      <div key={question.id} className='flex items-center gap-3 rounded-md border bg-white p-2 hover:border-primary/40'>
                        <button type='button' onClick={() => toggleBankCheck(question.id)} className='shrink-0 text-muted-foreground hover:text-foreground'>
                          {bankChecked.has(question.id) ? <CheckSquare className='h-4 w-4 text-primary' /> : <Square className='h-4 w-4' />}
                        </button>
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-sm'>{question.prompt}</p>
                          <div className='mt-0.5 flex gap-1.5'>
                            <Badge variant='secondary' className='text-[10px]'>{question.question_type.replace('_', ' ')}</Badge>
                            {question.difficulty && <Badge variant='outline' className='text-[10px] capitalize'>{question.difficulty}</Badge>}
                            {question.category && <Badge variant='outline' className='text-[10px]'>{question.category.name}</Badge>}
                          </div>
                        </div>
                        <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => addSingleQuestion(question)}>
                          Add
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        }
        workspace={
          <Tabs defaultValue='summary' className='w-full'>
            <Card>
              <CardHeader className='space-y-3'>
                <CardTitle className='text-base'>Workspace</CardTitle>
                <TabsList className='grid w-full grid-cols-3'>
                  <TabsTrigger value='summary'>Summary</TabsTrigger>
                  <TabsTrigger value='validation'>Validation</TabsTrigger>
                  <TabsTrigger value='outline'>Outline</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent>
                <TabsContent value='summary'>
                  <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                    <div className='rounded-xl border bg-background/60 p-4'>
                      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                        {[
                          { label: 'Questions', value: summary.totalQuestions, className: 'border-l-4 border-l-blue-200 bg-blue-50/60' },
                          { label: 'Total points', value: summary.totalPoints, className: 'border-l-4 border-l-emerald-200 bg-emerald-50/60' },
                          { label: 'Passing score', value: summary.passingScore, className: 'border-l-4 border-l-amber-200 bg-amber-50/60' },
                          { label: 'Time limit', value: summary.timeLimit || 0, className: 'border-l-4 border-l-slate-200 bg-slate-50/60' },
                          { label: 'Attempts', value: summary.attemptsAllowed || 0, className: 'border-l-4 border-l-violet-200 bg-violet-50/60' },
                          { label: 'Shuffle', value: shuffleQuestions ? 'Yes' : 'No', className: 'border-l-4 border-l-teal-200 bg-teal-50/60' },
                        ].map((metric) => (
                          <div key={metric.label} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${metric.className}`}>
                            <span className='text-xs text-muted-foreground leading-none'>{metric.label}</span>
                            <span className='text-base font-semibold tabular-nums leading-none'>{metric.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='validation'>
                  <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                    <div className='space-y-3'>
                      {validationIssues.length === 0 ? (
                        <div className='rounded-md bg-emerald-50 p-3 text-xs text-emerald-700'>Ready to publish. No issues detected.</div>
                      ) : (
                        validationIssues.map((issue) => (
                          <div key={issue.id} className='rounded-md border bg-white p-3 text-sm'>
                            <div className='flex items-start justify-between gap-2'>
                              <div>
                                <p className='font-medium'>{issue.title}</p>
                                <p className='text-xs text-muted-foreground'>{issue.description}</p>
                              </div>
                              <Badge variant={issue.severity === 'error' ? 'default' : 'outline'} className={issue.severity === 'error' ? 'bg-red-600' : ''}>{issue.severity}</Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='outline'>
                  <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                    <div className='space-y-2'>
                      {versionQuestions.length === 0 ? (
                        <p className='py-4 text-center text-xs text-muted-foreground'>No questions in this version yet.</p>
                      ) : (
                        versionQuestions.map((item, idx) => (
                          <div key={item.question_id} className='flex items-start gap-2 rounded-md border bg-white p-2'>
                            <span className='mt-0.5 w-5 shrink-0 text-center text-[10px] font-medium text-muted-foreground'>{idx + 1}</span>
                            <p className='text-xs text-muted-foreground'>{item.prompt}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        }
      />
    </div>
  );
}
