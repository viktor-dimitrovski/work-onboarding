'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type CreatableConfig = {
  enabled: boolean;
  placeholder?: string;
  actionLabel?: string;
  onCreate: (label: string) => void | Promise<void>;
};

export function SingleSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable = true,
  className,
  creatable,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  creatable?: CreatableConfig;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 800;
      const availableBelowRaw = viewportHeight - rect.bottom - 12;
      const availableAboveRaw = rect.top - 12;
      const openAbove = availableBelowRaw < 220 && availableAboveRaw > availableBelowRaw;
      const available = Math.max(120, openAbove ? availableAboveRaw : availableBelowRaw);
      const maxHeight = Math.min(360, available);
      const top = openAbove ? Math.max(12, rect.top - 6 - maxHeight) : rect.bottom + 6;
      setMenuStyle({ top, left: rect.left, width: rect.width, maxHeight });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);

  const canCreateFromSearch = !!creatable?.enabled && query.trim().length > 0 && filtered.length === 0;
  const listScrollable = filtered.length > 8 || (canCreateFromSearch && filtered.length > 6);

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        type='button'
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-white px-3 text-sm',
          open ? 'ring-2 ring-primary/15' : 'hover:border-muted-foreground/40',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && menuStyle
        ? createPortal(
        <div
          ref={menuRef}
          className='fixed z-[80] overflow-hidden rounded-md border bg-white shadow-soft'
          style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className='flex items-center justify-between border-b bg-muted/20 px-2 py-2'>
            <p className='text-xs font-medium text-muted-foreground'>Select</p>
            <Button type='button' size='sm' variant='outline' onClick={close} className='h-8'>
              Done
            </Button>
          </div>

          {searchable && (
            <div className='border-b bg-muted/10 p-2'>
              <div className='relative'>
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='Search…'
                  className='h-9 pr-9'
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canCreateFromSearch) {
                      e.preventDefault();
                      const text = query.trim();
                      if (!text) return;
                      void creatable?.onCreate(text);
                      setQuery('');
                    }
                  }}
                />
                {query && (
                  <button
                    type='button'
                    className='absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted'
                    onClick={() => setQuery('')}
                    aria-label='Clear search'
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            className={cn('py-1', listScrollable && 'overflow-auto')}
            style={listScrollable ? { maxHeight: menuStyle.maxHeight } : undefined}
          >
            {filtered.length === 0 ? (
              canCreateFromSearch ? null : <p className='px-3 py-2 text-xs text-muted-foreground'>No results</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type='button'
                    disabled={opt.disabled}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      opt.disabled && 'cursor-not-allowed opacity-60',
                      isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/30',
                    )}
                    onClick={() => {
                      onChange(opt.value);
                      close();
                    }}
                  >
                    <span className='inline-flex h-4 w-4 items-center justify-center'>
                      {isSelected ? <Check className='h-4 w-4' /> : null}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {canCreateFromSearch && (
            <div className='border-t bg-muted/10 p-2'>
              <Button
                type='button'
                variant='secondary'
                className='h-9 w-full justify-start'
                onClick={() => {
                  const text = query.trim();
                  if (!text) return;
                  void creatable?.onCreate(text);
                  setQuery('');
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add “{query.trim()}”
              </Button>
              <p className='mt-2 text-[11px] text-muted-foreground'>
                Added items are saved to tenant settings.
              </p>
            </div>
          )}
        </div>,
        document.body,
          )
        : null}
    </div>
  );
}

