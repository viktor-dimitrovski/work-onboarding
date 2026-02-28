"use client";

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ServiceTouchedItem = {
  service_id: string;
  repo?: string | null;
  change_type?: string | null;
  requires_deploy?: boolean;
  requires_db_migration?: boolean;
  requires_config_change?: boolean;
  feature_flags?: string[];
  release_notes_ref?: string | null;
};

type ServicesTouchedGridProps = {
  items: ServiceTouchedItem[];
  onChange: (items: ServiceTouchedItem[]) => void;
  firstInputId?: string;
};

const emptyRow = (): ServiceTouchedItem => ({
  service_id: '',
  repo: '',
  change_type: '',
  requires_deploy: false,
  requires_db_migration: false,
  requires_config_change: false,
  feature_flags: [],
  release_notes_ref: '',
});

const changeTypeOptions = ['feature', 'bugfix', 'config', 'infra', 'docs'] as const;

function FeatureFlagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'>
      {value.map((flag) => (
        <span key={flag} className='flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
          {flag}
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground'
            onClick={() => onChange(value.filter((item) => item !== flag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className='h-6 flex-1 bg-transparent text-xs outline-none'
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.currentTarget.value.trim();
            if (input) {
              onChange([...value, input]);
              event.currentTarget.value = '';
            }
          } else if (event.key === 'Backspace' && event.currentTarget.value === '') {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

export function ServicesTouchedGrid({ items, onChange, firstInputId }: ServicesTouchedGridProps) {
  const rows = useMemo(() => (items.length === 0 ? [emptyRow()] : items), [items]);

  const updateRow = (index: number, patch: Partial<ServiceTouchedItem>) => {
    const next = rows.map((row, idx) => (idx === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRowAfter = (index: number) => {
    const next = [...rows.slice(0, index + 1), emptyRow(), ...rows.slice(index + 1)];
    onChange(next);
  };

  const duplicateRow = (index: number) => {
    const copy = { ...rows[index] };
    const next = [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
    onChange(next);
  };

  const removeRow = (index: number) => {
    if (rows.length === 1) {
      onChange([emptyRow()]);
      return;
    }
    onChange(rows.filter((_, idx) => idx !== index));
  };

  const handleGridKey = (event: React.KeyboardEvent, index: number) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      addRowAfter(index);
    }
    if (event.ctrlKey && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault();
      duplicateRow(index);
    }
    if (event.ctrlKey && event.key === 'Backspace') {
      event.preventDefault();
      removeRow(index);
    }
  };

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-semibold'>Services touched</p>
        <Button type='button' variant='outline' size='sm' onClick={() => onChange([...rows, emptyRow()])}>
          Add row
        </Button>
      </div>
      <div className='rounded-md border'>
        <div className='grid grid-cols-[1.2fr_1fr_130px_repeat(3,90px)_1.2fr_1fr_60px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground'>
          <div>Service</div>
          <div>Repo</div>
          <div>Change</div>
          <div>Deploy</div>
          <div>DB</div>
          <div>Config</div>
          <div>Feature flags</div>
          <div>Release notes</div>
          <div className='text-right'>Actions</div>
        </div>
        {rows.map((row, index) => (
          <div
            key={`service-${index}`}
            className={cn(
              'grid grid-cols-[1.2fr_1fr_130px_repeat(3,90px)_1.2fr_1fr_60px] gap-2 px-3 py-2',
              index % 2 === 1 && 'bg-muted/20',
            )}
          >
            <Input
              value={row.service_id}
              id={index === 0 ? firstInputId : undefined}
              onChange={(event) => updateRow(index, { service_id: event.target.value })}
              onKeyDown={(event) => handleGridKey(event, index)}
              placeholder='classification-engine'
            />
            <Input
              value={row.repo ?? ''}
              onChange={(event) => updateRow(index, { repo: event.target.value })}
              onKeyDown={(event) => handleGridKey(event, index)}
              placeholder='org/repo'
            />
            <select
              className='h-10 w-full rounded-md border border-input bg-white px-3 text-xs'
              value={row.change_type ?? ''}
              onChange={(event) => updateRow(index, { change_type: event.target.value })}
              onKeyDown={(event) => handleGridKey(event, index)}
            >
              <option value=''>—</option>
              {changeTypeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={Boolean(row.requires_deploy)}
                onChange={(event) => updateRow(index, { requires_deploy: event.target.checked })}
                onKeyDown={(event) => handleGridKey(event, index)}
              />
              deploy
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={Boolean(row.requires_db_migration)}
                onChange={(event) => updateRow(index, { requires_db_migration: event.target.checked })}
                onKeyDown={(event) => handleGridKey(event, index)}
              />
              db
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={Boolean(row.requires_config_change)}
                onChange={(event) => updateRow(index, { requires_config_change: event.target.checked })}
                onKeyDown={(event) => handleGridKey(event, index)}
              />
              config
            </label>
            <FeatureFlagsInput
              value={row.feature_flags ?? []}
              onChange={(flags) => updateRow(index, { feature_flags: flags })}
              placeholder='flag-a, flag-b'
            />
            <Input
              value={row.release_notes_ref ?? ''}
              onChange={(event) => updateRow(index, { release_notes_ref: event.target.value })}
              onKeyDown={(event) => handleGridKey(event, index)}
              placeholder='https://...'
            />
            <div className='flex items-center justify-end gap-2 text-xs'>
              <Button type='button' variant='ghost' size='sm' onClick={() => addRowAfter(index)}>
                +
              </Button>
              <Button type='button' variant='ghost' size='sm' onClick={() => removeRow(index)}>
                ×
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className='text-xs text-muted-foreground'>
        Shortcuts: Ctrl+Enter add row, Ctrl+D duplicate, Ctrl+Backspace delete.
      </p>
    </div>
  );
}
