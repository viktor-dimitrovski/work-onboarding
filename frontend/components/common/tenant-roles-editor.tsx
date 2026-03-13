'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { roleDisplayName, tenantRoleGroups } from '@/lib/constants';

export function TenantRolesEditor({
  value,
  onChange,
  disabled,
  enabledModules,
  callerRoles,
  title,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  enabledModules?: string[];
  callerRoles?: string[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>([]);

  const safeValue = value.length ? value : [];
  const modules = enabledModules ? new Set(enabledModules) : null;
  const callerSet = callerRoles ? new Set(callerRoles) : null;
  const visibleGroups = tenantRoleGroups
    .filter((g) => g.moduleKey === null || !modules || modules.has(g.moduleKey))
    .map((g) => {
      if (!callerSet) return g;
      return { ...g, roles: g.roles.filter((r) => r === 'tenant_admin' || callerSet.has(r)) };
    })
    .filter((g) => g.roles.length > 0);

  const handleOpen = () => {
    setPending(safeValue);
    setOpen(true);
  };

  const handleSave = () => {
    onChange(pending);
    setOpen(false);
  };

  const handleClose = () => setOpen(false);

  const toggleRole = (role: string, checked: boolean) => {
    if (checked) {
      setPending((prev) => Array.from(new Set([...prev, role])));
    } else {
      setPending((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r !== role)));
    }
  };

  const toggleGroup = (group: { roles: string[] }) => {
    const allSelected = group.roles.every((r) => pending.includes(r));
    if (allSelected) {
      const next = pending.filter((r) => !group.roles.includes(r));
      if (next.length === 0) return;
      setPending(next);
    } else {
      setPending((prev) => Array.from(new Set([...prev, ...group.roles])));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetTrigger asChild>
        <Button type='button' size='sm' variant='outline' disabled={disabled} onClick={handleOpen}>
          Roles ({safeValue.length})
        </Button>
      </SheetTrigger>
      <SheetContent side='right' className='flex flex-col p-0 w-[400px] sm:w-[440px]'>
        <SheetHeader className='px-5 pt-5 pb-4 border-b shrink-0'>
          <SheetTitle className='text-base'>Assign Roles</SheetTitle>
          {title && (
            <SheetDescription className='text-xs truncate'>{title}</SheetDescription>
          )}
        </SheetHeader>

        {pending.length > 0 && (
          <div className='px-5 py-3 border-b bg-muted/30 shrink-0'>
            <p className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
              Selected ({pending.length})
            </p>
            <div className='flex flex-wrap gap-1.5'>
              {pending.map((r) => (
                <span
                  key={r}
                  className='inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[11px] font-medium text-primary'
                >
                  {roleDisplayName(r)}
                  <button
                    type='button'
                    onClick={() => toggleRole(r, false)}
                    disabled={pending.length <= 1}
                    className='ml-0.5 rounded-full p-0.5 hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed'
                    aria-label={`Remove ${roleDisplayName(r)}`}
                  >
                    <X className='h-2.5 w-2.5' />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className='flex-1 min-h-0'>
          <div className='px-5 py-4 space-y-6'>
            {visibleGroups.map((group) => {
              const selectedInGroup = group.roles.filter((r) => pending.includes(r));
              const allChecked = selectedInGroup.length === group.roles.length;
              const someChecked = selectedInGroup.length > 0 && !allChecked;
              return (
                <div key={group.label}>
                  <div className='mb-2 flex items-center justify-between'>
                    <label className='flex cursor-pointer items-center gap-2'>
                      <input
                        type='checkbox'
                        className='h-3.5 w-3.5 accent-primary'
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked; }}
                        onChange={() => toggleGroup(group)}
                      />
                      <span className='text-sm font-semibold'>{group.label}</span>
                    </label>
                    {selectedInGroup.length > 0 && (
                      <span className='rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'>
                        {selectedInGroup.length}/{group.roles.length}
                      </span>
                    )}
                  </div>
                  <div className='ml-5 space-y-0.5'>
                    {group.roles.map((role) => (
                      <label
                        key={role}
                        className='flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60 transition-colors'
                      >
                        <input
                          type='checkbox'
                          className='h-3.5 w-3.5 accent-primary shrink-0'
                          checked={pending.includes(role)}
                          onChange={(e) => toggleRole(role, e.target.checked)}
                        />
                        <span className='text-sm'>{roleDisplayName(role)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className='shrink-0 border-t px-5 py-4 flex items-center justify-between gap-3'>
          <span className='text-sm text-muted-foreground'>
            {pending.length} role{pending.length !== 1 ? 's' : ''} selected
          </span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={handleClose}>Cancel</Button>
            <Button size='sm' onClick={handleSave} disabled={pending.length === 0}>Save</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
