'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
        <div className='overflow-hidden rounded-xl border bg-white divide-y'>
          {tests.map((test) => (
            <div key={test.id} className='flex items-center gap-4 px-4 py-3 hover:bg-muted/20'>
              {/* Title + description */}
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium text-sm'>{test.title}</p>
                {test.description && (
                  <p className='truncate text-xs text-muted-foreground mt-0.5'>{test.description}</p>
                )}
              </div>

              {/* Badges */}
              <div className='hidden sm:flex shrink-0 items-center gap-1.5'>
                <Badge variant='outline' className='text-[11px] capitalize'>{test.status}</Badge>
                {test.category && <Badge variant='secondary' className='text-[11px]'>{test.category}</Badge>}
                {test.role_target && (
                  <span className='text-xs text-muted-foreground'>Role: {test.role_target}</span>
                )}
                <span className='text-xs text-muted-foreground'>
                  {test.versions.length} version{test.versions.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Actions */}
              <div className='flex shrink-0 items-center gap-1'>
                <Button variant='outline' size='sm' className='h-7 text-xs' asChild>
                  <Link href={`/assessments/tests/${test.id}`}>Open builder</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-7 w-7'>
                      <MoreVertical className='h-3.5 w-3.5' />
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
            </div>
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
              <Label htmlFor='role-target'>Target audience <span className='text-muted-foreground font-normal'>(optional)</span></Label>
              <p className='text-[11px] text-muted-foreground'>
                Which job role or group is this test intended for? Used for display and filtering only — it does not restrict who can take the test.
              </p>
              <input
                id='role-target'
                list='role-target-suggestions'
                value={roleTarget}
                onChange={(e) => setRoleTarget(e.target.value)}
                placeholder='e.g. All employees, Developer, Manager…'
                className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              />
              <datalist id='role-target-suggestions'>
                <option value='All employees' />
                <option value='New hires' />
                <option value='Developer' />
                <option value='Manager' />
                <option value='Team Lead' />
                <option value='Sales' />
                <option value='Customer Support' />
                <option value='Finance' />
                <option value='HR' />
                <option value='Operations' />
                <option value='Compliance Officer' />
              </datalist>
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
