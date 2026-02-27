'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  tenant_type: string;
  is_active: boolean;
};

type PlanRow = {
  id: string;
  key: string;
  name: string;
};

type TenantModule = {
  module_key: string;
  enabled: boolean;
  source: string;
};

const MODULE_KEYS = ['tracks', 'assignments', 'assessments', 'reports', 'users', 'settings', 'billing'];

export default function AdminTenantsPage() {
  const router = useRouter();
  const { accessToken, hasRole, isLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [modules, setModules] = useState<TenantModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantSlug, setNewTenantSlug] = useState('');
  const [newTenantType, setNewTenantType] = useState('company');
  const [newTenantPlan, setNewTenantPlan] = useState<string>('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [selectedTenantId, tenants],
  );

  useEffect(() => {
    if (!isLoading && !hasRole('super_admin')) {
      router.replace('/dashboard');
    }
  }, [hasRole, isLoading, router]);

  useEffect(() => {
    const load = async () => {
      if (!accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const [tenantResponse, planResponse] = await Promise.all([
          api.get<{ items: TenantRow[] }>('/admin/tenants?page=1&page_size=200', accessToken),
          api.get<PlanRow[]>('/admin/plans', accessToken),
        ]);
        setTenants(tenantResponse.items);
        setPlans(planResponse);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [accessToken]);

  useEffect(() => {
    const loadModules = async () => {
      if (!accessToken || !selectedTenantId) return;
      try {
        const response = await api.get<TenantModule[]>(`/admin/tenants/${selectedTenantId}/modules`, accessToken);
        if (response.length === 0) {
          setModules(MODULE_KEYS.map((key) => ({ module_key: key, enabled: true, source: 'default' })));
        } else {
          setModules(response);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load modules');
      }
    };
    void loadModules();
  }, [accessToken, selectedTenantId]);

  const createTenant = async () => {
    if (!accessToken || !newTenantName || !newTenantSlug) return;
    setError(null);
    try {
      const payload = {
        name: newTenantName,
        slug: newTenantSlug,
        tenant_type: newTenantType,
        plan_id: newTenantPlan || null,
      };
      const created = await api.post<TenantRow>('/admin/tenants', payload, accessToken);
      setTenants((prev) => [created, ...prev]);
      setNewTenantName('');
      setNewTenantSlug('');
      setNewTenantPlan('');
      setSelectedTenantId(created.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create tenant');
    }
  };

  const toggleTenantActive = async (tenant: TenantRow) => {
    if (!accessToken) return;
    setError(null);
    try {
      const updated = await api.put<TenantRow>(
        `/admin/tenants/${tenant.id}`,
        { is_active: !tenant.is_active },
        accessToken,
      );
      setTenants((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update tenant');
    }
  };

  const saveModules = async () => {
    if (!accessToken || !selectedTenantId) return;
    setError(null);
    try {
      const payload = modules.map((module) => ({
        module_key: module.module_key,
        enabled: module.enabled,
      }));
      const updated = await api.put<TenantModule[]>(`/admin/tenants/${selectedTenantId}/modules`, payload, accessToken);
      setModules(updated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update modules');
    }
  };

  const inviteAdmin = async () => {
    if (!accessToken || !selectedTenantId || !inviteEmail || !inviteName) return;
    setError(null);
    try {
      await api.post(
        `/admin/tenants/${selectedTenantId}/admins`,
        { email: inviteEmail, full_name: inviteName, password: invitePassword || null },
        accessToken,
      );
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Failed to invite admin');
    }
  };

  if (loading) {
    return <p className='text-sm text-muted-foreground'>Loading admin console...</p>;
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Tenant administration</h2>
        <p className='text-sm text-muted-foreground'>Create tenants, assign plans, and manage modules.</p>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Create tenant</CardTitle>
          <CardDescription>Provision a tenant with an optional plan.</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-4'>
          <div className='space-y-2'>
            <Label>Name</Label>
            <Input value={newTenantName} onChange={(event) => setNewTenantName(event.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>Slug</Label>
            <Input value={newTenantSlug} onChange={(event) => setNewTenantSlug(event.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>Type</Label>
            <select
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={newTenantType}
              onChange={(event) => setNewTenantType(event.target.value)}
            >
              <option value='company'>company</option>
              <option value='education'>education</option>
            </select>
          </div>
          <div className='space-y-2'>
            <Label>Plan</Label>
            <select
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={newTenantPlan}
              onChange={(event) => setNewTenantPlan(event.target.value)}
            >
              <option value=''>No plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>
          <div className='md:col-span-4'>
            <Button onClick={createTenant} disabled={!newTenantName || !newTenantSlug}>
              Create tenant
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
          <CardDescription>Select a tenant to manage modules and admins.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          {tenants.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No tenants created yet.</p>
          ) : (
            tenants.map((tenant) => (
              <div
                key={tenant.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${
                  selectedTenantId === tenant.id ? 'border-primary' : 'border-muted'
                }`}
              >
                <div>
                  <p className='font-medium'>{tenant.name}</p>
                  <p className='text-xs text-muted-foreground'>
                    {tenant.slug} · {tenant.tenant_type}
                  </p>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button variant='outline' size='sm' onClick={() => setSelectedTenantId(tenant.id)}>
                    Manage
                  </Button>
                  <Button
                    variant={tenant.is_active ? 'secondary' : 'outline'}
                    size='sm'
                    onClick={() => toggleTenantActive(tenant)}
                  >
                    {tenant.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {selectedTenant && (
        <div className='grid gap-6 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>Modules for {selectedTenant.name}</CardTitle>
              <CardDescription>Toggle product modules for this tenant.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {modules.map((module) => (
                <label key={module.module_key} className='flex items-center justify-between text-sm'>
                  <span>{module.module_key}</span>
                  <input
                    type='checkbox'
                    checked={module.enabled}
                    onChange={(event) =>
                      setModules((prev) =>
                        prev.map((item) =>
                          item.module_key === module.module_key
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <Button onClick={saveModules}>Save modules</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invite tenant admin</CardTitle>
              <CardDescription>Create or link the first tenant admin.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='space-y-2'>
                <Label>Email</Label>
                <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label>Full name</Label>
                <Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label>Password (new user only)</Label>
                <Input
                  type='password'
                  value={invitePassword}
                  onChange={(event) => setInvitePassword(event.target.value)}
                />
              </div>
              <Button onClick={inviteAdmin}>Invite admin</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
