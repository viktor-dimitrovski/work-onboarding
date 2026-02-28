import {
  BookOpen,
  CheckSquare,
  ClipboardList,
  Code2,
  FileUp,
  HelpCircle,
  Link as LinkIcon,
  UserCheck,
  Video,
} from 'lucide-react';

const TASK_TYPE_META: Record<
  string,
  {
    label: string;
    icon: typeof BookOpen;
  }
> = {
  read_material: { label: 'Read', icon: BookOpen },
  video: { label: 'Watch', icon: Video },
  external_link: { label: 'Link', icon: LinkIcon },
  checklist: { label: 'Checklist', icon: CheckSquare },
  quiz: { label: 'Quiz', icon: ClipboardList },
  code_assignment: { label: 'Code', icon: Code2 },
  file_upload: { label: 'Upload', icon: FileUp },
  mentor_approval: { label: 'Review', icon: UserCheck },
  assessment_test: { label: 'Assessment', icon: ClipboardList },
};

export function getTaskTypeLabel(taskType: string): string {
  return TASK_TYPE_META[taskType]?.label ?? taskType.replace('_', ' ');
}

export function getTaskTypeIcon(taskType: string): typeof BookOpen {
  return TASK_TYPE_META[taskType]?.icon ?? HelpCircle;
}

