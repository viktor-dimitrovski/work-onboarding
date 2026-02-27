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
  const [versionQuestions, setVersionQuestions] = useState<
    { question_id: string; order_index: number; points: number; prompt: string }[]
  >([]);

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

      const questionResponse = await api.get<QuestionListResponse>(
        '/assessments/questions?page=1&page_size=200&status=published',
        accessToken,
      );
      setQuestions(questionResponse.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken, id]);

  const availableQuestions = useMemo(() => {
    const selectedIds = new Set(versionQuestions.map((item) => item.question_id));
    return questions.filter((question) => !selectedIds.has(question.id));
  }, [questions, versionQuestions]);

  const summary = useMemo(() => {
    const totalQuestions = versionQuestions.length;
    const totalPoints = versionQuestions.reduce((sum, item) => sum + (item.points || 0), 0);
    return {
      totalQuestions,
      totalPoints,
      passingScore,
      timeLimit,
      attemptsAllowed,
    };
  }, [versionQuestions, passingScore, timeLimit, attemptsAllowed]);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = [];
    if (!title.trim()) {
      issues.push({
        id: 'test-title',
        title: 'Missing title',
        description: 'Add a test title so it is discoverable.',
        severity: 'error',
      });
    }
    if (versionQuestions.length === 0) {
      issues.push({
        id: 'test-questions',
        title: 'No questions',
        description: 'Add at least one question to this test version.',
        severity: 'error',
      });
    }
    if (passingScore < 0 || passingScore > 100) {
      issues.push({
        id: 'test-passing-score',
        title: 'Invalid passing score',
        description: 'Use a value between 0 and 100.',
        severity: 'warning',
      });
    }
    return issues;
  }, [title, versionQuestions, passingScore]);

  const moveQuestion = (from: number, to: number) => {
    if (to < 0 || to >= versionQuestions.length) return;
    const next = [...versionQuestions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setVersionQuestions(next.map((item, idx) => ({ ...item, order_index: idx })));
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

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Test builder</h2>
          <p className='text-sm text-muted-foreground'>Draft and publish assessment versions.</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => router.back()}>
            Back
          </Button>
          <Button onClick={saveDraft} disabled={saving}>
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant='secondary' onClick={publish} disabled={saving}>
            Publish
          </Button>
        </div>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <BuilderShell
        workspaceLabel='Workspace'
        main={
          <div className='space-y-6'>
            <Card>
              <CardHeader>
                <CardTitle>Test metadata</CardTitle>
              </CardHeader>
              <CardContent className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>Role target</Label>
                  <Input value={roleTarget} onChange={(event) => setRoleTarget(event.target.value)} />
                </div>
                <div className='space-y-2 md:col-span-2'>
                  <Label>Description</Label>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
                </div>
                <div className='space-y-2'>
                  <Label>Category</Label>
                  <Input value={category} onChange={(event) => setCategory(event.target.value)} />
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
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    value={passingScore}
                    onChange={(event) => setPassingScore(Number(event.target.value || 0))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Time limit (minutes)</Label>
                  <Input
                    type='number'
                    min={1}
                    value={timeLimit}
                    onChange={(event) => setTimeLimit(event.target.value ? Number(event.target.value) : '')}
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Attempts allowed</Label>
                  <Input
                    type='number'
                    min={1}
                    value={attemptsAllowed}
                    onChange={(event) => setAttemptsAllowed(event.target.value ? Number(event.target.value) : '')}
                  />
                </div>
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    checked={shuffleQuestions}
                    onChange={(event) => setShuffleQuestions(event.target.checked)}
                  />
                  Shuffle questions
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Question set</CardTitle>
                <CardDescription>Questions included in this version.</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {versionQuestions.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>No questions yet.</p>
                ) : (
                  <div className='space-y-2'>
                    {versionQuestions.map((item, idx) => (
                      <div key={`${item.question_id}-${idx}`} className='rounded-md border bg-white p-3'>
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <p className='font-medium'>{item.prompt}</p>
                            <p className='text-xs text-muted-foreground'>Points: {item.points}</p>
                          </div>
                          <div className='flex items-center gap-2'>
                            <Button variant='ghost' size='sm' onClick={() => moveQuestion(idx, idx - 1)}>
                              Up
                            </Button>
                            <Button variant='ghost' size='sm' onClick={() => moveQuestion(idx, idx + 1)}>
                              Down
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() =>
                                setVersionQuestions((prev) =>
                                  prev.filter((_, questionIdx) => questionIdx !== idx).map((q, orderIndex) => ({
                                    ...q,
                                    order_index: orderIndex,
                                  })),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className='rounded-md border bg-muted/30 p-3'>
                  <p className='text-sm font-medium'>Question bank</p>
                  <p className='text-xs text-muted-foreground'>Add published questions to this version.</p>
                  <div className='mt-3 space-y-2'>
                    {availableQuestions.length === 0 ? (
                      <p className='text-xs text-muted-foreground'>No additional published questions available.</p>
                    ) : (
                      availableQuestions.map((question) => (
                        <div key={question.id} className='flex items-center justify-between gap-3 rounded-md border bg-white p-2'>
                          <div>
                            <p className='text-sm'>{question.prompt}</p>
                            <div className='mt-1 flex gap-2'>
                              <Badge variant='secondary'>{question.question_type.replace('_', ' ')}</Badge>
                            </div>
                          </div>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              setVersionQuestions((prev) => [
                                ...prev,
                                {
                                  question_id: question.id,
                                  order_index: prev.length,
                                  points: 1,
                                  prompt: question.prompt,
                                },
                              ])
                            }
                          >
                            Add
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
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
                <TabsList className='grid w-full grid-cols-4'>
                  <TabsTrigger value='summary'>Summary</TabsTrigger>
                  <TabsTrigger value='ai'>AI</TabsTrigger>
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
                          { label: 'Shuffle', value: shuffleQuestions ? 1 : 0, className: 'border-l-4 border-l-teal-200 bg-teal-50/60' },
                        ].map((metric) => (
                          <div
                            key={metric.label}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 ${metric.className}`}
                          >
                            <span className='text-xs text-muted-foreground leading-none'>{metric.label}</span>
                            <span
                              className={`text-base font-semibold tabular-nums leading-none ${
                                metric.value === 0 ? 'text-muted-foreground' : 'text-foreground'
                              }`}
                            >
                              {metric.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='ai'>
                  <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                    <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
                      AI question generation will be available in the next phase.
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value='validation'>
                  <ScrollArea className='h-[calc(100vh-360px)] pr-3'>
                    <div className='space-y-3'>
                      {validationIssues.length === 0 ? (
                        <div className='rounded-md bg-slate-50 p-3 text-xs text-muted-foreground'>
                          No validation issues detected.
                        </div>
                      ) : (
                        validationIssues.map((issue) => (
                          <div key={issue.id} className='rounded-md border bg-white p-3 text-sm'>
                            <div className='flex items-start justify-between gap-2'>
                              <div>
                                <p className='font-medium'>{issue.title}</p>
                                <p className='text-xs text-muted-foreground'>{issue.description}</p>
                              </div>
                              <Badge variant='outline'>{issue.severity}</Badge>
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
                      {versionQuestions.map((item) => (
                        <div key={item.question_id} className='rounded-md border bg-white p-3 text-xs text-muted-foreground'>
                          {item.prompt}
                        </div>
                      ))}
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
