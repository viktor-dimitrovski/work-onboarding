'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
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

type PlanPriceRow = {
  id: string;
  plan_id: string;
  provider: string;
  billing_interval: string;
  currency: string;
  amount: number | string;
  provider_price_id?: string | null;
  nickname?: string | null;
};

type TenantModule = {
  module_key: string;
  enabled: boolean;
  source: string;
};

const MODULE_KEYS = ['tracks', 'assignments', 'assessments', 'reports', 'users', 'settings', 'billing', 'releases'];

function resolveBaseDomain(hostname: string): string {
  const raw = process.env.NEXT_PUBLIC_BASE_DOMAINS || process.env.BASE_DOMAINS || '';
  const baseDomains = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const host = (hostname || '').trim().toLowerCase();
  for (const base of baseDomains) {
    if (host === base || host.endsWith(`.${base}`)) {
      return base;
    }
  }

  // Fallback: assume a simple two-label base domain (works for localtest.me, app.local).
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return host;
}

function buildTenantUrl(tenantSlug: string): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname, port } = window.location;
  const baseDomain = resolveBaseDomain(hostname);
  if (!baseDomain) return null;

  const host = `${tenantSlug}.${baseDomain}`;
  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//${host}${portSuffix}/dashboard`;
}

export default function AdminTenantsPage() {
  const router = useRouter();
  const { accessToken, hasRole, isLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planPrices, setPlanPrices] = useState<PlanPriceRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [modules, setModules] = useState<TenantModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newPlanKey, setNewPlanKey] = useState('');
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanScope, setNewPlanScope] = useState('all');

  const [newPlanPricePlanId, setNewPlanPricePlanId] = useState('');
  const [newPlanPriceInterval, setNewPlanPriceInterval] = useState('month');
  const [newPlanPriceCurrency, setNewPlanPriceCurrency] = useState('usd');
  const [newPlanPriceAmount, setNewPlanPriceAmount] = useState('0.00');
  const [newPlanPriceProvider, setNewPlanPriceProvider] = useState('stripe');
  const [newPlanPriceProviderId, setNewPlanPriceProviderId] = useState('');
  const [newPlanPriceNickname, setNewPlanPriceNickname] = useState('');

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

  const planLookup = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);

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
        const [tenantResponse, planResponse, planPriceResponse] = await Promise.all([
          api.get<{ items: TenantRow[] }>('/admin/tenants?page=1&page_size=200', accessToken),
          api.get<PlanRow[]>('/admin/plans', accessToken),
          api.get<PlanPriceRow[]>('/billing/admin/plan-prices', accessToken),
        ]);
        setTenants(tenantResponse.items);
        setPlans(planResponse);
        setPlanPrices(planPriceResponse);
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

  useEffect(() => {
    if (!newPlanPricePlanId && plans[0]) {
      setNewPlanPricePlanId(plans[0].id);
    }
  }, [newPlanPricePlanId, plans]);

  const createPlan = async () => {
    if (!accessToken || !newPlanKey || !newPlanName) return;
    setError(null);
    try {
      const created = await api.post<PlanRow>(
        '/admin/plans',
        {
          key: newPlanKey,
          name: newPlanName,
          tenant_type_scope: newPlanScope,
          module_defaults: {},
          limits_json: {},
          is_active: true,
        },
        accessToken,
      );
      setPlans((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewPlanKey('');
      setNewPlanName('');
      setNewPlanScope('all');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create plan');
    }
  };

  const createPlanPrice = async () => {
    if (!accessToken || !newPlanPricePlanId) return;
    const amount = Number(newPlanPriceAmount);
    if (Number.isNaN(amount)) {
      setError('Plan price amount must be a number');
      return;
    }
    setError(null);
    try {
      const created = await api.post<PlanPriceRow>(
        '/billing/admin/plan-prices',
        {
          plan_id: newPlanPricePlanId,
          provider: newPlanPriceProvider,
          billing_interval: newPlanPriceInterval,
          currency: newPlanPriceCurrency,
          amount,
          provider_price_id: newPlanPriceProviderId || null,
          nickname: newPlanPriceNickname || null,
        },
        accessToken,
      );
      setPlanPrices((prev) => [created, ...prev]);
      setNewPlanPriceAmount('0.00');
      setNewPlanPriceProviderId('');
      setNewPlanPriceNickname('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create plan price');
    }
  };

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
    <AppShell>
      <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Tenant administration</h2>
        <p className='text-sm text-muted-foreground'>Create tenants, assign plans, and manage modules.</p>
      </div>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            Plans are global templates used when provisioning tenants. Create at least one plan if you want to assign it during tenant creation.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-6'>
          <div className='space-y-2 md:col-span-2'>
            <Label>Key</Label>
            <Input placeholder='pro' value={newPlanKey} onChange={(event) => setNewPlanKey(event.target.value)} />
          </div>
          <div className='space-y-2 md:col-span-3'>
            <Label>Name</Label>
            <Input placeholder='Pro' value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} />
          </div>
          <div className='space-y-2 md:col-span-1'>
            <Label>Scope</Label>
            <select
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={newPlanScope}
              onChange={(event) => setNewPlanScope(event.target.value)}
            >
              <option value='all'>all</option>
              <option value='company'>company</option>
              <option value='education'>education</option>
            </select>
          </div>
          <div className='md:col-span-6 flex items-center justify-between gap-3'>
            <div className='text-xs text-muted-foreground'>Existing: {plans.length}</div>
            <Button onClick={createPlan} disabled={!newPlanKey || !newPlanName}>
              Create plan
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan price mappings</CardTitle>
          <CardDescription>
            Map internal plans to Stripe prices for checkout and billing portal workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-6'>
            <div className='space-y-2 md:col-span-2'>
              <Label>Plan</Label>
              <select
                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                value={newPlanPricePlanId}
                onChange={(event) => setNewPlanPricePlanId(event.target.value)}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-2 md:col-span-1'>
              <Label>Interval</Label>
              <select
                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                value={newPlanPriceInterval}
                onChange={(event) => setNewPlanPriceInterval(event.target.value)}
              >
                <option value='month'>month</option>
                <option value='year'>year</option>
              </select>
            </div>
            <div className='space-y-2 md:col-span-1'>
              <Label>Currency</Label>
              <Input value={newPlanPriceCurrency} onChange={(event) => setNewPlanPriceCurrency(event.target.value)} />
            </div>
            <div className='space-y-2 md:col-span-1'>
              <Label>Amount</Label>
              <Input value={newPlanPriceAmount} onChange={(event) => setNewPlanPriceAmount(event.target.value)} />
            </div>
            <div className='space-y-2 md:col-span-1'>
              <Label>Provider</Label>
              <Input value={newPlanPriceProvider} onChange={(event) => setNewPlanPriceProvider(event.target.value)} />
            </div>
            <div className='space-y-2 md:col-span-3'>
              <Label>Provider price ID</Label>
              <Input
                placeholder='price_123'
                value={newPlanPriceProviderId}
                onChange={(event) => setNewPlanPriceProviderId(event.target.value)}
              />
            </div>
            <div className='space-y-2 md:col-span-3'>
              <Label>Nickname</Label>
              <Input
                placeholder='Pro monthly'
                value={newPlanPriceNickname}
                onChange={(event) => setNewPlanPriceNickname(event.target.value)}
              />
            </div>
          </div>
          <div className='flex items-center justify-between gap-3'>
            <div className='text-xs text-muted-foreground'>Existing: {planPrices.length}</div>
            <Button onClick={createPlanPrice} disabled={!newPlanPricePlanId}>
              Create plan price
            </Button>
          </div>
          {planPrices.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No plan price mappings yet.</p>
          ) : (
            <div className='space-y-2'>
              {planPrices.map((price) => {
                const planName = planLookup.get(price.plan_id)?.name || price.plan_id;
                return (
                  <div key={price.id} className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                    <div>
                      <p className='font-medium'>{planName}</p>
                      <p className='text-xs text-muted-foreground'>
                        {price.billing_interval} · {price.currency.toUpperCase()} · {price.provider}
                      </p>
                    </div>
                    <div className='text-right'>
                      <p className='font-medium'>{price.amount}</p>
                      <p className='text-xs text-muted-foreground'>{price.provider_price_id || 'No provider price id'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      const url = buildTenantUrl(tenant.slug);
                      if (!url) return;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    title='Open tenant in a new tab'
                  >
                    <ExternalLink className='h-4 w-4' />
                    Open
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
    </AppShell>
  );
}
