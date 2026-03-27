'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, Link2, MoreHorizontal, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ITEM_TYPES, getTypeMeta, type ItemType } from '@/lib/release-note-types';
import { ItemTypeBadge } from './item-type-badge';
import type { SaveState } from './autosave-indicator';

export type ReleaseNoteItem = {
  id: string;
  item_type: string;
  title: string;
  description?: string | null;
  migration_step?: string | null;
  order_index: number;
};

type Props = {
  item: ReleaseNoteItem;
  isExpanded: boolean;
  canWrite: boolean;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  saveState?: SaveState;
  onExpand: () => void;
  onCollapse: () => void;
  onFieldSave: (field: string, value: string | null) => Promise<void>;
  onTypeChange: (type: ItemType) => Promise<void>;
  onDelete: () => void;
};

export function ReleaseNoteItemRow({
  item,
  isExpanded,
  canWrite,
  isDragging,
  dragHandleProps,
  saveState,
  onExpand,
  onCollapse,
  onFieldSave,
  onTypeChange,
  onDelete,
}: Props) {
  const meta = getTypeMeta(item.item_type);

  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [migrationStep, setMigrationStep] = useState(item.migration_step ?? '');
  const [showMigration, setShowMigration] = useState(!!item.migration_step);

  // Sync from prop when item updates from outside (reorder, type change)
  useEffect(() => {
    if (!isExpanded) {
      setTitle(item.title);
      setDescription(item.description ?? '');
      setMigrationStep(item.migration_step ?? '');
      setShowMigration(!!item.migration_step);
    }
  }, [item, isExpanded]);

  if (!isExpanded) {
    return (
      <div
        className={cn(
          'group relative flex items-start gap-2 rounded-md border border-transparent px-2 py-2 transition-colors cursor-pointer',
          'hover:bg-slate-50 hover:border-slate-200',
          isDragging && 'opacity-50 shadow-lg ring-2 ring-blue-300',
        )}
        onClick={onExpand}
      >
        {/* Drag handle */}
        {canWrite && (
          <div
            {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-slate-400 transition-opacity"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        {!canWrite && <div className="w-4 flex-shrink-0" />}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ItemTypeBadge type={item.item_type} size="sm" />
            <span className="text-sm font-medium text-slate-800 truncate">{item.title}</span>
            {item.migration_step && (
              <span title="Has deployment step">
                <Link2 className="h-3 w-3 flex-shrink-0 text-slate-400" />
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{item.description}</p>
          )}
        </div>

        {/* Actions */}
        {canWrite && (
          <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  }

  // Expanded editing state
  return (
    <div className={cn('rounded-md border bg-white shadow-sm my-1', `border-l-4 ${meta.border}`)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        {/* Type picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80',
                meta.badge,
              )}
            >
              <meta.icon className="h-3 w-3" />
              {meta.label}
              <span className="text-[10px] opacity-60">▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {ITEM_TYPES.map((t) => {
              const tm = getTypeMeta(t.value);
              return (
                <DropdownMenuItem
                  key={t.value}
                  onClick={() => onTypeChange(t.value)}
                  className="gap-2"
                >
                  <tm.icon className="h-3.5 w-3.5" />
                  {t.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <button onClick={onCollapse} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Title */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">
            Title <span className="text-red-500">*</span>
          </label>
          <Textarea
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && onFieldSave('title', title.trim())}
            className="resize-none overflow-hidden text-sm"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = `${t.scrollHeight}px`;
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">
            Description <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onFieldSave('description', description.trim() || null)}
            className="resize-none text-sm"
          />
        </div>

        {/* Deployment step */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              Deployment Step
            </label>
            <button
              type="button"
              onClick={() => {
                const next = !showMigration;
                setShowMigration(next);
                if (!next) {
                  setMigrationStep('');
                  onFieldSave('migration_step', null);
                }
              }}
              className={cn(
                'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                showMigration ? 'bg-blue-500' : 'bg-slate-200',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform',
                  showMigration ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </div>
          {showMigration && (
            <Textarea
              autoFocus
              rows={3}
              value={migrationStep}
              onChange={(e) => setMigrationStep(e.target.value)}
              onBlur={() => onFieldSave('migration_step', migrationStep.trim() || null)}
              placeholder="kubectl rollout restart deployment/service-name -n production"
              className="resize-none text-xs font-mono"
            />
          )}
        </div>
      </div>

      {/* Footer */}
      {canWrite && (
        <div className="flex items-center justify-between border-t bg-slate-50/60 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            Delete
          </Button>
          <span className="text-xs text-muted-foreground">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && '● Saved'}
            {saveState === 'error' && '✕ Error'}
          </span>
        </div>
      )}
    </div>
  );
}
