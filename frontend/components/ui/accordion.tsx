'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = AccordionPrimitive.Item;

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className='flex'>
      <AccordionPrimitive.Trigger
        className={cn(
          'flex flex-1 items-center justify-between py-3 text-left text-sm font-medium transition-all hover:text-primary',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className='h-4 w-4 shrink-0 transition-transform duration-200 [&[data-state=open]]:rotate-180' />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className={cn('overflow-hidden text-sm data-[state=closed]:animate-none data-[state=open]:animate-fade-up', className)}
      {...props}
    >
      <div className='pb-3'>{children}</div>
    </AccordionPrimitive.Content>
  );
}
