'use client';

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { QuestionEditorSheet } from '@/components/assessments/question-editor-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentQuestion } from '@/lib/types';

interface QuestionListResponse {
  items: AssessmentQuestion[];
  meta: { page: number; page_size: number; total: number };
}

type PdfImportResponse = {
  imported_count: number;
  question_ids: string[];
  warnings?: string[];
};

export default function AssessmentQuestionsPage() {
  const { accessToken } = useAuth();
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
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

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await api.get<QuestionListResponse>(
        `/assessments/questions?page=1&page_size=100${query ? `&q=${encodeURIComponent(query)}` : ''}`,
        accessToken,
      );
      setQuestions(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  const filtered = useMemo(() => {
    if (!query) return questions;
    const q = query.toLowerCase();
    return questions.filter((question) => question.prompt.toLowerCase().includes(q));
  }, [questions, query]);

  if (loading) return <LoadingState label='Loading questions...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Question Bank</h2>
          <p className='text-sm text-muted-foreground'>Maintain reusable questions for assessments.</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
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

      <div className='flex flex-wrap items-center gap-3'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search prompt...'
          className='max-w-sm'
        />
        <Button variant='outline' onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title='No questions found' description='Add your first assessment question.' />
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {filtered.map((question) => (
            <Card key={question.id} className='hover:border-primary/40'>
              <CardHeader>
                <CardTitle className='text-base'>{question.prompt}</CardTitle>
                <CardDescription className='flex flex-wrap gap-2'>
                  <Badge variant='secondary'>{question.question_type.replace('_', ' ')}</Badge>
                  <Badge variant='outline'>{question.status}</Badge>
                  {question.difficulty && <Badge variant='outline'>{question.difficulty}</Badge>}
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
      )}

      <QuestionEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
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
