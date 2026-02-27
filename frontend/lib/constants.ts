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

export function statusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'published':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'inactive':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'in_progress':
    case 'pending_review':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'blocked':
    case 'revision_requested':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'overdue':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'archived':
      return 'bg-slate-200 text-slate-600 border-slate-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
