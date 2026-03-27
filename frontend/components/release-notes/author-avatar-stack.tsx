'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type Author = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
};

type Props = {
  authors: Author[];
  canWrite: boolean;
  maxVisible?: number;
  onRemove?: (userId: string) => void;
};

function initials(author: Author): string {
  if (author.full_name) {
    return author.full_name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
  return (author.email?.[0] ?? '?').toUpperCase();
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
];

function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function AuthorAvatarStack({ authors, canWrite, maxVisible = 3, onRemove }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const visible = authors.slice(0, maxVisible);
  const overflow = authors.length - maxVisible;

  return (
    <div className="flex items-center gap-1">
      <div className="flex -space-x-1.5">
        {visible.map((author) => (
          <div
            key={author.user_id}
            className="relative"
            onMouseEnter={() => setHoveredId(author.user_id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white ring-0 transition-transform hover:z-10 hover:scale-110',
                colorFor(author.user_id),
              )}
              title={author.full_name ?? author.email ?? author.user_id}
            >
              {initials(author)}
            </div>
            {canWrite && onRemove && hoveredId === author.user_id && (
              <button
                onClick={() => onRemove(author.user_id)}
                className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white transition-opacity"
                title="Remove author"
              >
                <X className="h-2 w-2" />
              </button>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-600">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
