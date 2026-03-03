'use client';

import { useState } from 'react';
import { X, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { IR_DEFAULT_COLUMNS, IR_COLUMN_LABELS } from '@/lib/constants';

const COLUMN_DESCRIPTIONS: Record<string, string> = {
  service: 'Name of the logical service',
  env: 'Environment (UAT or PROD)',
  dc: 'Datacenter / location',
  network: 'Network zone (Private / Public / Hybrid)',
  type: 'Service type (HTTP API, Database, Broker…)',
  endpoint: 'Primary computed endpoint (FQDN:port)',
  status: 'Connection status (Active / Draft / Disabled)',
  updated: 'Last changed — who and when',
  actions: 'Row action buttons (always shown)',
};

interface ColumnPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibleColumns: string[];
  onApply: (columns: string[]) => void;
}

export function ColumnPicker({ open, onOpenChange, visibleColumns, onApply }: ColumnPickerProps) {
  const [selected, setSelected] = useState<string[]>(visibleColumns);
  const [search, setSearch] = useState('');

  if (!open) return null;

  const allColumns = [...IR_DEFAULT_COLUMNS];
  const filtered = allColumns.filter((col) => {
    const q = search.toLowerCase();
    return (
      col.toLowerCase().includes(q) ||
      (IR_COLUMN_LABELS[col] || '').toLowerCase().includes(q) ||
      (COLUMN_DESCRIPTIONS[col] || '').toLowerCase().includes(q)
    );
  });

  const toggle = (col: string) => {
    if (col === 'actions') return; // always visible
    setSelected((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const handleApply = () => {
    // Always keep 'actions'
    const result = selected.includes('actions') ? selected : [...selected, 'actions'];
    onApply(result);
    onOpenChange(false);
  };

  const handleReset = () => {
    setSelected([...IR_DEFAULT_COLUMNS]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Column Picker</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which columns to show in the Connections grid.
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b">
          <input
            type="text"
            placeholder="Search columns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Column list */}
        <div className="px-5 py-3 max-h-72 overflow-y-auto">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.map((col) => {
              const isChecked = col === 'actions' || selected.includes(col);
              const isLocked = col === 'actions';
              return (
                <label
                  key={col}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    isChecked
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border hover:bg-muted/30'
                  } ${isLocked ? 'opacity-60 cursor-default' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(col)}
                    disabled={isLocked}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight">
                      {IR_COLUMN_LABELS[col] || col}
                    </div>
                    {COLUMN_DESCRIPTIONS[col] && (
                      <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                        {COLUMN_DESCRIPTIONS[col]}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No columns match your search.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-5 py-4">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
