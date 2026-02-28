import { Badge } from '@/components/ui/badge';
import { riskTone } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function RiskChip({ risk }: { risk: string }) {
  return <Badge className={cn(riskTone(risk), 'capitalize')}>{risk}</Badge>;
}

