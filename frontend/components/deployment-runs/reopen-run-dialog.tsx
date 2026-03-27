'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  onReopen: (reason: string) => Promise<void>;
  onClose: () => void;
};

export function ReopenRunDialog({ onReopen, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReopen = async () => {
    if (!reason.trim()) { setError('A reason is required to re-open the run.'); return; }
    setLoading(true);
    setError('');
    try {
      await onReopen(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-open run');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Re-open Deployment Run</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Provide a reason for re-opening this run. Blocked items can then be resolved.
          </p>
        </div>

        <Textarea
          placeholder="e.g. Schema fix applied — retrying token migration…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="resize-none"
        />

        {error && <p className="text-xs text-red-600 rounded-md bg-red-50 border border-red-200 px-3 py-2">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleReopen} disabled={!reason.trim() || loading}>
            {loading ? 'Re-opening…' : 'Re-open Run'}
          </Button>
        </div>
      </div>
    </div>
  );
}
