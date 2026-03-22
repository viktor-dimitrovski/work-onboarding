'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LoadingState } from '@/components/common/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AssessmentCategory, AssessmentCategoryTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderTree,
  GitMerge,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionStats {
  by_category: Record<string, number>;
}

interface CategoryRow extends AssessmentCategory {
  question_count: number;
  children_count: number;
}

// ---------------------------------------------------------------------------
// Slug auto-generator
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CategoriesPage() {
  const { accessToken } = useAuth();

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [tree, setTree] = useState<AssessmentCategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expanded nodes in tree
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Right panel mode: 'idle' | 'create' | 'edit' | 'merge'
  const [panelMode, setPanelMode] = useState<'idle' | 'create' | 'edit' | 'merge'>('idle');
  const [editTarget, setEditTarget] = useState<CategoryRow | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formParentId, setFormParentId] = useState<string>('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Merge state
  const [mergeKeepId, setMergeKeepId] = useState('');
  const [mergeDeleteId, setMergeDeleteId] = useState('');

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [flatRes, treeRes, statsRes] = await Promise.all([
        api.get<{ items: AssessmentCategory[] }>('/assessments/categories', accessToken),
        api.get<{ items: AssessmentCategoryTreeNode[] }>('/assessments/categories/tree', accessToken),
        api.get<QuestionStats>('/assessments/questions/stats', accessToken),
      ]);

      const countsBySlug: Record<string, number> = statsRes.by_category ?? {};

      // Build id→slug map to get counts by id
      const slugById: Record<string, string> = {};
      flatRes.items.forEach((c) => { slugById[c.id] = c.slug; });

      // Build children count from tree
      const childrenCountById: Record<string, number> = {};
      treeRes.items.forEach((node) => {
        childrenCountById[node.id] = node.children.length;
        node.children.forEach((child) => { childrenCountById[child.id] = 0; });
      });

      const rows: CategoryRow[] = flatRes.items.map((c) => ({
        ...c,
        question_count: countsBySlug[c.slug] ?? 0,
        children_count: childrenCountById[c.id] ?? 0,
      }));

      setCategories(rows);
      setTree(treeRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Derived: duplicates by name
  // ---------------------------------------------------------------------------

  const duplicateNames = useMemo(() => {
    const counts: Record<string, number> = {};
    categories.forEach((c) => { counts[c.name] = (counts[c.name] ?? 0) + 1; });
    return new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([name]) => name));
  }, [categories]);

  const hasDuplicates = duplicateNames.size > 0;

  // Flat categories for parent dropdown (excluding self and its descendants)
  const parentOptions = useMemo((): AssessmentCategory[] => {
    if (!editTarget) return categories.filter((c) => c.children_count > 0 || !c.parent_id);
    const exclude = new Set<string>();
    const collectDescendants = (id: string) => {
      exclude.add(id);
      categories.filter((c) => c.parent_id === id).forEach((c) => collectDescendants(c.id));
    };
    collectDescendants(editTarget.id);
    return categories.filter((c) => !exclude.has(c.id));
  }, [categories, editTarget]);

  // ---------------------------------------------------------------------------
  // Panel helpers
  // ---------------------------------------------------------------------------

  const openCreate = (parentId?: string) => {
    setFormName('');
    setFormSlug('');
    setFormParentId(parentId ?? '');
    setSlugManuallyEdited(false);
    setEditTarget(null);
    setPanelMode('create');
  };

  const openEdit = (cat: CategoryRow) => {
    setFormName(cat.name);
    setFormSlug(cat.slug);
    setFormParentId(cat.parent_id ?? '');
    setSlugManuallyEdited(true);
    setEditTarget(cat);
    setPanelMode('edit');
  };

  const openMerge = (cat: CategoryRow) => {
    setMergeKeepId(cat.id);
    setMergeDeleteId('');
    setEditTarget(cat);
    setPanelMode('merge');
  };

  const closePanel = () => {
    setPanelMode('idle');
    setEditTarget(null);
    setConfirmDeleteId(null);
  };

  // Auto-generate slug from name
  const handleNameChange = (val: string) => {
    setFormName(val);
    if (!slugManuallyEdited) setFormSlug(toSlug(val));
  };

  // ---------------------------------------------------------------------------
  // Save / Delete / Merge
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        slug: formSlug.trim(),
        parent_id: formParentId || null,
      };

      if (panelMode === 'create') {
        await api.post('/assessments/categories', payload, accessToken);
      } else if (panelMode === 'edit' && editTarget) {
        // Only send changed fields
        const changes: Record<string, unknown> = {};
        if (formName.trim() !== editTarget.name) changes.name = formName.trim();
        if (formSlug.trim() !== editTarget.slug) changes.slug = formSlug.trim();
        const newParent = formParentId || null;
        if (newParent !== (editTarget.parent_id ?? null)) changes.parent_id = newParent;
        if (Object.keys(changes).length > 0) {
          await api.put(`/assessments/categories/${editTarget.id}`, changes, accessToken);
        }
      }
      await load();
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await api.delete(`/assessments/categories/${id}`, accessToken);
      await load();
      closePanel();
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async () => {
    if (!accessToken || !mergeKeepId || !mergeDeleteId) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/assessments/categories/${mergeKeepId}/merge`, { target_id: mergeDeleteId }, accessToken);
      await load();
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Tree rendering
  // ---------------------------------------------------------------------------

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (node: AssessmentCategoryTreeNode, depth = 0) => {
    const cat = categories.find((c) => c.id === node.id);
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    const isDuplicate = duplicateNames.has(node.name);
    const isEditing = editTarget?.id === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
            isEditing && 'bg-primary/5 ring-1 ring-primary/20',
          )}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
        >
          {/* Expand toggle */}
          <button
            type='button'
            onClick={() => hasChildren && toggleExpand(node.id)}
            className={cn('shrink-0 p-0.5', !hasChildren && 'invisible')}
          >
            {isExpanded
              ? <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
              : <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
            }
          </button>

          {/* Name */}
          <span className={cn('flex-1 truncate text-sm font-medium', isDuplicate && 'text-amber-600')}>
            {node.name}
          </span>

          {/* Badges */}
          <span className='flex shrink-0 items-center gap-1.5'>
            {isDuplicate && (
              <Badge variant='outline' className='border-amber-300 text-[10px] text-amber-700'>duplicate</Badge>
            )}
            {cat && cat.question_count > 0 && (
              <span className='text-[11px] text-muted-foreground'>{cat.question_count}q</span>
            )}
            <span className='text-[10px] font-mono text-muted-foreground/50'>{node.slug}</span>
          </span>

          {/* Actions */}
          <div className='ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100'>
            <button type='button' title='Add child' onClick={() => openCreate(node.id)}
              className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'>
              <Plus className='h-3 w-3' />
            </button>
            <button type='button' title='Edit' onClick={() => cat && openEdit(cat)}
              className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'>
              <Pencil className='h-3 w-3' />
            </button>
            {isDuplicate && (
              <button type='button' title='Merge duplicate' onClick={() => cat && openMerge(cat)}
                className='rounded p-1 text-amber-500 hover:bg-amber-50 hover:text-amber-700'>
                <GitMerge className='h-3 w-3' />
              </button>
            )}
            <button type='button' title='Delete' onClick={() => setConfirmDeleteId(node.id)}
              className='rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600'>
              <Trash2 className='h-3 w-3' />
            </button>
          </div>
        </div>

        {/* Delete confirm inline */}
        {confirmDeleteId === node.id && (
          <div className='mx-3 mb-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs'>
            <p className='font-medium text-red-700'>Delete <span className='font-bold'>{node.name}</span>?</p>
            <p className='mt-0.5 text-red-600'>
              {cat?.question_count ? `${cat.question_count} question(s) will be unlinked. ` : ''}
              {cat?.children_count ? `${cat.children_count} child category/ies will be promoted. ` : ''}
            </p>
            <div className='mt-2 flex gap-2'>
              <Button size='sm' variant='destructive' className='h-6 text-xs' disabled={saving}
                onClick={() => handleDelete(node.id)}>Delete</Button>
              <Button size='sm' variant='ghost' className='h-6 text-xs'
                onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Orphan leaves (root-level, no children)
  const orphans = tree.filter((n) => n.children.length === 0);
  const parents = tree.filter((n) => n.children.length > 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) return <LoadingState label='Loading categories...' />;

  return (
    <div className='flex h-full gap-6'>
      {/* ── LEFT: Tree ── */}
      <div className='flex min-w-0 flex-1 flex-col gap-4'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <FolderTree className='h-5 w-5 text-muted-foreground' />
            <h1 className='text-xl font-semibold'>Categories</h1>
            <Badge variant='secondary'>{categories.length}</Badge>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={load} disabled={loading}>
              <RefreshCw className='mr-1.5 h-3.5 w-3.5' />Refresh
            </Button>
            <Button size='sm' onClick={() => openCreate()}>
              <Plus className='mr-1.5 h-3.5 w-3.5' />New category
            </Button>
          </div>
        </div>

        {error && (
          <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
            <AlertTriangle className='h-4 w-4 shrink-0' />{error}
          </div>
        )}

        {/* Duplicate warning */}
        {hasDuplicates && (
          <div className='flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' />
            <div>
              <p className='font-medium'>Duplicate category names detected</p>
              <p className='mt-0.5 text-xs text-amber-700'>
                {[...duplicateNames].join(', ')} — use the <GitMerge className='inline h-3 w-3' /> Merge button to consolidate them.
              </p>
            </div>
          </div>
        )}

        {/* Tree */}
        <div className='rounded-lg border bg-background'>
          {/* Expand all / collapse all */}
          <div className='flex items-center justify-between border-b px-3 py-2'>
            <span className='text-xs text-muted-foreground'>
              {parents.length} groups · {orphans.length} ungrouped
            </span>
            <div className='flex gap-2'>
              <button type='button' className='text-xs text-primary hover:underline'
                onClick={() => setExpanded(new Set(parents.map((n) => n.id)))}>
                Expand all
              </button>
              <button type='button' className='text-xs text-muted-foreground hover:underline'
                onClick={() => setExpanded(new Set())}>
                Collapse all
              </button>
            </div>
          </div>

          <div className='divide-y'>
            {/* Parent groups */}
            {parents.map((node) => renderNode(node, 0))}

            {/* Orphan leaves */}
            {orphans.length > 0 && (
              <>
                <div className='px-3 py-1.5'>
                  <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                    Ungrouped
                  </span>
                </div>
                {orphans.map((node) => renderNode(node, 0))}
              </>
            )}

            {categories.length === 0 && (
              <div className='py-12 text-center text-sm text-muted-foreground'>
                No categories yet. Click &quot;New category&quot; to create one.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Panel ── */}
      {panelMode !== 'idle' && (
        <div className='w-80 shrink-0'>
          <div className='sticky top-0 rounded-lg border bg-background'>
            {/* Panel header */}
            <div className='flex items-center justify-between border-b px-4 py-3'>
              <p className='text-sm font-semibold'>
                {panelMode === 'create' && 'New category'}
                {panelMode === 'edit' && `Edit: ${editTarget?.name}`}
                {panelMode === 'merge' && 'Merge categories'}
              </p>
              <button type='button' onClick={closePanel} className='text-muted-foreground hover:text-foreground'>
                <X className='h-4 w-4' />
              </button>
            </div>

            <div className='p-4'>
              {/* Create / Edit form */}
              {(panelMode === 'create' || panelMode === 'edit') && (
                <div className='space-y-4'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Name</Label>
                    <Input
                      value={formName}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder='e.g. Backend & Architecture'
                      className='h-8 text-sm'
                    />
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='text-xs'>
                      Slug
                      <span className='ml-1 text-muted-foreground'>(URL-safe identifier)</span>
                    </Label>
                    <Input
                      value={formSlug}
                      onChange={(e) => { setFormSlug(e.target.value); setSlugManuallyEdited(true); }}
                      placeholder='e.g. backend-architecture'
                      className='h-8 font-mono text-xs'
                    />
                    <p className='text-[10px] text-muted-foreground'>Lowercase letters, numbers, and hyphens only.</p>
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Parent group <span className='text-muted-foreground'>(optional)</span></Label>
                    <select
                      value={formParentId}
                      onChange={(e) => setFormParentId(e.target.value)}
                      className='h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary'
                    >
                      <option value=''>— No parent (root level) —</option>
                      {parentOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {error && <p className='text-xs text-red-600'>{error}</p>}

                  <div className='flex gap-2 pt-1'>
                    <Button size='sm' className='flex-1' onClick={handleSave} disabled={saving || !formName.trim() || !formSlug.trim()}>
                      {saving ? 'Saving...' : panelMode === 'create' ? 'Create' : 'Save changes'}
                    </Button>
                    <Button size='sm' variant='outline' onClick={closePanel}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Merge form */}
              {panelMode === 'merge' && (
                <div className='space-y-4'>
                  <p className='text-xs text-muted-foreground'>
                    All questions and child categories from the <strong>deleted</strong> category will be moved into the <strong>kept</strong> category.
                  </p>

                  <div className='space-y-1.5'>
                    <Label className='text-xs text-green-700'>Keep (survives)</Label>
                    <select
                      value={mergeKeepId}
                      onChange={(e) => setMergeKeepId(e.target.value)}
                      className='h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary'
                    >
                      <option value=''>— Select category to keep —</option>
                      {categories.filter((c) => c.id !== mergeDeleteId).map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>
                      ))}
                    </select>
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='text-xs text-red-600'>Delete (contents moved out)</Label>
                    <select
                      value={mergeDeleteId}
                      onChange={(e) => setMergeDeleteId(e.target.value)}
                      className='h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary'
                    >
                      <option value=''>— Select category to delete —</option>
                      {categories.filter((c) => c.id !== mergeKeepId).map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.slug}) — {c.question_count}q</option>
                      ))}
                    </select>
                  </div>

                  {mergeKeepId && mergeDeleteId && (
                    <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
                      <p>
                        <strong>{categories.find((c) => c.id === mergeDeleteId)?.name}</strong> will be permanently deleted.
                        Its questions and children move to <strong>{categories.find((c) => c.id === mergeKeepId)?.name}</strong>.
                      </p>
                    </div>
                  )}

                  {error && <p className='text-xs text-red-600'>{error}</p>}

                  <div className='flex gap-2 pt-1'>
                    <Button
                      size='sm'
                      variant='destructive'
                      className='flex-1'
                      onClick={handleMerge}
                      disabled={saving || !mergeKeepId || !mergeDeleteId}
                    >
                      {saving ? 'Merging...' : 'Merge & delete'}
                    </Button>
                    <Button size='sm' variant='outline' onClick={closePanel}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
