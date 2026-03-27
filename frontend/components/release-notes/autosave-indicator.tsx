'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  state: SaveState;
  lastSavedAt?: Date | null;
  onRetry?: () => void;
};

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  return `${mins}m ago`;
}

export function AutosaveIndicator({ state, lastSavedAt, onRetry }: Props) {
  if (state === 'idle') return null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {state === 'saving' && (
        <>
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          Saving…
        </>
      )}
      {state === 'saved' && (
        <>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {lastSavedAt ? `Saved ${relativeTime(lastSavedAt)}` : 'Saved'}
        </>
      )}
      {state === 'error' && (
        <>
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-red-600">Save failed</span>
          {onRetry && (
            <Button variant="outline" size="sm" className="h-5 px-2 text-[10px]" onClick={onRetry}>
              Retry
            </Button>
          )}
        </>
      )}
    </span>
  );
}
