import { api } from '@/lib/api';
import { normalizeCombo } from '@/lib/hotkeys';

export type KeybindingProfile = {
  updated_at: number;
  bindings: Record<string, string[]>;
};

export type KeybindingAction = {
  id: string;
  label: string;
  category: string;
  description?: string;
  defaultBindings?: string[];
};

export const KEYBINDING_ACTIONS: KeybindingAction[] = [
  { id: 'content.jump.section1', label: 'Jump to Summary', category: 'Navigation', defaultBindings: ['Alt+1'] },
  { id: 'content.jump.section2', label: 'Jump to Acceptance / checks', category: 'Navigation', defaultBindings: ['Alt+2'] },
  { id: 'content.jump.section3', label: 'Jump to Versions used', category: 'Navigation', defaultBindings: ['Alt+3'] },
  { id: 'content.jump.section4', label: 'Jump to Implementation notes', category: 'Navigation', defaultBindings: ['Alt+4'] },
  { id: 'content.jump.section5', label: 'Jump to Dev log', category: 'Navigation', defaultBindings: ['Alt+5'] },
  { id: 'content.jump.section6', label: 'Jump to Risks & mitigations', category: 'Navigation', defaultBindings: ['Alt+6'] },
  { id: 'content.jump.section7', label: 'Jump to Rollback considerations', category: 'Navigation', defaultBindings: ['Alt+7'] },
  { id: 'content.section.prev', label: 'Previous section', category: 'Navigation', defaultBindings: ['Mod+ArrowUp'] },
  { id: 'content.section.next', label: 'Next section', category: 'Navigation', defaultBindings: ['Mod+ArrowDown'] },
  { id: 'content.field.prev', label: 'Previous block', category: 'Navigation', defaultBindings: ['Mod+ArrowLeft'] },
  { id: 'content.field.next', label: 'Next block', category: 'Navigation', defaultBindings: ['Mod+ArrowRight'] },
  { id: 'content.template.insert', label: 'Insert section template', category: 'Content' },
  { id: 'content.preview.toggle', label: 'Toggle preview', category: 'Content' },
  { id: 'content.copySectionMarkdown', label: 'Copy section markdown', category: 'Content' },
  { id: 'content.help.overlay.toggle', label: 'Toggle shortcut overlay', category: 'Help', defaultBindings: ['Mod+/'] },
  { id: 'content.drawer.toggle', label: 'Toggle section drawer', category: 'Layout' },
  { id: 'commandPalette.open', label: 'Open command palette', category: 'Help', defaultBindings: ['Mod+K'] },
  { id: 'workOrder.save', label: 'Save work order', category: 'Work order', defaultBindings: ['Mod+S'] },
  { id: 'versions.row.add', label: 'Add versions row', category: 'Content', defaultBindings: ['Mod+Enter'] },
  { id: 'devlog.entry.add', label: 'Add dev log entry', category: 'Content', defaultBindings: ['Mod+Enter'] },
];

const STORAGE_KEY = 'onboarding_keybindings_v1';

export function getDefaultBindings(): Record<string, string[]> {
  const defaults: Record<string, string[]> = {};
  KEYBINDING_ACTIONS.forEach((action) => {
    if (action.defaultBindings?.length) {
      defaults[action.id] = action.defaultBindings.map((combo) => normalizeCombo(combo)).filter(Boolean);
    }
  });
  return defaults;
}

export function normalizeBindingsMap(bindings: Record<string, string[]>): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  Object.entries(bindings || {}).forEach(([action, combos]) => {
    if (!Array.isArray(combos)) return;
    const cleaned = combos
      .map((combo) => normalizeCombo(combo))
      .filter(Boolean)
      .filter((combo, idx, arr) => arr.indexOf(combo) === idx);
    normalized[action] = cleaned;
  });
  return normalized;
}

export function applyDefaultBindings(profile: KeybindingProfile): KeybindingProfile {
  const defaults = getDefaultBindings();
  const merged: Record<string, string[]> = { ...defaults };
  Object.entries(profile.bindings || {}).forEach(([action, combos]) => {
    merged[action] = combos;
  });
  return {
    updated_at: profile.updated_at || 0,
    bindings: normalizeBindingsMap(merged),
  };
}

export function loadLocalProfile(): KeybindingProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KeybindingProfile;
    if (!parsed || typeof parsed !== 'object') return null;
    return applyDefaultBindings({
      updated_at: typeof parsed.updated_at === 'number' ? parsed.updated_at : 0,
      bindings: typeof parsed.bindings === 'object' && parsed.bindings ? parsed.bindings : {},
    });
  } catch {
    return null;
  }
}

export function saveLocalProfile(profile: KeybindingProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage failures
  }
}

export async function fetchRemoteProfile(accessToken: string): Promise<KeybindingProfile | null> {
  try {
    const payload = await api.get<KeybindingProfile>('/me/keybindings', accessToken);
    return applyDefaultBindings({
      updated_at: typeof payload.updated_at === 'number' ? payload.updated_at : 0,
      bindings: typeof payload.bindings === 'object' && payload.bindings ? payload.bindings : {},
    });
  } catch {
    return null;
  }
}

export async function saveRemoteProfile(
  accessToken: string,
  profile: KeybindingProfile,
): Promise<KeybindingProfile | null> {
  try {
    const payload = await api.put<KeybindingProfile>('/me/keybindings', profile, accessToken);
    return applyDefaultBindings({
      updated_at: typeof payload.updated_at === 'number' ? payload.updated_at : profile.updated_at,
      bindings: payload.bindings || profile.bindings,
    });
  } catch {
    return null;
  }
}

export async function syncKeybindingsProfile(accessToken?: string | null): Promise<KeybindingProfile> {
  const fallback = applyDefaultBindings({ updated_at: 0, bindings: {} });
  const local = loadLocalProfile();
  if (!accessToken) {
    const resolved = local ?? fallback;
    saveLocalProfile(resolved);
    return resolved;
  }
  const remote = await fetchRemoteProfile(accessToken);
  const localUpdated = local?.updated_at ?? 0;
  const remoteUpdated = remote?.updated_at ?? 0;
  const chosen =
    localUpdated >= remoteUpdated ? (local ?? fallback) : (remote ?? local ?? fallback);
  const normalized = applyDefaultBindings(chosen);
  saveLocalProfile(normalized);
  if (localUpdated > remoteUpdated && normalized) {
    await saveRemoteProfile(accessToken, normalized);
  }
  return normalized;
}

export function updateProfileBindings(
  profile: KeybindingProfile,
  actionId: string,
  bindings: string[],
): KeybindingProfile {
  const updated: KeybindingProfile = {
    updated_at: Date.now(),
    bindings: { ...profile.bindings, [actionId]: bindings.map((combo) => normalizeCombo(combo)) },
  };
  return applyDefaultBindings(updated);
}
