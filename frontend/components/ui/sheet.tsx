"use client";

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-slate-950/40',
      'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'top' | 'bottom' | 'left' | 'right';
    hideCloseButton?: boolean;
  }
>(({ className, side = 'right', hideCloseButton = false, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 bg-white shadow-soft overflow-hidden',
        // Left panel: slides in from left, out to left
        side === 'left' && [
          'left-0 top-0 h-full w-[92vw] max-w-xl border-r p-6',
          'data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
        ],
        // Right panel: slides in from right, out to right
        side === 'right' && [
          'right-0 top-0 h-full w-[92vw] max-w-xl border-l p-6',
          'data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
        ],
        // Top panel
        side === 'top' && [
          'left-0 top-0 w-full border-b p-6',
          'data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top',
        ],
        // Bottom panel
        side === 'bottom' && [
          'left-0 bottom-0 w-full border-t p-6',
          'data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom',
        ],
        className,
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close className='absolute right-4 top-4 rounded-sm opacity-70 transition hover:opacity-100'>
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2', className)} {...props} />;
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
