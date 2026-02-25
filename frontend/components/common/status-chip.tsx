import { Badge } from '@/components/ui/badge';
import { statusTone } from '@/lib/constants';

export function StatusChip({ status }: { status: string }) {
  return <Badge className={statusTone(status)}>{status.replace('_', ' ')}</Badge>;
}
