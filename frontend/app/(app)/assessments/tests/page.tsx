'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentTest } from '@/lib/types';

interface TestListResponse {
  items: AssessmentTest[];
  meta: { page: number; page_size: number; total: number };
}

export default function AssessmentTestsPage() {
  const { accessToken } = useAuth();
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [roleTarget, setRoleTarget] = useState('');

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await api.get<TestListResponse>('/assessments/tests?page=1&page_size=100', accessToken);
      setTests(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading tests...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Assessment Tests</h2>
          <p className='text-sm text-muted-foreground'>Versioned assessments with curated question sets.</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>New test</Button>
      </div>

      {tests.length === 0 ? (
        <EmptyState title='No tests yet' description='Create your first assessment test.' />
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {tests.map((test) => (
            <Card key={test.id}>
              <CardHeader>
                <CardTitle className='text-base'>{test.title}</CardTitle>
                <CardDescription>{test.description || 'No description provided.'}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='text-xs text-muted-foreground'>
                  {test.category && <p>Category: {test.category}</p>}
                  {test.role_target && <p>Role target: {test.role_target}</p>}
                  <p>Status: {test.status}</p>
                  <p>Versions: {test.versions.length}</p>
                </div>
                <div className='mt-3 flex gap-2'>
                  <Button variant='outline' asChild>
                    <Link href={`/assessments/tests/${test.id}`}>Open builder</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='flex h-full flex-col'>
          <SheetHeader>
            <SheetTitle>New test</SheetTitle>
          </SheetHeader>
          <div className='mt-4 flex-1 space-y-4 overflow-auto pr-1'>
            <div className='space-y-2'>
              <Label>Title</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Description</Label>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Category</Label>
              <Input value={category} onChange={(event) => setCategory(event.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Role target</Label>
              <Input value={roleTarget} onChange={(event) => setRoleTarget(event.target.value)} />
            </div>
          </div>
          <SheetFooter className='mt-4'>
            <Button variant='outline' onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!accessToken || !title.trim()) return;
                await api.post(
                  '/assessments/tests',
                  {
                    title: title.trim(),
                    description: description.trim() || null,
                    category: category.trim() || null,
                    role_target: roleTarget.trim() || null,
                  },
                  accessToken,
                );
                setTitle('');
                setDescription('');
                setCategory('');
                setRoleTarget('');
                setSheetOpen(false);
                await load();
              }}
            >
              Create test
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
