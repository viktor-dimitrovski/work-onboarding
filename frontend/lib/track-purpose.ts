import { useEffect, useMemo, useState } from 'react';

export type TrackPurposeItem = { value: string; label: string };

const STORAGE_KEY = 'onboarding:track-purpose-labels';
const LABELS_UPDATED_EVENT = 'onboarding:track-purpose-labels-updated';

const DEFAULT_ITEMS: TrackPurposeItem[] = [
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'both', label: 'Onboarding + Assessment' },
];

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'custom';
}

function loadStoredItems(): TrackPurposeItem[] {
  if (typeof window === 'undefined') return DEFAULT_ITEMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ITEMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ITEMS;
    return parsed
      .filter((x): x is { value?: string; label?: string } => x && typeof x === 'object')
      .map((x) => ({
        value: typeof x.value === 'string' && x.value.trim() ? slugify(x.value.trim()) : 'custom',
        label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : 'Custom',
      }))
      .filter((item, i, arr) => arr.findIndex((t) => t.value === item.value) === i);
  } catch {
    return DEFAULT_ITEMS;
  }
}

function saveStoredItems(items: TrackPurposeItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(LABELS_UPDATED_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function useTrackPurposeLabels() {
  const [items, setItems] = useState<TrackPurposeItem[]>(DEFAULT_ITEMS);

  useEffect(() => {
    const load = () => setItems(loadStoredItems());
    load();
    window.addEventListener(LABELS_UPDATED_EVENT, load);
    return () => window.removeEventListener(LABELS_UPDATED_EVENT, load);
  }, []);

  const options = useMemo(
    () => items.map(({ value, label }) => ({ value, label })),
    [items],
  );

  const values = useMemo(() => items.map((i) => i.value), [items]);

  const getLabel = useMemo(
    () => (value: string | undefined) => {
      if (!value) return items[0]?.label ?? 'Onboarding';
      const found = items.find((i) => i.value === value);
      return found?.label ?? value;
    },
    [items],
  );

  const updateItems = (next: TrackPurposeItem[]) => {
    const valid = next.filter((i) => i.value.trim() && i.label.trim());
    if (valid.length === 0) return;
    setItems(valid);
    saveStoredItems(valid);
  };

  const addPurpose = (label: string) => {
    const base = slugify(label) || 'custom';
    let value = base;
    let n = 0;
    while (items.some((i) => i.value === value)) {
      value = `${base}-${++n}`;
    }
    updateItems([...items, { value, label: label.trim() || value }]);
  };

  const removePurpose = (value: string) => {
    if (items.length <= 1) return;
    updateItems(items.filter((i) => i.value !== value));
  };

  const updateLabel = (value: string, label: string) => {
    const idx = items.findIndex((i) => i.value === value);
    if (idx < 0) return;
    const next = [...items];
    next[idx] = { ...next[idx], label: label.trim() || next[idx].label };
    updateItems(next);
  };

  const updateValue = (oldValue: string, newValue: string) => {
    const slug = slugify(newValue) || 'custom';
    if (items.some((i) => i.value === slug && i.value !== oldValue)) return;
    const idx = items.findIndex((i) => i.value === oldValue);
    if (idx < 0) return;
    const next = [...items];
    next[idx] = { ...next[idx], value: slug };
    updateItems(next);
  };

  const resetItems = () => {
    setItems(DEFAULT_ITEMS);
    saveStoredItems(DEFAULT_ITEMS);
  };

  return {
    items,
    options,
    values,
    getLabel,
    addPurpose,
    removePurpose,
    updateLabel,
    updateValue,
    resetItems,
    defaultItems: DEFAULT_ITEMS,
  };
}
