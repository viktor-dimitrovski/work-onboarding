'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void;
  trigger?: React.ReactNode;
  /** When set, dialog is controlled by open/onOpenChange instead of trigger */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmText,
  onConfirm,
  trigger,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal>
      {trigger != null && (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 bg-slate-950/40' />
        <DialogPrimitive.Content className='fixed left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-soft'>
          <DialogPrimitive.Title className='text-lg font-semibold'>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className='mt-2 text-sm text-muted-foreground'>
            {description}
          </DialogPrimitive.Description>
          <div className='mt-5 flex justify-end gap-2'>
            <DialogPrimitive.Close asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Close asChild>
              <Button variant='destructive' onClick={onConfirm}>
                {confirmText}
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
