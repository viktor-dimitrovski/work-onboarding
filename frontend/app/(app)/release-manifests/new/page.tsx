"use client";

import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MarkdownRenderer } from '@/components/common/markdown-renderer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type WorkOrderSummary = {
  wo_id: string;
  title?: string | null;
  services_count: number;
  deploy_count: number;
};

type WorkOrderListResponse = {
  items: WorkOrderSummary[];
};

type PreviewResponse = {
  markdown: string;
  deploy_list: { service_id: string; repo?: string | null; version?: string | null; release_notes?: string | null }[];
};

const parsePairs = (value: string) => {
  const pairs = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};
  pairs.forEach((pair) => {
    const [key, ...rest] = pair.split('=');
    const val = rest.join('=').trim();
    if (key && val) {
      out[key.trim()] = val;
    }
  });
  return out;
};

export default function NewReleaseManifestPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();
  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const [loading, setLoading] = useState(true);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState(1);

  const [relId, setRelId] = useState('');
  const [env, setEnv] = useState('prod');
  const [window, setWindow] = useState('');
  const [versions, setVersions] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const run = async () => {
      setLoading(true);
      try {
        const response = await api.get<WorkOrderListResponse>('/work-orders', accessToken);
        setWorkOrders(response.items);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [accessToken]);

  const selectedCount = selected.length;

  const previewPayload = useMemo(
    () => ({
      rel_id: relId,
      env,
      window,
      work_orders: selected,
      versions: parsePairs(versions),
      release_notes: parsePairs(releaseNotes),
    }),
    [relId, env, window, selected, versions, releaseNotes],
  );

  const generatePreview = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api.post<PreviewResponse>('/release-manifests/preview', previewPayload, accessToken);
      setPreview(response);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview');
    } finally {
      setSaving(false);
    }
  };

  const createRel = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/release-manifests', previewPayload, accessToken);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create release manifest');
    } finally {
      setSaving(false);
    }
  };

  if (!canWrite) {
    return <EmptyState title='Access denied' description='You do not have permission to create release manifests.' />;
  }
  if (loading) return <LoadingState label='Loading work orders...' />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>New Release Manifest</h2>
        <p className='text-sm text-muted-foreground'>Select WOs → preview → create REL PR.</p>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Select work orders</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {workOrders.length === 0 ? (
              <EmptyState title='No WOs' description='Create a work order first.' />
            ) : (
              workOrders.map((wo) => (
                <label key={wo.wo_id} className='flex items-center justify-between gap-3 rounded-md border px-3 py-2'>
                  <div>
                    <p className='text-sm font-medium'>{wo.wo_id}</p>
                    <p className='text-xs text-muted-foreground'>{wo.title || 'Untitled'}</p>
                  </div>
                  <div className='flex items-center gap-4 text-xs text-muted-foreground'>
                    <span>Services {wo.services_count}</span>
                    <span>Deploys {wo.deploy_count}</span>
                    <input
                      type='checkbox'
                      checked={selected.includes(wo.wo_id)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelected((prev) => [...prev, wo.wo_id]);
                        } else {
                          setSelected((prev) => prev.filter((id) => id !== wo.wo_id));
                        }
                      }}
                    />
                  </div>
                </label>
              ))
            )}
            <div className='flex justify-end pt-2'>
              <Button type='button' onClick={() => setStep(2)} disabled={selectedCount === 0}>
                Next ({selectedCount})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Release details</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2 md:col-span-2'>
              <label className='text-xs text-muted-foreground'>REL ID</label>
              <Input value={relId} onChange={(event) => setRelId(event.target.value)} placeholder='REL-2026-03-15-prod-01' />
            </div>
            <div className='space-y-2'>
              <label className='text-xs text-muted-foreground'>Environment</label>
              <Input value={env} onChange={(event) => setEnv(event.target.value)} placeholder='prod' />
            </div>
            <div className='space-y-2'>
              <label className='text-xs text-muted-foreground'>Window</label>
              <Input value={window} onChange={(event) => setWindow(event.target.value)} placeholder='2026-03-15 22:00-23:00 CET' />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <label className='text-xs text-muted-foreground'>Versions override (service=tag, comma-separated)</label>
              <Textarea value={versions} onChange={(event) => setVersions(event.target.value)} rows={2} />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <label className='text-xs text-muted-foreground'>Release notes override (service=url, comma-separated)</label>
              <Textarea value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} rows={2} />
            </div>
            <div className='flex items-center justify-between md:col-span-2'>
              <Button type='button' variant='ghost' onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type='button' onClick={generatePreview} disabled={!relId || selectedCount === 0 || saving}>
                {saving ? 'Generating…' : 'Generate preview'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && preview && (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Deploy list</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              {preview.deploy_list.map((item) => (
                <div key={item.service_id} className='rounded-md border px-3 py-2 text-xs'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>{item.service_id}</span>
                    <span>{item.version || 'TBD'}</span>
                    <span>{item.repo || 'TBD'}</span>
                  </div>
                  <p className='text-muted-foreground'>{item.release_notes || 'TBD'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>REL preview</CardTitle>
            </CardHeader>
            <CardContent>
              <MarkdownRenderer content={preview.markdown} />
            </CardContent>
          </Card>
          <div className='flex items-center justify-between'>
            <Button type='button' variant='ghost' onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type='button' onClick={createRel} disabled={saving}>
              {saving ? 'Creating…' : 'Create REL PR'}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardContent className='pt-6 text-sm'>
            <p>Release manifest PR has been created.</p>
            <p className='text-muted-foreground'>Check your GitHub repo for the rel/* branch and PR.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
