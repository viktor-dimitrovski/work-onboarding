import {
  AlertTriangle,
  Bug,
  Settings2,
  ShieldAlert,
  Sparkles,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export const ITEM_TYPES = [
  { value: 'feature',         label: 'Feature',         icon: Sparkles,      color: 'blue'   },
  { value: 'bug_fix',         label: 'Bug Fix',          icon: Bug,           color: 'amber'  },
  { value: 'security',        label: 'Security',         icon: ShieldAlert,   color: 'red'    },
  { value: 'api_change',      label: 'API Change',       icon: Webhook,       color: 'purple' },
  { value: 'breaking_change', label: 'Breaking Change',  icon: AlertTriangle, color: 'rose'   },
  { value: 'config_change',   label: 'Config Change',    icon: Settings2,     color: 'slate'  },
] as const;

export type ItemType = typeof ITEM_TYPES[number]['value'];

export const TYPE_META: Record<ItemType, {
  label: string;
  icon: LucideIcon;
  badge: string;
  border: string;
  bg: string;
  dot: string;
}> = {
  feature:         { label: 'Feature',        icon: Sparkles,      badge: 'bg-blue-100 text-blue-700 border-blue-200',    border: 'border-l-blue-400',   bg: 'bg-blue-50/40',   dot: 'bg-blue-400'   },
  bug_fix:         { label: 'Bug Fix',         icon: Bug,           badge: 'bg-amber-100 text-amber-700 border-amber-200', border: 'border-l-amber-400',  bg: 'bg-amber-50/40',  dot: 'bg-amber-400'  },
  security:        { label: 'Security',        icon: ShieldAlert,   badge: 'bg-red-100 text-red-700 border-red-200',       border: 'border-l-red-400',    bg: 'bg-red-50/40',    dot: 'bg-red-400'    },
  api_change:      { label: 'API Change',      icon: Webhook,       badge: 'bg-purple-100 text-purple-700 border-purple-200', border: 'border-l-purple-400', bg: 'bg-purple-50/40', dot: 'bg-purple-400' },
  breaking_change: { label: 'Breaking Change', icon: AlertTriangle, badge: 'bg-rose-100 text-rose-700 border-rose-200',    border: 'border-l-rose-400',   bg: 'bg-rose-50/40',   dot: 'bg-rose-400'   },
  config_change:   { label: 'Config Change',   icon: Settings2,     badge: 'bg-slate-100 text-slate-600 border-slate-200', border: 'border-l-slate-300',  bg: 'bg-slate-50/40',  dot: 'bg-slate-400'  },
};

export function getTypeMeta(type: string) {
  return TYPE_META[type as ItemType] ?? TYPE_META.feature;
}
