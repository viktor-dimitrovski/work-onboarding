import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function ModuleLockedBanner({
  isLocked,
  title = 'Module is locked',
  description = 'Encryption key is not loaded. Some data is hidden until an admin unlocks it.',
  settingsHref,
}: {
  isLocked: boolean;
  title?: string;
  description?: string;
  settingsHref: string;
}) {
  if (!isLocked) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3">
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-amber-800 mt-0.5">{description}</div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href={settingsHref}>Go to Settings</Link>
      </Button>
    </div>
  );
}
