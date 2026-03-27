'use client';

import { cn } from '@/lib/utils';
import { getTypeMeta } from '@/lib/release-note-types';

type Props = {
  type: string;
  size?: 'sm' | 'md';
  showIcon?: boolean;
};

export function ItemTypeBadge({ type, size = 'md', showIcon = true }: Props) {
  const meta = getTypeMeta(type);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        meta.badge,
      )}
    >
      {showIcon && <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />}
      {meta.label}
    </span>
  );
}
