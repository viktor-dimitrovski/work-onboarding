import { Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className='flex min-h-[160px] items-center justify-center gap-2 text-sm text-muted-foreground'>
      <Loader2 className='h-4 w-4 animate-spin' />
      <span>{label}</span>
    </div>
  );
}
