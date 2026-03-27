'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Rocket } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

type DataCenter = { id: string; name: string; slug: string; environment: string; is_primary: boolean; is_dr: boolean };
type WorkOrderSummary = {
  id: string;
  wo_id: string;
  title: string | null;
  services_count: number;
  risk: string | null;
  status: string | null;
};
type User = { id: string; full_name: string | null; email: string };

const RELEASE_TYPES = [
  { value: 'quarterly', label: 'Quarterly',  description: 'Planned quarterly release — full 5-phase flow' },
  { value: 'ad_hoc',   label: 'Ad-hoc',     description: 'Unplanned — urgent feature or non-critical need' },
  { value: 'security', label: 'Security',   description: 'Emergency security patch — compressed timeline' },
  { value: 'bugfix',   label: 'Bug Fix',    description: 'Urgent bug fix that cannot wait for quarterly' },
];

const ENVIRONMENTS = ['production', 'staging', 'dr'];

const STEPS = [
  { label: 'Basic Info' },
  { label: 'Work Orders' },
  { label: 'Review' },
];

function suggestName(type: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  if (type === 'quarterly') return `Q${quarter}-${year}`;
  if (type === 'security') return `SEC-${year}-${month}-${day}`;
  if (type === 'bugfix') return `BUG-${year}-${month}-${day}`;
  return `ADH-${year}-${month}`;
}

