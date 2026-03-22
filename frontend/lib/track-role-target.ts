import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export type TrackRoleTargetItem = { value: string; label: string };

const STORAGE_KEY = 'onboarding:track-role-target-labels';
const LABELS_UPDATED_EVENT = 'onboarding:track-role-target-labels-updated';

export const DEFAULT_ITEMS: TrackRoleTargetItem[] = [
  { value: 'devops', label: 'DevOps' },
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'fullstack', label: 'Full Stack' },
  { value: 'qa', label: 'QA' },
  { value: 'pm', label: 'PM' },
  { value: 'security', label: 'Security' },
  { value: 'data', label: 'Data' },
];

const labelsCacheByToken = new Map<string, TrackRoleTargetItem[]>();
const labelsInflightByToken = new Map<string, Promise<TrackRoleTargetItem[]>>();

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'custom';
}

function loadStoredItems(): TrackRoleTargetItem[] {
  if (typeof window === 'undefined') return DEFAULT_ITEMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ITEMS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ITEMS;
    return (parsed as { value?: string; label?: string }[])
      .filter((x): x is { value?: string; label?: string } => x != null && typeof x === 'object')
      .map((x) => ({
        value: typeof x.value === 'string' && x.value.trim() ? slugify(x.value.trim()) : 'custom',
        label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : 'Custom',
      }))
      .filter((item, i, arr) => arr.findIndex((t) => t.value === item.value) === i);
  } catch {
    return DEFAULT_ITEMS;
  }
}

function saveStoredItems(items: TrackRoleTargetItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(LABELS_UPDATED_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function useTrackRoleTargetLabels() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<TrackRoleTargetItem[]>(() => loadStoredItems());

  useEffect(() => {
    const load = () => setItems(loadStoredItems());
    window.addEventListener(LABELS_UPDATED_EVENT, load);
    return () => window.removeEventListener(LABELS_UPDATED_EVENT, load);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    let isMounted = true;

    const cached = labelsCacheByToken.get(accessToken);
    if (cached && cached.length > 0) {
      setItems(cached);
      return () => { isMounted = false; };
    }

    const existing = labelsInflightByToken.get(accessToken);
    const promise =
      existing ??
      api.get<{ track_role_target_labels?: TrackRoleTargetItem[] }>('/settings', accessToken).then((data) => {
        const remote = data?.track_role_target_labels;
        return Array.isArray(remote) && remote.length > 0 ? remote : [];
      });
    if (!existing) labelsInflightByToken.set(accessToken, promise);

    promise
      .then((remote) => {
        if (!isMounted) return;
        if (remote.length > 0) {
          setItems(remote);
          saveStoredItems(remote);
          labelsCacheByToken.set(accessToken, remote);
        }
      })
      .catch(() => { /* keep local data on remote failure */ })
      .finally(() => { labelsInflightByToken.delete(accessToken); });

    return () => { isMounted = false; };
  }, [accessToken]);

  const persistRemote = useCallback(
    (next: TrackRoleTargetItem[]) => {
      if (!accessToken) return;
      api.put('/settings', { track_role_target_labels: next }, accessToken).catch(() => {});
    },
    [accessToken],
  );

  const updateItems = useCallback(
    (next: TrackRoleTargetItem[]) => {
      const valid = next.filter((i) => i.value.trim() && i.label.trim());
      if (valid.length === 0) return;
      setItems(valid);
      saveStoredItems(valid);
      if (accessToken) labelsCacheByToken.set(accessToken, valid);
      persistRemote(valid);
    },
    [accessToken, persistRemote],
  );

  const options = useMemo(
    () => items.map(({ value, label }) => ({ value, label })),
    [items],
  );

  const getLabel = useMemo(
    () => (value: string | undefined) => {
      if (!value) return '';
      const found = items.find((i) => i.value === value);
      return found?.label ?? value;
    },
    [items],
  );

  const addRoleTarget = useCallback(
    (label: string): string => {
      const base = slugify(label) || 'custom';
      let value = base;
      let n = 0;
      while (items.some((i) => i.value === value)) {
        value = `${base}-${++n}`;
      }
      updateItems([...items, { value, label: label.trim() || value }]);
      return value;
    },
    [items, updateItems],
  );

  return { options, getLabel, addRoleTarget };
}
