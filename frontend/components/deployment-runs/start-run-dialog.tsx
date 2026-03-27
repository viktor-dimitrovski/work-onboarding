'use client';

import { useState } from 'react';
import { Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DataCenter = { id: string; name: string; slug: string; environment: string; is_primary: boolean; is_dr: boolean };

type Props = {
  dataCenters: DataCenter[];
  onStart: (data_center_id: string, environment: string) => Promise<void>;
  onClose: () => void;
};

const ENVIRONMENTS = ['production', 'staging', 'dr'];

export function StartRunDialog({ dataCenters, onStart, onClose }: Props) {
  const [dcId, setDcId] = useState('');
  const [env, setEnv] = useState('production');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    if (!dcId) { setError('Select a data center.'); return; }
    setLoading(true);
    setError('');
    try {
      await onStart(dcId, env);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border shadow-xl p-6 max-w-md w-full mx-4 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Start Deployment Run</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Select the target data center and environment. A deployment checklist will be generated from the release plan.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-slate-600 mb-2">Data Center</p>
            <div className="space-y-1.5">
              {dataCenters.map((dc) => (
                <button
                  key={dc.id}
                  onClick={() => setDcId(dc.id)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-lg border px-4 py-2 text-sm text-left transition-colors',
                    dcId === dc.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className="font-medium">{dc.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{dc.slug}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-600 mb-2">Environment</p>
            <div className="flex gap-2">
              {ENVIRONMENTS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEnv(e)}
                  className={cn(
                    'flex-1 rounded-md border py-1.5 text-xs font-medium capitalize transition-colors',
                    env === e ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 rounded-md bg-red-50 border border-red-200 px-3 py-2">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleStart} disabled={!dcId || loading}>
            <Rocket className="mr-1.5 h-4 w-4" />
            {loading ? 'Starting…' : 'Start Deployment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