export default function NewPlatformReleasePage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  const [step, setStep] = useState(1);
  const [releaseType, setReleaseType] = useState('quarterly');
  const [name, setName] = useState('Q1-2026');
  const [environment, setEnvironment] = useState('production');
  const [dataCenterId, setDataCenterId] = useState<string>('');
  const [cabApproverId, setCabApproverId] = useState<string>('');
  const [selectedWOs, setSelectedWOs] = useState<string[]>([]);

  const [dataCenters, setDataCenters] = useState<DataCenter[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { setName(suggestName(releaseType)); }, [releaseType]);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api.get<{ items: DataCenter[] }>('/data-centers', accessToken),
      api.get<{ items: WorkOrderSummary[] }>('/work-orders', accessToken),
      api.get<{ items: User[] }>('/users', accessToken),
    ]).then(([dcs, wos, usrs]) => {
      setDataCenters(dcs.items ?? []);
      setWorkOrders((wos.items ?? []) as WorkOrderSummary[]);
      setUsers(usrs.items ?? []);
    }).catch(() => {});
  }, [accessToken]);

  const toggleWO = (id: string) =>
    setSelectedWOs((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!dataCenterId) errs.dc = 'Select a data center';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        release_type: releaseType,
        environment,
        data_center_id: dataCenterId || null,
        cab_approver_id: cabApproverId || null,
        work_order_ids: selectedWOs,
      };
      const result = await api.post<{ id: string }>('/platform-releases', body, accessToken);
      router.push(`/platform-releases/${result.id}`);
    } catch (e) {
      setErrors({ submit: e instanceof Error ? e.message : 'Failed to create' });
    } finally {
      setSaving(false);
    }
  };

  const selectedDC = dataCenters.find((dc) => dc.id === dataCenterId);
  const approver = users.find((u) => u.id === cabApproverId);
  const selectedWOObjects = workOrders.filter((wo) => selectedWOs.includes(wo.id));
  const typeLabel = RELEASE_TYPES.find((t) => t.value === releaseType)?.label ?? releaseType;

  return (
    <div className="container mx-auto max-w-3xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/platform-releases" className="text-muted-foreground hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold">New Platform Release</h1>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const stepNum = i + 1;
          return (
            <div key={stepNum} className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors cursor-pointer',
                  step === stepNum ? 'bg-slate-900 text-white' : step > stepNum ? 'bg-emerald-500 text-white' : 'border border-slate-300 text-slate-400',
                )}
                onClick={() => { if (step > stepNum) setStep(stepNum); }}
              >
                {step > stepNum ? <Check className="h-3 w-3" /> : stepNum}
              </div>
              <span className={cn('text-xs', step === stepNum ? 'text-slate-700 font-medium' : 'text-muted-foreground')}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px w-8 bg-slate-200" />}
            </div>
          );
        })}
      </div>

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <Label className="text-xs font-medium mb-2 block">Release Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {RELEASE_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setReleaseType(t.value)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    releaseType === t.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <div className="text-sm font-medium text-slate-800">{t.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium mb-1 block">
              Release Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={errors.name ? 'border-red-400' : ''}
            />
            {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name}</p>}
          </div>

          <div>
            <Label className="text-xs font-medium mb-2 block">Environment</Label>
            <div className="flex gap-2">
              {ENVIRONMENTS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEnvironment(e)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                    environment === e ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 hover:bg-slate-50',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium mb-2 block">
              Target Data Center <span className="text-red-500">*</span>
            </Label>
            {dataCenters.length === 0 ? (
              <p className="text-xs text-muted-foreground border rounded-md p-3">
                No data centers configured.{' '}
                <Link href="/settings" className="text-blue-600 underline">Configure in Settings</Link>.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {dataCenters.filter((dc) => !environment || dc.environment === environment || environment === 'dr').map((dc) => (
                  <button
                    key={dc.id}
                    onClick={() => setDataCenterId(dc.id)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      dataCenterId === dc.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-medium">{dc.name}</span>
                      {dc.is_primary && <Badge variant="outline" className="text-[10px] py-0 border-emerald-200 text-emerald-700">Primary</Badge>}
                      {dc.is_dr && <Badge variant="outline" className="text-[10px] py-0 border-amber-200 text-amber-700">DR</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">{dc.environment}</p>
                  </button>
                ))}
              </div>
            )}
            {errors.dc && <p className="text-xs text-red-500 mt-1">{errors.dc}</p>}
          </div>

          <div>
            <Label className="text-xs font-medium mb-1 block">
              CAB Approver <span className="text-slate-400 font-normal">(optional)</span>
            </Label>
            <select
              value={cabApproverId}
              onChange={(e) => setCabApproverId(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">— Select approver —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => { if (validate()) setStep(2); }}>
              Next: Select Work Orders
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Work Orders */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Select Work Orders</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedWOs.length} selected · These will be included in the release
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
              ← Back
            </Button>
          </div>

          {workOrders.length === 0 && (
            <p className="text-sm text-muted-foreground border rounded-md p-4 text-center">
              No work orders found.
            </p>
          )}

          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {workOrders.map((wo) => {
              const selected = selectedWOs.includes(wo.id);
              return (
                <button
                  key={wo.id}
                  onClick={() => toggleWO(wo.id)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors',
                    selected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <div className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors',
                    selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300',
                  )}>
                    {selected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{wo.wo_id}</span>
                      <span className="text-sm font-medium text-slate-800 truncate">{wo.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {wo.services_count > 0 && <span>{wo.services_count} services</span>}
                      {wo.risk && <Badge variant="outline" className="text-[10px] py-0">{wo.risk}</Badge>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {selectedWOs.length === 0 ? 'You can add work orders later.' : `${selectedWOs.length} work order(s) selected`}
            </p>
            <Button onClick={() => setStep(3)}>
              Next: Review
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Confirm */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Review & Confirm</p>
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>
              ← Back
            </Button>
          </div>

          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            {/* Release info */}
            <div className="px-5 py-4 space-y-3 border-b">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">
                  {typeLabel}
                </Badge>
                <span className="font-bold text-lg text-slate-900">{name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block mb-0.5">Environment</span>
                  <span className="font-medium capitalize">{environment}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-0.5">Data Center</span>
                  <span className="font-medium">{selectedDC?.name ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-0.5">CAB Approver</span>
                  <span className="font-medium">{approver ? (approver.full_name ?? approver.email) : '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-0.5">Work Orders</span>
                  <span className="font-medium">{selectedWOs.length} selected</span>
                </div>
              </div>
            </div>

            {/* WO list summary */}
            {selectedWOObjects.length > 0 && (
              <div className="px-5 py-3 space-y-1.5 max-h-48 overflow-y-auto">
                {selectedWOObjects.map((wo) => (
                  <div key={wo.id} className="flex items-center gap-2 text-sm">
                    <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    <span className="font-mono text-xs text-muted-foreground">{wo.wo_id}</span>
                    <span className="text-slate-700 truncate">{wo.title}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedWOs.length === 0 && (
              <div className="px-5 py-3 text-xs text-muted-foreground">
                No work orders selected — you can add them after creation.
              </div>
            )}
          </div>

          {errors.submit && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {errors.submit}
            </p>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              The release starts in <strong>Draft</strong> status. Generate the release plan after creation.
            </p>
            <Button onClick={handleCreate} disabled={saving} className="gap-2">
              <Rocket className="h-4 w-4" />
              {saving ? 'Creating…' : 'Create Release'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
