'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Search,
  Tag,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/common/loading-state';
import { ReleaseNoteSection } from '@/components/release-notes/release-note-section';
import { AutosaveIndicator, type SaveState } from '@/components/release-notes/autosave-indicator';
import { AuthorAvatarStack, type Author } from '@/components/release-notes/author-avatar-stack';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { ITEM_TYPES, type ItemType } from '@/lib/release-note-types';
import { cn } from '@/lib/utils';
import type { ReleaseNoteItem } from '@/components/release-notes/release-note-item-row';

type ReleaseNoteDetail = {
  id: string;
  repo: string;
  branch: string | null;
  service_name: string;
  component_type: string;
  tag: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  authors: { user_id: string; added_at: string }[];
  items: ReleaseNoteItem[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type User = { id: string; full_name: string | null; email: string };

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  draft:     { label: 'Draft',     classes: 'border-slate-200 text-slate-600 bg-slate-50' },
  published: { label: 'Published', classes: 'border-emerald-200 text-emerald-700 bg-emerald-50' },
  approved:  { label: 'Approved',  classes: 'border-blue-200 text-blue-700 bg-blue-50' },
};

type PendingDelete = {
  item: ReleaseNoteItem;
  timeoutId: ReturnType<typeof setTimeout>;
};

// ── User picker popover ────────────────────────────────────────────────────────
function UserPickerPopover({
  users,
  excludeIds,
  highlightIds,
  highlightLabel,
  onSelect,
  onClose,
  placeholder,
  note,
}: {
  users: User[];
  excludeIds: string[];
  highlightIds?: string[];
  highlightLabel?: string;
  onSelect: (user: User) => void;
  onClose: () => void;
  placeholder?: string;
  note?: string;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = users
    .filter((u) => !excludeIds.includes(u.id))
    .filter((u) => {
      const search = q.toLowerCase();
      return (u.full_name?.toLowerCase().includes(search) ?? false) || u.email.toLowerCase().includes(search);
    });

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border bg-white shadow-lg">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? 'Search users…'}
          className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground"
        />
        <button onClick={onClose} className="text-muted-foreground hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {note && (
        <p className="px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">{note}</p>
      )}
      <div className="max-h-56 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground text-center">No eligible users found</p>
        )}
        {filtered.map((user) => {
          const isHighlighted = highlightIds?.includes(user.id);
          return (
            <button
              key={user.id}
              onClick={() => { onSelect(user); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 text-left transition-colors"
            >
              <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-semibold text-slate-600 flex-shrink-0">
                {(user.full_name ?? user.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800 truncate">{user.full_name ?? user.email}</div>
                {user.full_name && <div className="text-xs text-muted-foreground truncate">{user.email}</div>}
              </div>
              {isHighlighted && highlightLabel && (
                <span className="flex-shrink-0 text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
                  {highlightLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReleaseNoteEditorPage() {
  const params = useParams();
  const id = params?.id as string;
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();

  const [note, setNote] = useState<ReleaseNoteDetail | null>(null);
  const [items, setItems] = useState<ReleaseNoteItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [addingToSection, setAddingToSection] = useState<ItemType | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [showAddAuthor, setShowAddAuthor] = useState(false);
  const [showApprovalPicker, setShowApprovalPicker] = useState(false);
  const undoRef = useRef<PendingDelete | null>(null);

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError(null);
    try {
      const [data, usersResp] = await Promise.all([
        api.get<ReleaseNoteDetail>(`/release-notes/${id}`, accessToken),
        api.get<{ items: User[] }>('/users', accessToken).catch(() => ({ items: [] })),
      ]);
      setNote(data);
      setItems(data.items ?? []);
      setUsers(usersResp.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load release note');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => { load(); }, [load]);

  // ── Autosave ──────────────────────────────────────────────────────────────────

  const saveField = useCallback(async (itemId: string, field: string, value: string | null) => {
    if (!accessToken) return;
    setSaveState('saving');
    setItems((prev) =>
      prev.map((item) => item.id === itemId ? { ...item, [field]: value } : item),
    );
    try {
      await api.patch(`/release-notes/${id}/items/${itemId}`, { [field]: value }, accessToken);
      setSaveState('saved');
      setLastSavedAt(new Date());
    } catch {
      setSaveState('error');
      load();
    }
  }, [accessToken, id, load]);

  const changeType = useCallback(async (itemId: string, newType: ItemType) => {
    if (!accessToken) return;
    setSaveState('saving');
    setItems((prev) =>
      prev.map((item) => item.id === itemId ? { ...item, item_type: newType } : item),
    );
    try {
      await api.patch(`/release-notes/${id}/items/${itemId}`, { item_type: newType }, accessToken);
      setSaveState('saved');
      setLastSavedAt(new Date());
    } catch {
      setSaveState('error');
      load();
    }
  }, [accessToken, id, load]);

  // ── Add item ──────────────────────────────────────────────────────────────────

  const handleAddConfirm = useCallback(async (sectionType: ItemType, data: {
    title: string; description?: string; migration_step?: string;
  }) => {
    if (!accessToken) return;
    const body = { item_type: sectionType, order_index: 0, ...data };
    const newItem = await api.post<ReleaseNoteItem>(`/release-notes/${id}/items`, body, accessToken);
    setItems((prev) => [...prev, newItem]);
    setSaveState('saved');
    setLastSavedAt(new Date());
  }, [accessToken, id]);

  // ── Delete with undo ──────────────────────────────────────────────────────────

  const handleDelete = useCallback((itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || !accessToken) return;

    if (undoRef.current) {
      clearTimeout(undoRef.current.timeoutId);
      api.delete(`/release-notes/${id}/items/${undoRef.current.item.id}`, accessToken).catch(() => {});
    }

    setItems((prev) => prev.filter((i) => i.id !== itemId));

    const timeoutId = setTimeout(async () => {
      try {
        await api.delete(`/release-notes/${id}/items/${itemId}`, accessToken);
      } catch {
        setItems((prev) => [...prev, item].sort((a, b) => a.order_index - b.order_index));
      }
      undoRef.current = null;
      setPendingDelete(null);
      setUndoMessage(null);
    }, 5000);

    const pending = { item, timeoutId };
    undoRef.current = pending;
    setPendingDelete(pending);
    setUndoMessage('Item deleted');
    setExpandedItemId(null);
  }, [accessToken, id, items]);

  const handleUndo = useCallback(() => {
    if (!undoRef.current) return;
    clearTimeout(undoRef.current.timeoutId);
    setItems((prev) => [...prev, undoRef.current!.item].sort((a, b) => a.order_index - b.order_index));
    undoRef.current = null;
    setPendingDelete(null);
    setUndoMessage(null);
  }, []);

  // ── Drag and drop ─────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !accessToken) return;

    const activeItem = items.find((i) => i.id === active.id);
    const overItem = items.find((i) => i.id === over.id);
    if (!activeItem || !overItem || activeItem.item_type !== overItem.item_type) return;

    const sectionItems = items
      .filter((i) => i.item_type === activeItem.item_type)
      .sort((a, b) => a.order_index - b.order_index);

    const activeIdx = sectionItems.findIndex((i) => i.id === active.id);
    const overIdx = sectionItems.findIndex((i) => i.id === over.id);
    const reordered = [...sectionItems];
    const [moved] = reordered.splice(activeIdx, 1);
    reordered.splice(overIdx, 0, moved);

    const reorderData = reordered.map((item, idx) => ({ id: item.id, order_index: idx }));

    setItems((prev) =>
      prev.map((item) => {
        const found = reorderData.find((r) => r.id === item.id);
        return found ? { ...item, order_index: found.order_index } : item;
      }),
    );

    try {
      await api.post(`/release-notes/${id}/items/reorder`, { items: reorderData }, accessToken);
    } catch {
      load();
    }
  }, [accessToken, id, items, load]);

  // ── Publish ───────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!accessToken || !note) return;
    setPublishing(true);
    try {
      const updated = await api.post<ReleaseNoteDetail>(`/release-notes/${id}/publish`, {}, accessToken);
      setNote(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  // ── Authors ───────────────────────────────────────────────────────────────────

  const handleAddAuthor = async (user: User) => {
    if (!accessToken) return;
    try {
      const updated = await api.post<ReleaseNoteDetail>(`/release-notes/${id}/authors`, { user_id: user.id }, accessToken);
      setNote(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add author');
    }
  };

  const handleRemoveAuthor = async (userId: string) => {
    if (!accessToken) return;
    // Optimistic update
    setNote((prev) => prev ? { ...prev, authors: prev.authors.filter((a) => a.user_id !== userId) } : prev);
    try {
      const updated = await api.delete<ReleaseNoteDetail>(`/release-notes/${id}/authors/${userId}`, accessToken);
      if (updated && 'id' in updated) setNote(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove author');
      load(); // revert
    }
  };

  // ── Approval ──────────────────────────────────────────────────────────────────

  const handleRequestApproval = async (user: User) => {
    if (!accessToken) return;
    setApproving(true);
    try {
      const updated = await api.post<ReleaseNoteDetail>(`/release-notes/${id}/approve`, { approved_by: user.id }, accessToken);
      setNote(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to request approval');
    } finally {
      setApproving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return <LoadingState label="Loading release note…" />;
  if (error || !note) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <p className="text-red-600">{error ?? 'Not found'}</p>
        <Button variant="outline" onClick={load} className="mt-2">Retry</Button>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[note.status] ?? STATUS_STYLES.draft;
  const authors: Author[] = note.authors.map((a) => ({ user_id: a.user_id }));
  const authorIds = note.authors.map((a) => a.user_id);
  // Approval eligibility: creator cannot approve their own note (4-eyes rule).
  // Co-authors can approve. Exclude only the creator from the picker.
  const approvalExcludeIds = note.created_by ? [note.created_by] : [];
  // Co-authors (not the creator) are highlighted as natural approvers
  const coAuthorIds = authorIds.filter((aid) => aid !== note.created_by);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Fixed header */}
      <div className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur-sm">
        <div className="container mx-auto max-w-5xl px-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 pt-3 pb-1 text-xs text-muted-foreground">
            <Link href="/release-notes" className="hover:text-slate-700 transition-colors flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              Release Notes
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-700 font-medium">{note.service_name}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="font-mono text-slate-600">{note.tag}</span>
          </div>

          {/* Identity + actions row */}
          <div className="flex items-center gap-3 pb-3 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] px-1.5 py-0 font-semibold tracking-wide uppercase flex-shrink-0',
                note.component_type === 'service'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700',
              )}
            >
              {note.component_type === 'service' ? 'Service' : 'Config'}
            </Badge>

            <span className="font-semibold text-slate-800">{note.service_name}</span>

            {note.branch && (
              <Badge variant="outline" className="font-mono text-xs bg-slate-50">
                {note.branch}
              </Badge>
            )}

            <Badge variant="outline" className="font-mono text-xs flex items-center gap-1 bg-slate-50">
              <Tag className="h-2.5 w-2.5" />
              {note.tag}
            </Badge>

            <Badge variant="outline" className={cn('text-xs flex-shrink-0', statusStyle.classes)}>
              {statusStyle.label}
            </Badge>

            <div className="flex-1" />

            {/* Authors stack */}
            <AuthorAvatarStack
              authors={authors}
              canWrite={canWrite}
              onRemove={canWrite ? handleRemoveAuthor : undefined}
            />

            {/* Add co-author button */}
            {canWrite && (
              <div className="relative">
                <button
                  onClick={() => { setShowAddAuthor((v) => !v); setShowApprovalPicker(false); }}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors"
                  title="Add co-author"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
                {showAddAuthor && (
                  <UserPickerPopover
                    users={users}
                    excludeIds={authorIds}
                    onSelect={handleAddAuthor}
                    onClose={() => setShowAddAuthor(false)}
                    placeholder="Search co-authors…"
                  />
                )}
              </div>
            )}

            {/* Save indicator */}
            <AutosaveIndicator state={saveState} lastSavedAt={lastSavedAt} />

            {/* Primary action */}
            {canWrite && note.status === 'draft' && (
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={publishing || items.length === 0}
                className="h-8"
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
            )}

            {/* Request Approval */}
            {canWrite && note.status === 'published' && (
              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowApprovalPicker((v) => !v); setShowAddAuthor(false); }}
                  disabled={approving}
                  className="h-8 gap-1.5"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {approving ? 'Requesting…' : 'Request Approval'}
                </Button>
                {showApprovalPicker && (
                  <UserPickerPopover
                    users={users}
                    excludeIds={approvalExcludeIds}
                    highlightIds={coAuthorIds}
                    highlightLabel="Co-author"
                    onSelect={handleRequestApproval}
                    onClose={() => setShowApprovalPicker(false)}
                    placeholder="Select approver…"
                    note="Creator cannot approve their own note. Co-authors are eligible."
                  />
                )}
              </div>
            )}

            {note.status === 'approved' && (
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Approved
                </Badge>
                {note.approved_at && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(note.approved_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="container mx-auto max-w-5xl flex-1 px-4 py-5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {ITEM_TYPES.map((typeConfig) => {
            const sectionItems = items
              .filter((i) => i.item_type === typeConfig.value)
              .sort((a, b) => a.order_index - b.order_index);

            return (
              <ReleaseNoteSection
                key={typeConfig.value}
                type={typeConfig.value}
                items={sectionItems}
                expandedItemId={expandedItemId}
                addingToThisSection={addingToSection === typeConfig.value}
                canWrite={canWrite}
                saveState={saveState}
                headerTopOffset={104}
                onItemExpand={(itemId) => {
                  setAddingToSection(null);
                  setExpandedItemId(itemId);
                }}
                onItemCollapse={() => setExpandedItemId(null)}
                onAddStart={() => {
                  setExpandedItemId(null);
                  setAddingToSection(typeConfig.value);
                }}
                onAddCancel={() => setAddingToSection(null)}
                onAddConfirm={async (data) => {
                  await handleAddConfirm(typeConfig.value, data);
                }}
                onFieldSave={saveField}
                onTypeChange={changeType}
                onDelete={handleDelete}
              />
            );
          })}
        </DndContext>

        {items.length === 0 && addingToSection === null && (
          <div className="mt-8 text-center text-sm text-muted-foreground">
            <p>No items yet. Click <strong>+</strong> next to any section header to add the first item.</p>
          </div>
        )}
      </div>

      {/* Undo toast */}
      {undoMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {undoMessage}
          <button
            onClick={handleUndo}
            className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium hover:bg-white/20 transition-colors"
          >
            Undo
          </button>
        </div>
      )}

      {/* Close pickers on outside click */}
      {(showAddAuthor || showApprovalPicker) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowAddAuthor(false); setShowApprovalPicker(false); }}
        />
      )}
    </div>
  );
}
