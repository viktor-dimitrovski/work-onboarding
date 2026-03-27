'use client';

import { Plus } from 'lucide-react';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import { getTypeMeta, type ItemType } from '@/lib/release-note-types';
import { ReleaseNoteItemRow, type ReleaseNoteItem } from './release-note-item-row';
import { ReleaseNoteAddItemRow } from './release-note-add-item-row';
import type { SaveState } from './autosave-indicator';

type SortableItemProps = {
  item: ReleaseNoteItem;
  isExpanded: boolean;
  canWrite: boolean;
  saveState?: SaveState;
  onExpand: () => void;
  onCollapse: () => void;
  onFieldSave: (field: string, value: string | null) => Promise<void>;
  onTypeChange: (type: ItemType) => Promise<void>;
  onDelete: () => void;
};

function SortableItem({ item, ...props }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <ReleaseNoteItemRow
        item={item}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        {...props}
      />
    </div>
  );
}

type Props = {
  type: ItemType;
  items: ReleaseNoteItem[];
  expandedItemId: string | null;
  addingToThisSection: boolean;
  canWrite: boolean;
  saveState?: SaveState;
  headerTopOffset?: number;
  onItemExpand: (id: string) => void;
  onItemCollapse: () => void;
  onAddStart: () => void;
  onAddCancel: () => void;
  onAddConfirm: (data: { title: string; description?: string; migration_step?: string }) => Promise<void>;
  onFieldSave: (itemId: string, field: string, value: string | null) => Promise<void>;
  onTypeChange: (itemId: string, type: ItemType) => Promise<void>;
  onDelete: (itemId: string) => void;
};

export function ReleaseNoteSection({
  type,
  items,
  expandedItemId,
  addingToThisSection,
  canWrite,
  saveState,
  headerTopOffset = 72,
  onItemExpand,
  onItemCollapse,
  onAddStart,
  onAddCancel,
  onAddConfirm,
  onFieldSave,
  onTypeChange,
  onDelete,
}: Props) {
  const meta = getTypeMeta(type);
  const Icon = meta.icon;

  return (
    <div className="mb-4">
      {/* Sticky section header */}
      <div
        className="sticky z-10 flex items-center gap-2 bg-background py-1.5"
        style={{ top: headerTopOffset }}
      >
        <div className={cn('h-5 w-1 rounded-full flex-shrink-0', meta.dot)} />
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          {meta.label}
        </span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        <div className="flex-1" />
        {canWrite && (
          <button
            onClick={onAddStart}
            className="flex items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
            title={`Add ${meta.label}`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Items */}
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5">
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              isExpanded={expandedItemId === item.id}
              canWrite={canWrite}
              saveState={expandedItemId === item.id ? saveState : undefined}
              onExpand={() => onItemExpand(item.id)}
              onCollapse={onItemCollapse}
              onFieldSave={(field, value) => onFieldSave(item.id, field, value)}
              onTypeChange={(newType) => onTypeChange(item.id, newType)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      </SortableContext>

      {/* Empty state */}
      {items.length === 0 && !addingToThisSection && (
        <button
          onClick={canWrite ? onAddStart : undefined}
          disabled={!canWrite}
          className={cn(
            'w-full rounded-md border border-dashed border-slate-200 px-4 py-2 text-left text-xs text-muted-foreground transition-colors',
            canWrite && 'hover:border-slate-300 hover:bg-slate-50/60 cursor-pointer',
            !canWrite && 'cursor-default',
          )}
        >
          {canWrite ? `No ${meta.label.toLowerCase()} items — click to add` : `No ${meta.label.toLowerCase()} items`}
        </button>
      )}

      {/* Inline add form */}
      {addingToThisSection && (
        <ReleaseNoteAddItemRow
          sectionType={type}
          onConfirm={onAddConfirm}
          onCancel={onAddCancel}
        />
      )}
    </div>
  );
}
