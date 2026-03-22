'use client';

/**
 * HierarchicalCategoryMenu
 *
 * iPhone-style two-level sliding panel for category navigation.
 *
 * Level 0 — root panel
 *   • "All categories" (clears selection)
 *   • "Unclassified"
 *   • Each parent group  → chevron right → drill into level 1
 *   • Orphan leaf categories (no parent) rendered directly
 *
 * Level 1 — children panel
 *   • Back arrow
 *   • "All in <Group>" shortcut
 *   • Each child leaf with a checkbox
 *
 * Multi-select is supported. selectedSlugs is the source of truth.
 * A parent group shows a count badge of how many of its children are active.
 */

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { AssessmentCategoryTreeNode } from '@/lib/types';

export interface HierarchicalCategoryMenuProps {
  /** Tree returned from GET /assessments/categories/tree */
  tree: AssessmentCategoryTreeNode[];
  /** Count for "Unclassified" bucket – pass stats.unclassified_category */
  unclassifiedCount?: number;
  /** Count per category slug → shown next to label */
  countsBySlag?: Record<string, number>;
  /** Total question count across all categories */
  totalCount?: number;
  /** Currently selected category slugs */
  selectedSlugs: string[];
  /** Called whenever the selection changes */
  onChange: (next: string[]) => void;
  /** Extra class names on the root container */
  className?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function collectDescendantSlugs(node: AssessmentCategoryTreeNode): string[] {
  if (node.children.length === 0) return [node.slug];
  return node.children.flatMap(collectDescendantSlugs);
}

// ─── component ──────────────────────────────────────────────────────────────

export function HierarchicalCategoryMenu({
  tree,
  unclassifiedCount = 0,
  countsBySlag = {},
  totalCount,
  selectedSlugs,
  onChange,
  className,
}: HierarchicalCategoryMenuProps) {
  const [activeParent, setActiveParent] = useState<AssessmentCategoryTreeNode | null>(null);
  const [sliding, setSliding] = useState<'in' | 'out' | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = (slug: string) => {
    onChange(
      selectedSlugs.includes(slug)
        ? selectedSlugs.filter((s) => s !== slug)
        : [...selectedSlugs, slug],
    );
  };

  const drillInto = (parent: AssessmentCategoryTreeNode) => {
    setSliding('in');
    setActiveParent(parent);
  };

  const drillOut = () => {
    setSliding('out');
    setTimeout(() => {
      setActiveParent(null);
      setSliding(null);
    }, 220);
  };

  // reset animation class after transition
  useEffect(() => {
    if (sliding === 'in') {
      const t = setTimeout(() => setSliding(null), 220);
      return () => clearTimeout(t);
    }
  }, [sliding]);

  // ── root-level items ──────────────────────────────────────────────────────
  const parents = tree.filter((n) => n.children.length > 0);
  const orphans = tree.filter((n) => n.children.length === 0);

  const renderRoot = () => (
    <div className='space-y-0.5'>
      {/* All categories */}
      <RootItem
        label='All categories'
        count={totalCount}
        active={selectedSlugs.length === 0}
        onClick={() => onChange([])}
      />

      {/* Unclassified */}
      <RootItem
        label='Unclassified'
        count={unclassifiedCount}
        active={selectedSlugs.includes('unclassified')}
        onClick={() => toggle('unclassified')}
      />

      {parents.length > 0 && (
        <div className='my-2 border-t border-border/60' />
      )}

      {/* Parent groups */}
      {parents.map((parent) => {
        const childSlugs = collectDescendantSlugs(parent);
        const selectedCount = childSlugs.filter((s) => selectedSlugs.includes(s)).length;
        const totalInGroup = childSlugs.reduce((a, s) => a + (countsBySlag[s] ?? 0), 0);
        return (
          <GroupItem
            key={parent.slug}
            label={parent.name}
            count={totalInGroup || undefined}
            selectedCount={selectedCount}
            onClick={() => drillInto(parent)}
          />
        );
      })}

      {/* Orphan leaf categories (no parent group) */}
      {orphans.length > 0 && (
        <div className='my-2 border-t border-border/60' />
      )}
      {orphans.map((cat) => (
        <LeafItem
          key={cat.slug}
          label={cat.name}
          count={countsBySlag[cat.slug]}
          selected={selectedSlugs.includes(cat.slug)}
          onClick={() => toggle(cat.slug)}
        />
      ))}
    </div>
  );

  // ── child panel ───────────────────────────────────────────────────────────
  const renderChildren = (parent: AssessmentCategoryTreeNode) => {
    const childSlugs = parent.children.map((c) => c.slug);
    const allSelected = childSlugs.every((s) => selectedSlugs.includes(s));
    const noneSelected = childSlugs.every((s) => !selectedSlugs.includes(s));

    const toggleAll = () => {
      if (allSelected) {
        onChange(selectedSlugs.filter((s) => !childSlugs.includes(s)));
      } else {
        const next = new Set(selectedSlugs);
        childSlugs.forEach((s) => next.add(s));
        onChange([...next]);
      }
    };

    return (
      <div className='space-y-0.5'>
        {/* Back button */}
        <button
          type='button'
          onClick={drillOut}
          className='flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <ChevronLeft className='h-3.5 w-3.5 shrink-0' />
          <span>All categories</span>
        </button>

        {/* Group heading */}
        <div className='px-2 pb-1 pt-2'>
          <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
            {parent.name}
          </p>
        </div>

        {/* Select-all shortcut */}
        <button
          type='button'
          onClick={toggleAll}
          className={cn(
            'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors',
            !noneSelected && !allSelected
              ? 'text-primary/80 hover:bg-primary/5'
              : allSelected
                ? 'bg-primary/10 font-medium text-primary'
                : 'hover:bg-muted',
          )}
        >
          <span>All in {parent.name}</span>
          {allSelected && <Check className='h-3 w-3 shrink-0' />}
        </button>

        <div className='my-1 border-t border-border/60' />

        {/* Children */}
        {parent.children.map((child) => (
          <LeafItem
            key={child.slug}
            label={child.name}
            count={countsBySlag[child.slug]}
            selected={selectedSlugs.includes(child.slug)}
            onClick={() => toggle(child.slug)}
          />
        ))}
      </div>
    );
  };

  // ── panel transition ──────────────────────────────────────────────────────
  const panelClass = cn(
    'w-full transition-transform duration-200 ease-in-out',
    sliding === 'in' && 'animate-slide-in-left',
    sliding === 'out' && 'animate-slide-out-right',
  );

  return (
    <div ref={panelRef} className={cn('overflow-hidden', className)}>
      <div className={panelClass}>
        {activeParent ? renderChildren(activeParent) : renderRoot()}
      </div>
    </div>
  );
}

// ─── sub-row atoms ───────────────────────────────────────────────────────────

function RootItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
      )}
    >
      <span className='truncate'>{label}</span>
      {typeof count === 'number' && (
        <span className={cn('ml-2 shrink-0 text-xs', active ? 'text-primary/70' : 'text-muted-foreground')}>
          {count}
        </span>
      )}
    </button>
  );
}

function GroupItem({
  label,
  count,
  selectedCount,
  onClick,
}: {
  label: string;
  count?: number;
  selectedCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
        selectedCount > 0 ? 'bg-primary/5 text-primary' : 'hover:bg-muted',
      )}
    >
      <span className='truncate font-medium'>{label}</span>
      <span className='flex shrink-0 items-center gap-1.5'>
        {selectedCount > 0 && (
          <span className='inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground'>
            {selectedCount}
          </span>
        )}
        {typeof count === 'number' && selectedCount === 0 && (
          <span className='text-xs text-muted-foreground'>{count}</span>
        )}
        <ChevronRight className='h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5' />
      </span>
    </button>
  );
}

function LeafItem({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
        selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
      )}
    >
      <span className='flex items-center gap-2 truncate'>
        <span
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
            selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
          )}
        >
          {selected && <Check className='h-2.5 w-2.5 text-primary-foreground' />}
        </span>
        <span className='truncate'>{label}</span>
      </span>
      {typeof count === 'number' && (
        <span className={cn('ml-2 shrink-0 text-xs', selected ? 'text-primary/70' : 'text-muted-foreground')}>
          {count}
        </span>
      )}
    </button>
  );
}
