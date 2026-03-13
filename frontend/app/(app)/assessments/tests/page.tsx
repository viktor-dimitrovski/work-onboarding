'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentTest } from '@/lib/types';
import { MoreVertical } from 'lucide-react';

interface TestListResponse {
  items: AssessmentTest[];
  meta: { page: number; page_size: number; total: number };
}

export default function AssessmentTestsPage() {
  const { accessToken } = useAuth();
  const [tests, setTests] = useState<AssessmentTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AssessmentTest | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [roleTarget, setRoleTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssessmentTest | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setDescription('');
    setCategory('');
    setRoleTarget('');
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (test: AssessmentTest) => {
    setEditing(test);
    setTitle(test.title);
    setDescription(test.description ?? '');
    setCategory(test.category ?? '');
    setRoleTarget(test.role_target ?? '');
    setError(null);
    setSheetOpen(true);
  };

  const saveTest = async () => {
    if (!accessToken || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        role_target: roleTarget.trim() || null,
      };
      if (editing) {
        await api.put(`/assessments/tests/${editing.id}`, payload, accessToken);
      } else {
        await api.post('/assessments/tests', payload, accessToken);
      }
      setSheetOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save test');
    } finally {
      setSaving(false);
    }
  };

  const deleteTest = async () => {
    if (!accessToken || !deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/assessments/tests/${deleteTarget.id}`, accessToken);
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingState label='Loading tests...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Assessment Tests</h2>
          <p className='text-sm text-muted-foreground'>Versioned assessments with curated question sets.</p>
        </div>
        <Button onClick={openCreate}>New test</Button>
      </div>

      {tests.length === 0 ? (
        <EmptyState title='No tests yet' description='Create your first assessment test.' />
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {tests.map((test) => (
            <Card key={test.id}>
              <CardHeader>
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <CardTitle className='text-base'>{test.title}</CardTitle>
                    <CardDescription className='mt-1'>{test.description || 'No description provided.'}</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0'>
                        <MoreVertical className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => openEdit(test)}>Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleteTarget(test)}
                        className='text-destructive focus:text-destructive'
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <Badge variant='outline' className='capitalize'>{test.status}</Badge>
                  {test.category && <Badge variant='secondary'>{test.category}</Badge>}
                  {test.role_target && <span>Role: {test.role_target}</span>}
                  <span>{test.versions.length} version{test.versions.length !== 1 ? 's' : ''}</span>
                </div>
                <div className='mt-3'>
                  <Button variant='outline' asChild>
                    <Link href={`/assessments/tests/${test.id}`}>Open builder</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!saving) setSheetOpen(open); }}>
        <SheetContent side='right' className='flex h-full flex-col'>
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit test' : 'New test'}</SheetTitle>
          </SheetHeader>
          <div className='mt-4 flex-1 space-y-4 overflow-auto pr-1'>
            <div className='space-y-2'>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>Role target</Label>
              <Input value={roleTarget} onChange={(e) => setRoleTarget(e.target.value)} />
            </div>
            {error && <p className='text-sm text-destructive'>{error}</p>}
          </div>
          <SheetFooter className='mt-4'>
            <Button variant='outline' onClick={() => setSheetOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveTest} disabled={saving || !title.trim()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create test'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title='Delete test?'
        description={`"${deleteTarget?.title ?? ''}" and all its versions will be permanently deleted.`}
        confirmText={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={deleteTest}
      />
    </div>
  );
}
