'use client';

import { cn } from '@/lib/utils';
import { ChecklistItem, type RunItem, type RunItemStatus } from './checklist-item';

type Props = {
  groupKey: string;
  groupLabel: string;
  items: RunItem[];
  onUpdate: (itemId: string, status: RunItemStatus, notes?: string) => Promise<void>;
  readOnly?: boolean;
};

export function ChecklistGroup({ groupLabel, items, onUpdate, readOnly }: Props) {
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const blocked = items.filter((i) => i.status === 'blocked').length;
  const allDone = done === total;
  const hasBlocked = blocked > 0;

  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <div className={cn(
        'flex items-center gap-3 px-4 py-2.5 border-b',
        allDone ? 'bg-emerald-50' : hasBlocked ? 'bg-red-50' : 'bg-slate-50',
      )}>
        <span className="font-medium text-sm flex-1">{groupLabel}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {hasBlocked && (
            <span className="text-red-600 font-medium">{blocked} blocked</span>
          )}
          <span className={cn(
            'font-semibold tabular-nums',
            allDone ? 'text-emerald-600' : hasBlocked ? 'text-red-600' : 'text-slate-600',
          )}>
            {done}/{total}
          </span>
          <span>{allDone ? '✅' : hasBlocked ? '⚠️' : '⏳'}</span>
        </div>
      </div>
      <div>
        {items.map((item) => (
          <ChecklistItem
            key={item.id}
            item={item}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}
