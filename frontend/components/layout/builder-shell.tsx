import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface BuilderShellProps {
  main: React.ReactNode;
  workspace: React.ReactNode;
  workspaceLabel?: string;
}

export function BuilderShell({ main, workspace, workspaceLabel = 'Workspace' }: BuilderShellProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-end md:hidden'>
        <Button variant='outline' size='sm' onClick={() => setWorkspaceOpen(true)}>
          {workspaceLabel}
        </Button>
      </div>
      <div className='grid gap-6 md:grid-cols-12'>
        <div className='space-y-6 md:col-span-8'>{main}</div>
        <div className='hidden space-y-6 md:col-span-4 md:sticky md:top-20 md:self-start md:block'>
          {workspace}
        </div>
      </div>

      <Sheet open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <SheetContent side='right' className='w-[92vw] max-w-xl'>
          {workspace}
        </SheetContent>
      </Sheet>
    </div>
  );
}
