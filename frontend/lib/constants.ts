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
export const tenantRoleOptions = ['member', 'manager', 'mentor', 'tenant_admin', 'parent'] as const;

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

export function shortId(value?: string | null): string {
  if (!value) return '—';
  const v = String(value);
  if (v.length <= 12) return v;
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}
