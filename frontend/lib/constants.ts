export const taskTypeOptions = [
  'read_material',
  'video',
  'checklist',
  'quiz',
  'code_assignment',
  'external_link',
  'mentor_approval',
  'file_upload',
  'assessment_test',
] as const;

export const roleOptions = ['super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer'] as const;

export type TenantRoleGroup = {
  label: string;
  moduleKey: string | null;
  roles: string[];
};

export const tenantRoleGroups: TenantRoleGroup[] = [
  {
    label: 'General',
    moduleKey: null,
    roles: ['member', 'manager', 'mentor', 'tenant_admin'],
  },
  {
    label: 'Compliance',
    moduleKey: 'compliance',
    roles: ['compliance_viewer', 'compliance_editor', 'compliance_admin'],
  },
  {
    label: 'Integration Registry',
    moduleKey: 'integration_registry',
    roles: ['ir_viewer', 'ir_editor', 'ir_approver', 'ir_admin'],
  },
  {
    label: 'Billing',
    moduleKey: 'billing',
    roles: ['billing_viewer', 'billing_manager'],
  },
  {
    label: 'Releases',
    moduleKey: 'releases',
    roles: ['release_viewer', 'release_editor'],
  },
  {
    label: 'Tracks',
    moduleKey: 'tracks',
    roles: ['tracks_editor'],
  },
  {
    label: 'Assessments',
    moduleKey: 'assessments',
    roles: ['assessments_editor'],
  },
  {
    label: 'Reports',
    moduleKey: 'reports',
    roles: ['reports_viewer'],
  },
  {
    label: 'Settings',
    moduleKey: 'settings',
    roles: ['settings_manager'],
  },
  {
    label: 'Education',
    moduleKey: null,
    roles: ['parent'],
  },
];

export const tenantRoleOptions = tenantRoleGroups.flatMap((g) => g.roles);

export function statusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'published':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'released':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'inactive':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'in_progress':
    case 'pending_review':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ready_for_release':
      return 'bg-violet-100 text-violet-700 border-violet-200';
    case 'draft':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'blocked':
    case 'revision_requested':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'overdue':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'archived':
      return 'bg-slate-200 text-slate-600 border-slate-300';
    case 'cancelled':
      return 'bg-slate-200 text-slate-600 border-slate-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function riskTone(risk: string): string {
  switch (risk) {
    case 'low':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'medium':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'high':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDateShort(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function shortId(value?: string | null): string {
  if (!value) return '—';
  const v = String(value);
  if (v.length <= 12) return v;
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Integration Registry helpers
// ---------------------------------------------------------------------------

export function irStatusTone(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'draft':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'disabled':
      return 'bg-slate-100 text-slate-500 border-slate-200';
    case 'deprecated':
      return 'bg-red-100 text-red-600 border-red-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

export function irEnvTone(env: string): string {
  switch (env?.toUpperCase()) {
    case 'PROD':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'UAT':
      return 'bg-sky-100 text-sky-700 border-sky-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

export function maskVaultRef(value?: string | null): string {
  if (!value) return '—';
  const parts = String(value).split('/');
  if (parts.length > 4) {
    return `${parts.slice(0, 4).join('/')}/***`;
  }
  return String(value);
}

export const IR_DEFAULT_COLUMNS = [
  'service',
  'env',
  'dc',
  'network',
  'type',
  'endpoint',
  'status',
  'updated',
  'actions',
] as const;

export type IrColumnKey = (typeof IR_DEFAULT_COLUMNS)[number];

export const IR_COLUMN_LABELS: Record<string, string> = {
  service: 'Service',
  env: 'Env',
  dc: 'DC',
  network: 'Network',
  type: 'Type',
  endpoint: 'Primary Endpoint',
  status: 'Status',
  updated: 'Last Change',
  actions: 'Actions',
};
