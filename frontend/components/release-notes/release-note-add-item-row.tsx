'use client';

import { useRef, useState, KeyboardEvent } from 'react';
import { ChevronDown, Link2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ITEM_TYPES, getTypeMeta, type ItemType } from '@/lib/release-note-types';

type Props = {
  sectionType: ItemType;
  onConfirm: (data: { title: string; description?: string; migration_step?: string }) => Promise<void>;
  onCancel: () => void;
};

export function ReleaseNoteAddItemRow({ sectionType, onConfirm, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [migrationStep, setMigrationStep] = useState('');
  const [showMigration, setShowMigration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const meta = getTypeMeta(sectionType);

  const handleAdd = async () => {
    if (!title.trim()) {
      setError('Title is required');
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm({
        title: title.trim(),
        description: description.trim() || undefined,
        migration_step: showMigration && migrationStep.trim() ? migrationStep.trim() : undefined,
      });
      setTitle('');
      setDescription('');
      setMigrationStep('');
      setShowMigration(false);
      titleRef.current?.focus();
    } catch {
      setError('Failed to add item. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onCancel(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { handleAdd(); }
  };

  return (
    <div
      className={cn(
        'border-l-4 rounded-r-md border border-l-4 bg-white shadow-sm mx-0 my-1',
        meta.border,
      )}
      onKeyDown={handleKeyDown}
    >
      <div className="p-3 space-y-2">
        {/* Type indicator */}
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', meta.badge)}>
            <meta.icon className="h-3 w-3" />
            {meta.label}
          </span>
          <span className="text-xs text-muted-foreground">Ctrl+Enter to add · Esc to cancel</span>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">
            Title <span className="text-red-500">*</span>
          </label>
          <Textarea
            ref={titleRef}
            autoFocus
            rows={1}
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            placeholder="Short description of the change…"
            className={cn(
              'resize-none overflow-hidden text-sm min-h-0',
              error && 'border-red-400 focus-visible:ring-red-400',
            )}
            style={{ height: 'auto' }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = `${t.scrollHeight}px`;
            }}
          />
          {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">
            Description <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Additional context, details, or links…"
            className="resize-none text-sm"
          />
        </div>

        {/* Deployment step */}
        {!showMigration ? (
          <button
            type="button"
            onClick={() => setShowMigration(true)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            <Link2 className="h-3 w-3" />
            + Add deployment step
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Deployment Step
              </label>
              <button
                type="button"
                onClick={() => { setShowMigration(false); setMigrationStep(''); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <Textarea
              autoFocus
              rows={2}
              value={migrationStep}
              onChange={(e) => setMigrationStep(e.target.value)}
              placeholder="kubectl rollout restart deployment/service-name -n production"
              className="resize-none text-sm font-mono text-xs"
            />
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t bg-slate-50/70 px-3 py-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
        <Button size="sm" onClick={handleAdd} disabled={saving} className="h-7 text-xs">
          {saving ? 'Adding…' : 'Add Item'}
        </Button>
      </div>
    </div>
  );
}
