'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Server, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type DataCenter = {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  cluster_url: string | null;
  k8s_context: string | null;
  environment: string;
  is_primary: boolean;
  is_dr: boolean;
  is_active: boolean;
};

type DCForm = Partial<DataCenter> & { name: string; slug: string; environment: string };

const ENVIRONMENTS = ['production', 'staging', 'dr'];

const ENV_STYLES: Record<string, string> = {
  production: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  staging:    'border-blue-200 bg-blue-50 text-blue-700',
  dr:         'border-amber-200 bg-amber-50 text-amber-700',
};

const emptyForm = (): DCForm => ({
  name: '', slug: '', environment: 'production', location: '',
  cluster_url: '', k8s_context: '', is_primary: false, is_dr: false, is_active: true,
});

export function DataCentersSettingsSection({ canWrite }: { canWrite: boolean }) {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<DataCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DCForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api.get<{ items: DataCenter[] }>('/data-centers', accessToken);
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const slugify = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name?.trim()) errs.name = 'Name is required';
    if (!form.slug?.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(form.slug)) errs.slug = 'Slug: lowercase letters, numbers, hyphens only';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !accessToken) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await api.patch<DataCenter>(`/data-centers/${editingId}`, form, accessToken);
        setItems((prev) => prev.map((dc) => dc.id === editingId ? updated : dc));
      } else {
        const created = await api.post<DataCenter>('/data-centers', form, accessToken);
        setItems((prev) => [...prev, created]);
      }
      setShowAdd(false);
      setEditingId(null);
      setForm(emptyForm());
      setFormErrors({});
    } catch (e) {
      setFormErrors({ submit: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (dc: DataCenter) => {
    setShowAdd(false);
    setEditingId(dc.id);
    setForm({ ...dc });
    setFormErrors({});
  };

  const handleDelete = async (id: string) => {
    if (!accessToken || !confirm('Delete this data center?')) return;
    try {
      await api.delete(`/data-centers/${id}`, accessToken);
      setItems((prev) => prev.filter((dc) => dc.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const cancelForm = () => {
    setShowAdd(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormErrors({});
  };

  const dcForm = (
    <div className="rounded-lg border bg-white p-4 space-y-3 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium mb-1 block">Name <span className="text-red-500">*</span></Label>
          <Input
            value={form.name}
            onChange={(e) => {
              const val = e.target.value;
              setForm((f) => ({ ...f, name: val, slug: editingId ? f.slug : slugify(val) }));
            }}
            placeholder="EU Primary"
            className={formErrors.name ? 'border-red-400' : ''}
          />
          {formErrors.name && <p className="text-xs text-red-500 mt-0.5">{formErrors.name}</p>}
        </div>
        <div>
          <Label className="text-xs font-medium mb-1 block">Slug <span className="text-red-500">*</span></Label>
          <Input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="eu-primary"
            className={cn('font-mono', formErrors.slug ? 'border-red-400' : '')}
          />
          {formErrors.slug && <p className="text-xs text-red-500 mt-0.5">{formErrors.slug}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium mb-1 block">Location</Label>
          <Input value={form.location ?? ''} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Frankfurt" />
        </div>
        <div>
          <Label className="text-xs font-medium mb-2 block">Environment</Label>
          <div className="flex gap-1.5">
            {ENVIRONMENTS.map((e) => (
              <button
                key={e}
                onClick={() => setForm((f) => ({ ...f, environment: e }))}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  form.environment === e ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium mb-1 block">Cluster URL</Label>
          <Input value={form.cluster_url ?? ''} onChange={(e) => setForm((f) => ({ ...f, cluster_url: e.target.value }))} placeholder="https://k8s-eu1.internal" className="font-mono text-xs" />
        </div>
        <div>
          <Label className="text-xs font-medium mb-1 block">k8s Context</Label>
          <Input value={form.k8s_context ?? ''} onChange={(e) => setForm((f) => ({ ...f, k8s_context: e.target.value }))} placeholder="eks-eu-prod" className="font-mono text-xs" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_primary ?? false} onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Primary DC</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_dr ?? false} onChange={(e) => setForm((f) => ({ ...f, is_dr: e.target.checked }))} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Disaster Recovery</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Active</span>
        </label>
      </div>

      {formErrors.submit && (
        <p className="text-xs text-red-600 border border-red-200 bg-red-50 rounded px-3 py-2">{formErrors.submit}</p>
      )}

      <div className="flex gap-2 pt-1 border-t">
        <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
          <Check className="mr-1 h-3 w-3" />
          {saving ? 'Saving…' : editingId ? 'Update' : 'Add Data Center'}
        </Button>
        <Button size="sm" variant="ghost" onClick={cancelForm} className="h-7 text-xs">
          <X className="mr-1 h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!loading && items.length === 0 && !showAdd && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center">
          <Server className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No data centers configured.</p>
          {canWrite && (
            <Button size="sm" variant="outline" className="mt-3 h-7 text-xs" onClick={() => setShowAdd(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add First Data Center
            </Button>
          )}
        </div>
      )}

      {items.map((dc) => (
        <div key={dc.id}>
          {editingId === dc.id ? (
            dcForm
          ) : (
            <div className="group flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{dc.name}</span>
                  <Badge variant="outline" className={cn('text-[10px] capitalize', ENV_STYLES[dc.environment] ?? '')}>
                    {dc.environment}
                  </Badge>
                  {dc.is_primary && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">Primary</Badge>}
                  {dc.is_dr && <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700">DR</Badge>}
                  {!dc.is_active && <Badge variant="outline" className="text-[10px] text-slate-400">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  {dc.location && <span>{dc.location}</span>}
                  {dc.slug && <span className="font-mono">{dc.slug}</span>}
                </div>
              </div>
              {canWrite && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(dc)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(dc.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {showAdd && !editingId && dcForm}

      {canWrite && !showAdd && !editingId && items.length > 0 && (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-3 w-3" />
          Add Data Center
        </Button>
      )}
    </div>
  );
}
