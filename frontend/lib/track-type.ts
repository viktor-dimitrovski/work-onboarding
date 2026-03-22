import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export type TrackTypeItem = { value: string; label: string };

const STORAGE_KEY = 'onboarding:track-type-labels';
const LABELS_UPDATED_EVENT = 'onboarding:track-type-labels-updated';

export const DEFAULT_ITEMS: TrackTypeItem[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'RELEASE', label: 'Release template' },
  { value: 'TENANT_CREATION', label: 'Tenant creation' },
  { value: 'WORK_ORDER', label: 'Work order' },
];

// Module-level cache: keyed by accessToken so multiple hook instances share it.
const typeLabelsCacheByToken = new Map<string, TrackTypeItem[]>();
const typeLabelsInflightByToken = new Map<string, Promise<TrackTypeItem[]>>();

/** Convert a human label into UPPER_SNAKE_CASE value. */
function toTypeValue(str: string): string {
  return str
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'CUSTOM';
}

function loadStoredItems(): TrackTypeItem[] {
  if (typeof window === 'undefined') return DEFAULT_ITEMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ITEMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ITEMS;
    return (parsed as { value?: string; label?: string }[])
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        value: typeof x.value === 'string' && x.value.trim() ? x.value.trim() : 'CUSTOM',
        label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : 'Custom',
      }))
      .filter((item, i, arr) => arr.findIndex((t) => t.value === item.value) === i);
  } catch {
    return DEFAULT_ITEMS;
  }
}

function saveStoredItems(items: TrackTypeItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(LABELS_UPDATED_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function useTrackTypeLabels() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<TrackTypeItem[]>(() => loadStoredItems());

  // Keep in sync across tabs / same-page instances via storage event
  useEffect(() => {
    const load = () => setItems(loadStoredItems());
    window.addEventListener(LABELS_UPDATED_EVENT, load);
    return () => window.removeEventListener(LABELS_UPDATED_EVENT, load);
  }, []);

  // Load from remote API (once per token); prefer remote over localStorage
  useEffect(() => {
    if (!accessToken) return;
    let isMounted = true;

    const cached = typeLabelsCacheByToken.get(accessToken);
    if (cached && cached.length > 0) {
      // Cache is always kept up-to-date by updateItems, so use it directly.
      // Do NOT call saveStoredItems here — it would overwrite newer localStorage data.
      setItems(cached);
      return () => { isMounted = false; };
    }

    const existing = typeLabelsInflightByToken.get(accessToken);
    const promise =
      existing ??
      api.get<{ track_type_labels?: TrackTypeItem[] }>('/settings', accessToken).then((data) => {
        const remote = data?.track_type_labels;
        return Array.isArray(remote) && remote.length > 0 ? remote : [];
      });
    if (!existing) typeLabelsInflightByToken.set(accessToken, promise);

    promise
      .then((remote) => {
        if (!isMounted) return;
        if (remote.length > 0) {
          setItems(remote);
          saveStoredItems(remote);
          typeLabelsCacheByToken.set(accessToken, remote);
        }
      })
      .catch(() => { /* keep local data on remote failure */ })
      .finally(() => { typeLabelsInflightByToken.delete(accessToken); });

    return () => { isMounted = false; };
  }, [accessToken]);

  const persistRemote = useCallback(
    (next: TrackTypeItem[]) => {
      if (!accessToken) return;
      api.put('/settings', { track_type_labels: next }, accessToken).catch(() => {});
    },
    [accessToken],
  );

  /**
   * Central mutator: updates React state, localStorage, the module cache, and
   * persists to the remote API — so the new list is visible immediately and
   * survives page navigation / refresh.
   */
  const updateItems = useCallback(
    (next: TrackTypeItem[]) => {
      const valid = next.filter((i) => i.value.trim() && i.label.trim());
      if (valid.length === 0) return;
      setItems(valid);
      saveStoredItems(valid);
      // Keep module cache in sync so re-mounting never reverts to stale data
      if (accessToken) typeLabelsCacheByToken.set(accessToken, valid);
      persistRemote(valid);
    },
    [accessToken, persistRemote],
  );

  const options = useMemo(
    () => items.map(({ value, label }) => ({ value, label })),
    [items],
  );

  const values = useMemo(() => items.map((i) => i.value), [items]);

  const getLabel = useMemo(
    () => (value: string | undefined) => {
      if (!value) return items[0]?.label ?? 'General';
      const found = items.find((i) => i.value === value);
      return found?.label ?? value;
    },
    [items],
  );

  const addType = useCallback(
    (label: string): string => {
      const base = toTypeValue(label) || 'CUSTOM';
      let value = base;
      let n = 0;
      while (items.some((i) => i.value === value)) {
        value = `${base}_${++n}`;
      }
      const newItem = { value, label: label.trim() || value };
      updateItems([...items, newItem]);
      return value;
    },
    [items, updateItems],
  );

  const removeType = useCallback(
    (value: string) => {
      if (items.length <= 1) return;
      updateItems(items.filter((i) => i.value !== value));
    },
    [items, updateItems],
  );

  const updateLabel = useCallback(
    (value: string, label: string) => {
      const idx = items.findIndex((i) => i.value === value);
      if (idx < 0) return;
      const next = [...items];
      next[idx] = { ...next[idx], label: label.trim() || next[idx].label };
      updateItems(next);
    },
    [items, updateItems],
  );

  const updateValue = useCallback(
    (oldValue: string, newValue: string) => {
      const slug = toTypeValue(newValue) || 'CUSTOM';
      if (items.some((i) => i.value === slug && i.value !== oldValue)) return;
      const idx = items.findIndex((i) => i.value === oldValue);
      if (idx < 0) return;
      const next = [...items];
      next[idx] = { ...next[idx], value: slug };
      updateItems(next);
    },
    [items, updateItems],
  );

  const resetItems = useCallback(() => {
    updateItems(DEFAULT_ITEMS);
  }, [updateItems]);

  return {
    items,
    options,
    values,
    getLabel,
    addType,
    removeType,
    updateLabel,
    updateValue,
    resetItems,
    defaultItems: DEFAULT_ITEMS,
  };
}
