'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrServiceListItem } from '@/lib/types';
import { irStatusTone, formatDateShort } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/common/loading-state';
import { EmptyState } from '@/components/common/empty-state';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ServiceFormData = {
  name: string;
  service_type: string;
  owner_team: string;
  status: string;
  description: string;
  change_reason: string;
};

const EMPTY_FORM: ServiceFormData = {
  name: '',
  service_type: '',
  owner_team: '',
  status: 'active',
  description: '',
  change_reason: '',
};

export default function IrServicesPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [services, setServices] = useState<IrServiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceFormData>(EMPTY_FORM);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:read')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  const loadServices = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<IrServiceListItem[]>('/integration-registry/services', accessToken)
      .then(setServices)
      .catch((e) => setError(e.message || 'Failed to load services'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => { loadServices(); }, [loadServices]);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setDrawerOpen(true);
  };

  const openEdit = (svc: IrServiceListItem) => {
    setEditId(svc.id);
    setForm({
      name: svc.name,
      service_type: svc.service_type || '',
      owner_team: svc.owner_team || '',
      status: svc.status,
      description: '',
      change_reason: '',
    });
    setSaveError(null);
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!accessToken) return;
    if (!form.change_reason.trim()) {
      setSaveError('Change reason is required');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (editId) {
        await api.put(`/integration-registry/services/${editId}`, form, accessToken);
      } else {
        await api.post('/integration-registry/services', form, accessToken);
      }
      setDrawerOpen(false);
      loadServices();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Logical service catalog — SXS, BC Connectors, IBANK Directory, and more.
          </p>
        </div>
        {hasPermission('ir:write') && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            New Service
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Loading services…" />
          ) : services.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No services yet"
                description="Create your first logical service to start adding integration instances."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Name</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Type</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Owner Team</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Status</th>
                    <th className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Instances</th>
                    {hasPermission('ir:write') && (
                      <th className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc) => (
                    <tr key={svc.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 font-medium">{svc.name}</td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">{svc.service_type || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">{svc.owner_team || '—'}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={`text-xs ${irStatusTone(svc.status)}`}>
                          {svc.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{svc.instance_count}</td>
                      {hasPermission('ir:write') && (
                        <td className="py-3 px-4 text-right">
                          <button
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            onClick={() => openEdit(svc)}
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="flex h-full w-full max-w-lg flex-col">
          <SheetHeader>
            <SheetTitle>{editId ? 'Edit Service' : 'New Service'}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-name">Name *</Label>
              <Input
                id="svc-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. SXS, BC Connectors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-type">Service Type</Label>
              <select
                id="svc-type"
                value={form.service_type}
                onChange={(e) => setForm((f) => ({ ...f, service_type: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              >
                <option value="">Select type…</option>
                <option value="HTTP_API">HTTP API</option>
                <option value="DATABASE">Database</option>
                <option value="MESSAGE_BROKER">Message Broker</option>
                <option value="GRPC">gRPC</option>
                <option value="SFTP">SFTP</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-owner">Owner Team</Label>
              <Input
                id="svc-owner"
                value={form.owner_team}
                onChange={(e) => setForm((f) => ({ ...f, owner_team: e.target.value }))}
                placeholder="e.g. Platform Team"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-status">Status</Label>
              <select
                id="svc-status"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="disabled">Disabled</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-desc">Description</Label>
              <Textarea
                id="svc-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short description of this service"
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-reason">
                Change Reason <span className="text-red-500">*</span>
              </Label>
              <Input
                id="svc-reason"
                value={form.change_reason}
                onChange={(e) => setForm((f) => ({ ...f, change_reason: e.target.value }))}
                placeholder="Why are you making this change?"
              />
            </div>

            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            )}
          </div>

          <div className="border-t pt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDrawerOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Service'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
