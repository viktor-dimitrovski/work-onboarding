import { Badge } from '@/components/ui/badge';
import { statusTone } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function StatusChip({ status }: { status: string }) {
  return <Badge className={cn(statusTone(status), 'capitalize')}>{status.replace('_', ' ')}</Badge>;
}
