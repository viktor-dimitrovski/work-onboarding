export type NormalizedCombo = string;

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  mod: 'Mod',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  slash: '/',
};

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function normalizeCombo(combo: string): NormalizedCombo {
  const raw = (combo || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let keyPart = '';

  raw.forEach((part) => {
    const lower = part.toLowerCase();
    const mod = MODIFIER_ALIASES[lower];
    if (mod) {
      modifiers.add(mod);
      return;
    }
    const alias = KEY_ALIASES[lower];
    if (alias) {
      keyPart = alias;
      return;
    }
    if (part.length === 1) {
      keyPart = part.toUpperCase();
      return;
    }
    keyPart = part;
  });

  const ordered = MODIFIER_ORDER.filter((mod) => modifiers.has(mod));
  return [...ordered, keyPart].filter(Boolean).join('+');
}

export function comboToDisplay(combo: string, preferMac = isMacPlatform()): string {
  const normalized = normalizeCombo(combo);
  if (!normalized) return '';
  return normalized
    .split('+')
    .map((part) => {
      if (part === 'Mod') return preferMac ? 'Cmd' : 'Ctrl';
      if (part === 'ArrowUp') return '↑';
      if (part === 'ArrowDown') return '↓';
      if (part === 'ArrowLeft') return '←';
      if (part === 'ArrowRight') return '→';
      if (part === 'Space') return 'Space';
      return part;
    })
    .join('+');
}

function normalizeEventKey(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key) return null;
  const lower = key.toLowerCase();
  if (MODIFIER_ALIASES[lower]) return null;
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (key.length === 1 && /[a-z0-9]/i.test(key)) {
    return key.toUpperCase();
  }
  if (event.code) {
    if (event.code.startsWith('Digit')) return event.code.replace('Digit', '');
    if (event.code.startsWith('Key')) return event.code.replace('Key', '').toUpperCase();
    if (event.code === 'Slash') return '/';
  }
  return key;
}

export function eventToCombo(event: KeyboardEvent): NormalizedCombo {
  const keyPart = normalizeEventKey(event);
  if (!keyPart) return '';
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push('Mod');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return normalizeCombo([...modifiers, keyPart].join('+'));
}

export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const normalized = normalizeCombo(combo);
  if (!normalized) return false;
  const eventCombo = eventToCombo(event);
  if (eventCombo === normalized) return true;
  if (normalized.includes('Mod')) {
    const asCtrl = normalizeCombo(normalized.replace('Mod', 'Ctrl'));
    const asCmd = normalizeCombo(normalized.replace('Mod', 'Cmd'));
    return eventCombo === asCtrl || eventCombo === asCmd;
  }
  if (eventCombo.includes('Mod')) {
    const eventAsCtrl = normalizeCombo(eventCombo.replace('Mod', 'Ctrl'));
    const eventAsCmd = normalizeCombo(eventCombo.replace('Mod', 'Cmd'));
    return normalized === eventAsCtrl || normalized === eventAsCmd;
  }
  return false;
}
