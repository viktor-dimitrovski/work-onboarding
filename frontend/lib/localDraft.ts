export type LocalDraftPayload<T> = {
  version: number;
  updatedAt: number;
  data: T;
};

export function buildLocalDraftKey(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

export function readLocalDraft<T>(key: string): LocalDraftPayload<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraftPayload<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.updatedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalDraft<T>(key: string, payload: LocalDraftPayload<T>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

export function clearLocalDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
