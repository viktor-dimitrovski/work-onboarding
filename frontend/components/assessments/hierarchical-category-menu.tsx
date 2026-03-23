'use client';

/**
 * HierarchicalCategoryMenu
 *
 * Infinite-depth sliding panel for category navigation.
 *
 * Navigation state is a breadcrumb stack (path). Each entry in the stack is
 * an AssessmentCategoryTreeNode. The currently-visible panel renders the
 * children of path[path.length - 1], or the root tree when path is empty.
 *
 * Nodes that have children → GroupItem (chevron, drill-in)
 * Nodes that have no children → LeafItem (checkbox, toggle)
 *
 * Multi-select is supported via selectedSlugs.
 */

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { AssessmentCategoryTreeNode } from '@/lib/types';

export interface HierarchicalCategoryMenuProps {
  /** Tree returned from GET /assessments/categories/tree */
  tree: AssessmentCategoryTreeNode[];
  /** Count for "Unclassified" bucket */
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

/** Collect all leaf slugs beneath (and including) a node. */
function collectLeafSlugs(node: AssessmentCategoryTreeNode): string[] {
  if (node.children.length === 0) return [node.slug];
  return node.children.flatMap(collectLeafSlugs);
}

/** Sum question counts for all leaves under a node. */
function countForNode(node: AssessmentCategoryTreeNode, counts: Record<string, number>): number {
  return collectLeafSlugs(node).reduce((a, s) => a + (counts[s] ?? 0), 0);
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
  // Breadcrumb stack – each entry is the node whose children are currently shown.
  const [path, setPath] = useState<AssessmentCategoryTreeNode[]>([]);
  const [sliding, setSliding] = useState<'in' | 'out' | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = (slug: string) => {
    onChange(
      selectedSlugs.includes(slug)
        ? selectedSlugs.filter((s) => s !== slug)
        : [...selectedSlugs, slug],
    );
  };

  const drillInto = (node: AssessmentCategoryTreeNode) => {
    setSliding('in');
    setPath((p) => [...p, node]);
  };

  const drillOut = () => {
    setSliding('out');
    setTimeout(() => {
      setPath((p) => p.slice(0, -1));
      setSliding(null);
    }, 200);
  };

  // Clear 'in' animation flag after transition
  useEffect(() => {
    if (sliding === 'in') {
      const t = setTimeout(() => setSliding(null), 200);
      return () => clearTimeout(t);
    }
  }, [sliding]);

  // The children to display at the current level
  const currentNode = path.length > 0 ? path[path.length - 1] : null;
  const currentChildren: AssessmentCategoryTreeNode[] = currentNode ? currentNode.children : tree;

  // ── root panel (path is empty) ────────────────────────────────────────────
  const renderRoot = () => {
    const parents = tree.filter((n) => n.children.length > 0);
    const orphans = tree.filter((n) => n.children.length === 0);

    return (
      <div className='space-y-0.5'>
        <RootItem
          label='All categories'
          count={totalCount}
          active={selectedSlugs.length === 0}
          onClick={() => onChange([])}
        />
        <RootItem
          label='Unclassified'
          count={unclassifiedCount}
          active={selectedSlugs.includes('unclassified')}
          onClick={() => toggle('unclassified')}
        />

        {parents.length > 0 && <div className='my-2 border-t border-border/60' />}

        {parents.map((node) => {
          const leafSlugs = collectLeafSlugs(node);
          const selCount = leafSlugs.filter((s) => selectedSlugs.includes(s)).length;
          const total = countForNode(node, countsBySlag);
          return (
            <GroupItem
              key={node.slug}
              label={node.name}
              count={total || undefined}
              selectedCount={selCount}
              onClick={() => drillInto(node)}
            />
          );
        })}

        {orphans.length > 0 && <div className='my-2 border-t border-border/60' />}
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
  };

  // ── deep panel (path is non-empty) ────────────────────────────────────────
  const renderDeep = () => {
    if (!currentNode) return null;

    const leafSlugs = currentChildren.flatMap(collectLeafSlugs);
    const allSelected = leafSlugs.length > 0 && leafSlugs.every((s) => selectedSlugs.includes(s));
    const noneSelected = leafSlugs.every((s) => !selectedSlugs.includes(s));

    const toggleAll = () => {
      if (allSelected) {
        onChange(selectedSlugs.filter((s) => !leafSlugs.includes(s)));
      } else {
        const next = new Set(selectedSlugs);
        leafSlugs.forEach((s) => next.add(s));
        onChange([...next]);
      }
    };

    // Breadcrumb label: last two levels for context
    const breadcrumb = path.map((n) => n.name).join(' › ');

    return (
      <div className='space-y-0.5'>
        {/* Back */}
        <button
          type='button'
          onClick={drillOut}
          className='flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <ChevronLeft className='h-3.5 w-3.5 shrink-0' />
          <span>{path.length > 1 ? path[path.length - 2].name : 'All categories'}</span>
        </button>

        {/* Group heading / breadcrumb */}
        <div className='px-2 pb-1 pt-2'>
          <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
            {breadcrumb}
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
          <span>All in {currentNode.name}</span>
          {allSelected && <Check className='h-3 w-3 shrink-0' />}
        </button>

        <div className='my-1 border-t border-border/60' />

        {/* Children — group if they have children, leaf otherwise */}
        {currentChildren.map((child) =>
          child.children.length > 0 ? (
            <GroupItem
              key={child.slug}
              label={child.name}
              count={countForNode(child, countsBySlag) || undefined}
              selectedCount={collectLeafSlugs(child).filter((s) => selectedSlugs.includes(s)).length}
              onClick={() => drillInto(child)}
            />
          ) : (
            <LeafItem
              key={child.slug}
              label={child.name}
              count={countsBySlag[child.slug]}
              selected={selectedSlugs.includes(child.slug)}
              onClick={() => toggle(child.slug)}
            />
          ),
        )}
      </div>
    );
  };

  const panelClass = cn(
    'w-full transition-transform duration-200 ease-in-out',
    sliding === 'in' && 'animate-slide-in-left',
    sliding === 'out' && 'animate-slide-out-right',
  );

  return (
    <div ref={panelRef} className={cn('overflow-hidden', className)}>
      <div className={panelClass}>
        {path.length === 0 ? renderRoot() : renderDeep()}
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
