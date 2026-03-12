'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, LayoutGrid, Pencil, Settings2, Trash2, Users2, Wallet, X } from 'lucide-react';

import { LoadingState } from '@/components/common/loading-state';
import { AppShell } from '@/components/layout/app-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { roleDisplayName, tenantRoleGroups } from '@/lib/constants';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  tenant_type: string;
  is_active: boolean;
  active_plan_id: string | null;
  active_plan_name: string | null;
};

type PlanRow = {
  id: string;
  key: string;
  name: string;
  tenant_type_scope: string;
  module_defaults: Record<string, boolean>;
  limits_json: Record<string, number>;
  is_active: boolean;
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
  plan_default: boolean | null;
};

type TenantMemberRow = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  roles: string[];
  status: string;
  created_at: string;
};

const MODULE_META: Record<string, { label: string; description: string }> = {
  tracks:               { label: 'Tracks',               description: 'Onboarding track builder and publishing' },
  assignments:          { label: 'Assignments',           description: 'Assign tracks to users and track completion' },
  assessments:          { label: 'Assessments',           description: 'Tests, quizzes and scoring' },
  reports:              { label: 'Reports',               description: 'Completion and progress reporting' },
  compliance:           { label: 'Compliance',            description: 'Regulatory compliance practices and gap analysis' },
  releases:             { label: 'Releases',              description: 'Software release management and keybindings' },
  integration_registry: { label: 'Integration Registry',  description: 'Third-party integration catalogue and approvals' },
  billing:              { label: 'Billing',               description: 'Subscription management and usage metering' },
  users:                { label: 'Users & Teams',         description: 'Member management and role assignment' },
  settings:             { label: 'Settings',              description: 'Tenant configuration and preferences' },
};

type AdminSectionId = 'tenants' | 'tenant' | 'plans' | 'billing';

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

function NavItem({
  active,
  title,
  description,
  icon,
  badge,
  disabled,
  onClick,
}: {
  active: boolean;
  title: string;
  description?: string;
  icon: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full rounded-lg border px-3 py-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/50',
        active ? 'border-primary bg-primary/5' : 'border-border bg-white',
      ].join(' ')}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <div className='mt-0.5 text-muted-foreground'>{icon}</div>
          <div>
            <div className='flex items-center gap-2'>
              <p className='text-sm font-semibold leading-none'>{title}</p>
              {badge}
            </div>
            {description ? <p className='mt-1 text-xs text-muted-foreground'>{description}</p> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function AdminTenantsPage() {
  const router = useRouter();
  const { accessToken, hasRole, isAuthenticated, isLoading } = useAuth();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planPrices, setPlanPrices] = useState<PlanPriceRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [modules, setModules] = useState<TenantModule[]>([]);
  const [savedModules, setSavedModules] = useState<TenantModule[]>([]);
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
  const [newTenantAdminEmail, setNewTenantAdminEmail] = useState('');
  const [newTenantAdminName, setNewTenantAdminName] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [tenantMembers, setTenantMembers] = useState<TenantMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editingRolesMemberId, setEditingRolesMemberId] = useState<string | null>(null);
  const [editMemberRoles, setEditMemberRoles] = useState<string[]>([]);

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPlanName, setEditPlanName] = useState('');
  const [editPlanScope, setEditPlanScope] = useState('all');
  const [editPlanActive, setEditPlanActive] = useState(true);

  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceAmount, setEditPriceAmount] = useState('');
  const [editPriceInterval, setEditPriceInterval] = useState('month');
  const [editPriceCurrency, setEditPriceCurrency] = useState('');
  const [editPriceProvider, setEditPriceProvider] = useState('');
  const [editPriceProviderId, setEditPriceProviderId] = useState('');
  const [editPriceNickname, setEditPriceNickname] = useState('');

  const [activeSection, setActiveSection] = useState<AdminSectionId>('tenants');
  const [navFilter, setNavFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [selectedTenantId, tenants],
  );

  const planLookup = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);

  const enabledModuleKeys = useMemo(
    () => new Set(modules.filter((m) => m.enabled).map((m) => m.module_key)),
    [modules],
  );

  const modulesAreDirty = useMemo(() => {
    if (modules.length !== savedModules.length) return true;
    const savedMap = new Map(savedModules.map((m) => [m.module_key, m.enabled]));
    return modules.some((m) => savedMap.get(m.module_key) !== m.enabled);
  }, [modules, savedModules]);

  const modulesHaveOverrides = useMemo(
    () => modules.some((m) => m.source === 'override'),
    [modules],
  );

  const availableInviteGroups = useMemo(
    () =>
      tenantRoleGroups.filter(
        (g) => g.moduleKey !== null && enabledModuleKeys.has(g.moduleKey),
      ),
    [enabledModuleKeys],
  );

  useEffect(() => {
    if (selectedTenantId) {
      setActiveSection('tenant');
      return;
    }
    setActiveSection((prev) => (prev === 'tenant' ? 'tenants' : prev));
  }, [selectedTenantId]);

  useEffect(() => {
    if (isLoading || typeof window === 'undefined') return;
    if (!isAuthenticated) return;

    const baseDomain = resolveBaseDomain(window.location.hostname);
    const isAdminHost = window.location.hostname === `admin.${baseDomain}`;
    const defaultSlug = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG;
    const { protocol, port } = window.location;
    const portSuffix = port ? `:${port}` : '';

    if (!hasRole('super_admin')) {
      // No super_admin → send to default tenant dashboard.
      // On admin host, router.replace('/dashboard') would loop back via middleware rewrite.
      if (isAdminHost && defaultSlug) {
        window.location.replace(`${protocol}//${defaultSlug}.${baseDomain}${portSuffix}/dashboard`);
        return;
      }
      router.replace('/dashboard');
      return;
    }

    // Has super_admin but on a tenant host → redirect to admin subdomain.
    // Backend enforces require_product_admin_host in production, so API calls
    // would fail from any non-admin host.
    if (!isAdminHost) {
      window.location.replace(`${protocol}//admin.${baseDomain}${portSuffix}/admin`);
    }
  }, [hasRole, isAuthenticated, isLoading, router]);

  useEffect(() => {
    const load = async () => {
      // Wait for auth to settle and verify the user actually has super_admin before
      // making any API calls. Without this guard a non-super_admin user with a valid
      // token would hit the admin API, receive a 403, and briefly see the error
      // before the redirect effect fires.
      if (!accessToken || isLoading || !isAuthenticated || !hasRole('super_admin')) return;
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
  }, [accessToken, hasRole, isAuthenticated, isLoading]);

  useEffect(() => {
    const loadModules = async () => {
      if (!accessToken || !selectedTenantId) return;
      try {
        const response = await api.get<TenantModule[]>(`/admin/tenants/${selectedTenantId}/modules`, accessToken);
        setModules(response);
        setSavedModules(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load modules');
      }
    };
    void loadModules();
  }, [accessToken, selectedTenantId]);

  useEffect(() => {
    const loadMembers = async () => {
      if (!accessToken || !selectedTenantId) {
        setTenantMembers([]);
        return;
      }
      setMembersLoading(true);
      try {
        const response = await api.get<TenantMemberRow[]>(`/admin/tenants/${selectedTenantId}/members`, accessToken);
        setTenantMembers(response);
      } catch {
        setTenantMembers([]);
      } finally {
        setMembersLoading(false);
      }
    };
    void loadMembers();
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
      const payload: Record<string, unknown> = {
        name: newTenantName,
        slug: newTenantSlug,
        tenant_type: newTenantType,
        plan_id: newTenantPlan || null,
      };
      if (newTenantAdminEmail) {
        payload.admin_email = newTenantAdminEmail;
        payload.admin_full_name = newTenantAdminName || null;
      }
      const created = await api.post<TenantRow>('/admin/tenants', payload, accessToken);
      setTenants((prev) => [created, ...prev]);
      setNewTenantName('');
      setNewTenantSlug('');
      setNewTenantPlan('');
      setNewTenantAdminEmail('');
      setNewTenantAdminName('');
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
      setSavedModules(updated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update modules');
    }
  };

  const resetToPlanModules = async () => {
    if (!accessToken || !selectedTenantId) return;
    const tenant = tenants.find((t) => t.id === selectedTenantId);
    if (!tenant?.active_plan_id) return;
    setError(null);
    try {
      await api.put(`/admin/tenants/${selectedTenantId}/plan`, { plan_id: tenant.active_plan_id }, accessToken);
      const updated = await api.get<TenantModule[]>(`/admin/tenants/${selectedTenantId}/modules`, accessToken);
      setModules(updated);
      setSavedModules(updated);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset modules to plan');
    }
  };

  const resetSingleModule = (moduleKey: string) => {
    setModules((prev) =>
      prev.map((m) =>
        m.module_key === moduleKey && m.plan_default !== null
          ? { ...m, enabled: m.plan_default, source: 'plan' }
          : m,
      ),
    );
  };

  const reloadMembers = async () => {
    if (!accessToken || !selectedTenantId) return;
    try {
      const response = await api.get<TenantMemberRow[]>(`/admin/tenants/${selectedTenantId}/members`, accessToken);
      setTenantMembers(response);
    } catch { /* ignore */ }
  };

  const inviteAdmin = async () => {
    if (!accessToken || !selectedTenantId || !inviteEmail || !inviteName) return;
    setError(null);
    try {
      await api.post(
        `/admin/tenants/${selectedTenantId}/admins`,
        { email: inviteEmail, full_name: inviteName, roles: inviteRoles },
        accessToken,
      );
      setInviteEmail('');
      setInviteName('');
      setInviteRoles([]);
      await reloadMembers();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Failed to invite admin');
    }
  };

  const toggleMemberStatus = async (member: TenantMemberRow) => {
    if (!accessToken || !selectedTenantId) return;
    const newStatus = member.status === 'active' ? 'disabled' : 'active';
    try {
      const updated = await api.patch<TenantMemberRow>(
        `/admin/tenants/${selectedTenantId}/members/${member.id}`,
        { status: newStatus },
        accessToken,
      );
      setTenantMembers((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member');
    }
  };

  const removeMember = async (member: TenantMemberRow) => {
    if (!accessToken || !selectedTenantId) return;
    if (!confirm(`Remove ${member.email} from this tenant? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/tenants/${selectedTenantId}/members/${member.id}`, accessToken);
      setTenantMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const startEditMember = (member: TenantMemberRow) => {
    setEditingMemberId(member.id);
    setEditMemberName(member.full_name || '');
  };

  const cancelEditMember = () => {
    setEditingMemberId(null);
    setEditMemberName('');
  };

  const startEditRoles = (member: TenantMemberRow) => {
    setEditingRolesMemberId(member.id);
    setEditMemberRoles(member.roles);
  };

  const cancelEditRoles = () => {
    setEditingRolesMemberId(null);
    setEditMemberRoles([]);
  };

  const saveRoles = async () => {
    if (!accessToken || !selectedTenantId || !editingRolesMemberId) return;
    if (editMemberRoles.length === 0) {
      setError('At least one role is required');
      return;
    }
    setError(null);
    try {
      const updated = await api.patch<TenantMemberRow>(
        `/admin/tenants/${selectedTenantId}/members/${editingRolesMemberId}`,
        { roles: editMemberRoles },
        accessToken,
      );
      setTenantMembers((prev) => prev.map((m) => (m.id === editingRolesMemberId ? updated : m)));
      cancelEditRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update roles');
    }
  };

  const saveMemberName = async () => {
    if (!accessToken || !selectedTenantId || !editingMemberId) return;
    const trimmed = editMemberName.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setError(null);
    try {
      const updated = await api.patch<TenantMemberRow>(
        `/admin/tenants/${selectedTenantId}/members/${editingMemberId}`,
        { full_name: trimmed },
        accessToken,
      );
      setTenantMembers((prev) => prev.map((m) => (m.id === editingMemberId ? updated : m)));
      cancelEditMember();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member name');
    }
  };

  const startEditPlan = (plan: PlanRow) => {
    setEditingPlanId(plan.id);
    setEditPlanName(plan.name);
    setEditPlanScope(plan.tenant_type_scope);
    setEditPlanActive(plan.is_active);
  };

  const cancelEditPlan = () => setEditingPlanId(null);

  const savePlan = async () => {
    if (!accessToken || !editingPlanId) return;
    setError(null);
    try {
      const updated = await api.put<PlanRow>(
        `/admin/plans/${editingPlanId}`,
        { name: editPlanName, tenant_type_scope: editPlanScope, is_active: editPlanActive },
        accessToken,
      );
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingPlanId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    }
  };

  const deletePlan = async (planId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.delete(`/admin/plans/${planId}`, accessToken);
      setPlans((prev) => prev.filter((p) => p.id !== planId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    }
  };

  const startEditPrice = (price: PlanPriceRow) => {
    setEditingPriceId(price.id);
    setEditPriceAmount(String(price.amount));
    setEditPriceInterval(price.billing_interval);
    setEditPriceCurrency(price.currency);
    setEditPriceProvider(price.provider);
    setEditPriceProviderId(price.provider_price_id || '');
    setEditPriceNickname(price.nickname || '');
  };

  const cancelEditPrice = () => setEditingPriceId(null);

  const savePrice = async () => {
    if (!accessToken || !editingPriceId) return;
    const amount = Number(editPriceAmount);
    if (Number.isNaN(amount)) {
      setError('Amount must be a number');
      return;
    }
    setError(null);
    try {
      const updated = await api.put<PlanPriceRow>(
        `/billing/admin/plan-prices/${editingPriceId}`,
        {
          amount,
          billing_interval: editPriceInterval,
          currency: editPriceCurrency,
          provider: editPriceProvider,
          provider_price_id: editPriceProviderId || null,
          nickname: editPriceNickname || null,
        },
        accessToken,
      );
      setPlanPrices((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingPriceId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan price');
    }
  };

  const deletePrice = async (priceId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.delete(`/billing/admin/plan-prices/${priceId}`, accessToken);
      setPlanPrices((prev) => prev.filter((p) => p.id !== priceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan price');
    }
  };

  const filteredTenants = useMemo(() => {
    const query = tenantFilter.trim().toLowerCase();
    if (!query) return tenants;
    return tenants.filter((tenant) => {
      return (
        tenant.name.toLowerCase().includes(query) ||
        tenant.slug.toLowerCase().includes(query) ||
        tenant.tenant_type.toLowerCase().includes(query)
      );
    });
  }, [tenantFilter, tenants]);

  const navItems = useMemo(() => {
    const items: Array<{
      id: AdminSectionId;
      title: string;
      description: string;
      icon: React.ReactNode;
      badge?: React.ReactNode;
      disabled?: boolean;
    }> = [
      {
        id: 'tenants',
        title: 'Tenants',
        description: 'Provision, activate, and manage tenant access.',
        icon: <Users2 className='h-4 w-4' />,
        badge: (
          <Badge variant='muted' className='text-[10px]'>
            {tenants.length}
          </Badge>
        ),
      },
      {
        id: 'tenant',
        title: 'Tenant settings',
        description: 'Modules + admin invitation for a selected tenant.',
        icon: <Settings2 className='h-4 w-4' />,
        disabled: !selectedTenant,
        badge: selectedTenant ? (
          <Badge variant='secondary' className='text-[10px]'>
            {selectedTenant.slug}
          </Badge>
        ) : undefined,
      },
      {
        id: 'plans',
        title: 'Plans',
        description: 'Global plan templates used during provisioning.',
        icon: <LayoutGrid className='h-4 w-4' />,
        badge: (
          <Badge variant='muted' className='text-[10px]'>
            {plans.length}
          </Badge>
        ),
      },
      {
        id: 'billing',
        title: 'Billing mappings',
        description: 'Plan ↔ provider price mappings (Stripe etc.).',
        icon: <Wallet className='h-4 w-4' />,
        badge: (
          <Badge variant='muted' className='text-[10px]'>
            {planPrices.length}
          </Badge>
        ),
      },
    ];

    const q = navFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    });
  }, [navFilter, planPrices.length, plans.length, selectedTenant, tenants.length]);

  return (
    <AppShell>
      <div className='space-y-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-semibold'>Tenant administration</h2>
            <p className='text-sm text-muted-foreground'>
              A compact, searchable console for provisioning tenants and configuring modules, plans, and billing.
            </p>
          </div>
          {selectedTenant ? (
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant={selectedTenant.is_active ? 'secondary' : 'outline'} className='text-[10px]'>
                {selectedTenant.is_active ? 'Active' : 'Disabled'}
              </Badge>
              <Badge variant='outline' className='text-[10px]'>
                {selectedTenant.tenant_type}
              </Badge>
              <Badge variant='muted' className='text-[10px]'>
                {selectedTenant.slug}
              </Badge>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  const url = buildTenantUrl(selectedTenant.slug);
                  if (!url) return;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                title='Open tenant in a new tab'
              >
                <ExternalLink className='mr-2 h-4 w-4' />
                Open tenant
              </Button>
            </div>
          ) : null}
        </div>

        {error ? (
          <Alert variant='destructive'>
            <AlertTitle>Admin console error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <LoadingState label='Loading admin console…' />
        ) : (
          <div className='grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:h-[calc(100vh-14rem)]'>
            <Card className='flex min-h-0 flex-col'>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>Console navigation</CardTitle>
                <CardDescription>Jump between sections without losing context.</CardDescription>
              </CardHeader>
              <CardContent className='min-h-0 flex-1 pt-0'>
                <div className='flex min-h-0 flex-1 flex-col gap-3'>
                  <div className='space-y-2'>
                    <Label className='text-xs'>Search sections</Label>
                    <Input
                      placeholder='Tenants, plans, billing…'
                      value={navFilter}
                      onChange={(event) => setNavFilter(event.target.value)}
                    />
                  </div>

                  <ScrollArea className='min-h-0 flex-1 pr-2'>
                    <div className='space-y-2'>
                      {navItems.map((item) => (
                        <NavItem
                          key={item.id}
                          active={activeSection === item.id}
                          title={item.title}
                          description={item.description}
                          icon={item.icon}
                          badge={item.badge}
                          disabled={item.disabled}
                          onClick={() => setActiveSection(item.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <Card className='flex min-h-0 flex-col'>
              <CardHeader className='border-b bg-white/70 pb-3 backdrop-blur'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <CardTitle>
                      {activeSection === 'tenants'
                        ? 'Tenants'
                        : activeSection === 'tenant'
                          ? selectedTenant
                            ? `Tenant settings — ${selectedTenant.name}`
                            : 'Tenant settings'
                          : activeSection === 'plans'
                            ? 'Plans'
                            : 'Billing mappings'}
                    </CardTitle>
                    <CardDescription>
                      {activeSection === 'tenants'
                        ? 'Provision tenants and manage access.'
                        : activeSection === 'tenant'
                          ? 'Configure the selected tenant. Designed to scale as more settings are added.'
                          : activeSection === 'plans'
                            ? 'Plan templates that drive provisioning defaults.'
                            : 'Provider price mappings used for checkout and billing workflows.'}
                    </CardDescription>
                  </div>
                  {activeSection === 'tenant' && selectedTenant ? (
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button
                        variant={selectedTenant.is_active ? 'secondary' : 'outline'}
                        size='sm'
                        onClick={() => toggleTenantActive(selectedTenant)}
                      >
                        {selectedTenant.is_active ? 'Disable tenant' : 'Enable tenant'}
                      </Button>
                      <Button variant='outline' size='sm' onClick={() => setSelectedTenantId(null)}>
                        Clear selection
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className='min-h-0 flex-1 p-0'>
                <ScrollArea className='h-full'>
                  <div className='space-y-6 p-5'>
                    {activeSection === 'tenants' ? (
                      <div className='grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]'>
                        <div className='space-y-4'>
                          <div className='rounded-lg border bg-white p-4'>
                            <div className='flex items-start justify-between gap-4'>
                              <div>
                                <p className='text-sm font-semibold'>Create tenant</p>
                                <p className='mt-1 text-xs text-muted-foreground'>Provision a new tenant with an optional plan.</p>
                              </div>
                              <Badge variant='muted' className='text-[10px]'>
                                Provisioning
                              </Badge>
                            </div>

                            <div className='mt-4 grid gap-3'>
                              <div className='grid gap-3 sm:grid-cols-2'>
                                <div className='space-y-2'>
                                  <Label>Name</Label>
                                  <Input value={newTenantName} onChange={(event) => setNewTenantName(event.target.value)} />
                                </div>
                                <div className='space-y-2'>
                                  <Label>Slug</Label>
                                  <Input value={newTenantSlug} onChange={(event) => setNewTenantSlug(event.target.value)} />
                                </div>
                              </div>
                              <div className='grid gap-3 sm:grid-cols-2'>
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
                              </div>

                              <div className='grid gap-3 sm:grid-cols-2'>
                                <div className='space-y-2'>
                                  <Label>Admin email <span className='text-muted-foreground font-normal'>(optional)</span></Label>
                                  <Input
                                    type='email'
                                    placeholder='admin@company.com'
                                    value={newTenantAdminEmail}
                                    onChange={(event) => setNewTenantAdminEmail(event.target.value)}
                                  />
                                </div>
                                <div className='space-y-2'>
                                  <Label>Admin full name</Label>
                                  <Input
                                    placeholder='Jane Doe'
                                    value={newTenantAdminName}
                                    onChange={(event) => setNewTenantAdminName(event.target.value)}
                                  />
                                </div>
                              </div>
                              {newTenantAdminEmail && (
                                <p className='text-xs text-muted-foreground'>An invitation email with a set-password link will be sent to this admin.</p>
                              )}

                              <div className='flex items-center justify-end gap-2 pt-1'>
                                <Button onClick={createTenant} disabled={!newTenantName || !newTenantSlug}>
                                  Create tenant
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className='rounded-lg border bg-white p-4'>
                            <p className='text-sm font-semibold'>Tenant directory</p>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Filter and select a tenant to manage modules and admins.
                            </p>
                            <div className='mt-3 space-y-2'>
                              <Label className='text-xs'>Search tenants</Label>
                              <Input
                                placeholder='Name, slug, type…'
                                value={tenantFilter}
                                onChange={(event) => setTenantFilter(event.target.value)}
                              />
                            </div>
                          </div>
                        </div>

                        <div className='rounded-lg border bg-white'>
                          <div className='flex items-center justify-between gap-3 border-b p-4'>
                            <div>
                              <p className='text-sm font-semibold'>Tenants</p>
                              <p className='text-xs text-muted-foreground'>
                                Showing {filteredTenants.length} of {tenants.length}
                              </p>
                            </div>
                            <Badge variant='muted' className='text-[10px]'>
                              Select to manage
                            </Badge>
                          </div>
                          <ScrollArea className='h-[520px]'>
                            <div className='space-y-2 p-4'>
                              {filteredTenants.length === 0 ? (
                                <p className='text-sm text-muted-foreground'>No tenants match your search.</p>
                              ) : (
                                filteredTenants.map((tenant) => (
                                  <div
                                    key={tenant.id}
                                    className={[
                                      'rounded-lg border p-3',
                                      selectedTenantId === tenant.id ? 'border-primary bg-primary/5' : 'border-border',
                                    ].join(' ')}
                                  >
                                    <div className='flex flex-wrap items-start justify-between gap-3'>
                                      <div>
                                        <p className='text-sm font-semibold leading-none'>{tenant.name}</p>
                                        <p className='mt-1 text-xs text-muted-foreground'>
                                          {tenant.slug} · {tenant.tenant_type}
                                        </p>
                                        <div className='mt-2 flex flex-wrap items-center gap-2'>
                                          <Badge
                                            variant={tenant.is_active ? 'secondary' : 'outline'}
                                            className='text-[10px]'
                                          >
                                            {tenant.is_active ? 'Active' : 'Disabled'}
                                          </Badge>
                                        </div>
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
                                          <span className='ml-2 hidden sm:inline'>Open</span>
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
                                  </div>
                                ))
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </div>
                    ) : null}

                    {activeSection === 'tenant' ? (
                      selectedTenant ? (
                        <Tabs defaultValue='modules'>
                          <TabsList className='w-full justify-start'>
                            <TabsTrigger value='modules'>Modules</TabsTrigger>
                            <TabsTrigger value='members'>Members</TabsTrigger>
                            <TabsTrigger value='invite'>Invite user</TabsTrigger>
                          </TabsList>

                          <TabsContent value='modules'>
                            <div className='rounded-lg border bg-white p-4'>
                              {/* Header */}
                              <div className='flex flex-wrap items-start justify-between gap-3'>
                                <div>
                                  <div className='flex items-center gap-2'>
                                    <p className='text-sm font-semibold'>Module access</p>
                                    {selectedTenant.active_plan_name && (
                                      <span className='rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700'>
                                        {selectedTenant.active_plan_name}
                                      </span>
                                    )}
                                  </div>
                                  <p className='mt-1 text-xs text-muted-foreground'>
                                    Enable or disable product modules for this tenant. Users can only access modules that are enabled here, regardless of their role assignments.
                                  </p>
                                </div>
                                <div className='flex items-center gap-2'>
                                  {selectedTenant.active_plan_name && modulesHaveOverrides && (
                                    <Button
                                      variant='outline'
                                      size='sm'
                                      onClick={resetToPlanModules}
                                      title='Remove all manual overrides and restore the plan defaults'
                                    >
                                      Reset to plan
                                    </Button>
                                  )}
                                  <Button
                                    size='sm'
                                    disabled={!modulesAreDirty}
                                    onClick={saveModules}
                                  >
                                    Save changes
                                  </Button>
                                </div>
                              </div>

                              {/* Module cards */}
                              <div className='mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                                {modules.map((module) => {
                                  const meta = MODULE_META[module.module_key] ?? { label: module.module_key, description: '' };
                                  const isOverride = module.source === 'override';
                                  return (
                                    <div
                                      key={module.module_key}
                                      className={[
                                        'group relative flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition-colors',
                                        module.enabled ? 'border-border bg-white' : 'border-border bg-muted/20',
                                      ].join(' ')}
                                    >
                                      <div className='flex-1 min-w-0'>
                                        <div className='flex items-center gap-2 flex-wrap'>
                                          <span className='font-medium leading-none'>{meta.label}</span>
                                          {isOverride ? (
                                            <span className='inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700'>
                                              Custom
                                              {module.plan_default !== null && (
                                                <button
                                                  type='button'
                                                  onClick={() => resetSingleModule(module.module_key)}
                                                  title='Reset to plan default'
                                                  className='ml-0.5 hover:text-amber-900'
                                                >
                                                  <X className='h-2.5 w-2.5' />
                                                </button>
                                              )}
                                            </span>
                                          ) : (
                                            <span className='rounded-full border border-muted bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
                                              Plan
                                            </span>
                                          )}
                                        </div>
                                        {meta.description && (
                                          <p className='mt-1 text-[11px] text-muted-foreground leading-snug'>{meta.description}</p>
                                        )}
                                      </div>
                                      {/* Toggle switch */}
                                      <button
                                        type='button'
                                        role='switch'
                                        aria-checked={module.enabled}
                                        onClick={() =>
                                          setModules((prev) =>
                                            prev.map((item) => {
                                              if (item.module_key !== module.module_key) return item;
                                              const newEnabled = !item.enabled;
                                              const matchesPlan = item.plan_default !== null && newEnabled === item.plan_default;
                                              return { ...item, enabled: newEnabled, source: matchesPlan ? 'plan' : 'override' };
                                            }),
                                          )
                                        }
                                        className={[
                                          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150',
                                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                                          module.enabled ? 'bg-primary' : 'bg-input',
                                        ].join(' ')}
                                      >
                                        <span
                                          className={[
                                            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150',
                                            module.enabled ? 'translate-x-4' : 'translate-x-0',
                                          ].join(' ')}
                                        />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>

                              {modulesAreDirty && (
                                <p className='mt-3 text-[11px] text-muted-foreground'>
                                  You have unsaved changes. Click <span className='font-medium'>Save changes</span> to apply.
                                </p>
                              )}
                            </div>
                          </TabsContent>

                          <TabsContent value='members'>
                            <div className='rounded-lg border bg-white p-4'>
                                <div className='flex flex-wrap items-start justify-between gap-3'>
                                  <div>
                                    <p className='text-sm font-semibold'>Tenant members</p>
                                    <p className='mt-1 text-xs text-muted-foreground'>
                                      All users with access to <span className='font-medium'>{selectedTenant.slug}</span>. Edit roles, disable, or remove members.
                                    </p>
                                  </div>
                                  <Badge variant='muted' className='text-[10px]'>
                                    {tenantMembers.length} member{tenantMembers.length !== 1 ? 's' : ''}
                                  </Badge>
                                </div>

                                {membersLoading ? (
                                  <p className='mt-4 text-sm text-muted-foreground'>Loading members...</p>
                                ) : tenantMembers.length === 0 ? (
                                  <p className='mt-4 text-sm text-muted-foreground'>No members yet. Invite one below.</p>
                                ) : (
                                  <div className='mt-4 overflow-x-auto'>
                                    <table className='w-full text-sm'>
                                      <thead>
                                        <tr className='border-b text-left text-muted-foreground'>
                                          <th className='px-3 py-2 font-medium'>User</th>
                                          <th className='px-3 py-2 font-medium'>Roles</th>
                                          <th className='px-3 py-2 font-medium'>Status</th>
                                          <th className='px-3 py-2 text-right font-medium'>Actions</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {tenantMembers.map((member) => (
                                          <tr key={member.id} className='border-b last:border-b-0'>
                                            <td className='px-3 py-2'>
                                              {editingMemberId === member.id ? (
                                                <div className='flex items-center gap-2'>
                                                  <Input
                                                    value={editMemberName}
                                                    onChange={(e) => setEditMemberName(e.target.value)}
                                                    placeholder='Full name'
                                                    className='h-8 max-w-[180px]'
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') saveMemberName();
                                                      if (e.key === 'Escape') cancelEditMember();
                                                    }}
                                                  />
                                                  <Button variant='ghost' size='sm' onClick={saveMemberName}>
                                                    Save
                                                  </Button>
                                                  <Button variant='ghost' size='sm' onClick={cancelEditMember}>
                                                    Cancel
                                                  </Button>
                                                </div>
                                              ) : (
                                                <div className='flex items-center gap-2'>
                                                  <div>
                                                    <div className='font-medium leading-5'>{member.full_name || '—'}</div>
                                                    <div className='text-xs text-muted-foreground'>{member.email}</div>
                                                  </div>
                                                  <Button
                                                    variant='ghost'
                                                    size='sm'
                                                    className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
                                                    onClick={() => startEditMember(member)}
                                                    title='Edit name'
                                                  >
                                                    <Pencil className='h-3.5 w-3.5' />
                                                  </Button>
                                                </div>
                                              )}
                                            </td>
                                            <td className='px-3 py-2'>
                                              {editingRolesMemberId === member.id ? (
                                                <div className='space-y-2'>
                                                  <div className='grid gap-1.5 sm:grid-cols-2'>
                                                    {tenantRoleGroups
                                                      .filter((g) => g.moduleKey === null || enabledModuleKeys.has(g.moduleKey))
                                                      .map((group) => (
                                                        <div key={group.label} className='rounded border bg-muted/20 px-2 py-1.5'>
                                                          <p className='mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide'>{group.label}</p>
                                                          {group.roles.map((role) => (
                                                            <label key={role} className='flex items-center gap-1.5 text-[11px] py-0.5 cursor-pointer'>
                                                              <input
                                                                type='checkbox'
                                                                className='h-3 w-3 accent-primary'
                                                                checked={editMemberRoles.includes(role)}
                                                                onChange={(e) =>
                                                                  setEditMemberRoles((prev) =>
                                                                    e.target.checked
                                                                      ? [...prev, role]
                                                                      : prev.filter((r) => r !== role),
                                                                  )
                                                                }
                                                              />
                                                              {roleDisplayName(role)}
                                                            </label>
                                                          ))}
                                                        </div>
                                                      ))}
                                                  </div>
                                                  <div className='flex items-center gap-1.5'>
                                                    <Button size='sm' className='h-6 text-xs px-2' onClick={saveRoles} disabled={editMemberRoles.length === 0}>Save</Button>
                                                    <Button size='sm' variant='ghost' className='h-6 text-xs px-2' onClick={cancelEditRoles}>Cancel</Button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <div className='flex flex-wrap items-center gap-1'>
                                                  {member.roles.map((r) => (
                                                    <span key={r} className='inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600'>
                                                      {roleDisplayName(r)}
                                                    </span>
                                                  ))}
                                                  <Button
                                                    variant='ghost'
                                                    size='sm'
                                                    className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                                                    onClick={() => startEditRoles(member)}
                                                    title='Edit roles'
                                                  >
                                                    <Pencil className='h-3 w-3' />
                                                  </Button>
                                                </div>
                                              )}
                                            </td>
                                            <td className='px-3 py-2'>
                                              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${member.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {member.status}
                                              </span>
                                            </td>
                                            <td className='px-3 py-2 text-right'>
                                              <div className='flex items-center justify-end gap-2'>
                                                <Button
                                                  variant='outline'
                                                  size='sm'
                                                  onClick={() => toggleMemberStatus(member)}
                                                >
                                                  {member.status === 'active' ? 'Disable' : 'Enable'}
                                                </Button>
                                                <Button
                                                  variant='outline'
                                                  size='sm'
                                                  className='text-destructive hover:text-destructive'
                                                  onClick={() => removeMember(member)}
                                                >
                                                  Remove
                                                </Button>
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                            </div>
                          </TabsContent>

                          <TabsContent value='invite'>
                            <div className='rounded-lg border bg-white p-4'>
                                <p className='text-sm font-semibold'>Invite user</p>
                                <p className='mt-1 text-xs text-muted-foreground'>
                                  Invite a new or existing user to this tenant. Assign <span className='font-medium'>tenant_admin</span> to give user-management access, and add module roles to scope what they can access and delegate.
                                </p>

                                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                                  <div className='space-y-2 sm:col-span-2'>
                                    <Label>Email</Label>
                                    <Input type='email' value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                                  </div>
                                  <div className='space-y-2 sm:col-span-2'>
                                    <Label>Full name</Label>
                                    <Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
                                  </div>
                                  {availableInviteGroups.length > 0 && (
                                    <div className='space-y-3 sm:col-span-2'>
                                      <div className='flex items-center justify-between'>
                                        <Label>Module roles</Label>
                                        {inviteRoles.length > 0 && (
                                          <button
                                            type='button'
                                            className='text-[11px] text-muted-foreground hover:text-foreground'
                                            onClick={() => setInviteRoles([])}
                                          >
                                            Clear all
                                          </button>
                                        )}
                                      </div>
                                      <p className='text-xs text-muted-foreground'>
                                        This admin will always get <span className='font-medium'>tenant_admin</span> (user management).
                                        Grant additional module roles to control what they can delegate to other users.
                                      </p>
                                      <div className='grid gap-2 sm:grid-cols-2'>
                                        {availableInviteGroups.map((group) => {
                                          const groupSelected = group.roles.filter((r) => inviteRoles.includes(r));
                                          const allChecked = groupSelected.length === group.roles.length;
                                          const someChecked = groupSelected.length > 0 && !allChecked;
                                          return (
                                            <div key={group.label} className='rounded-md border bg-muted/20 px-3 py-2.5'>
                                              <label className='flex items-center gap-2 text-xs font-semibold'>
                                                <input
                                                  type='checkbox'
                                                  className='h-3.5 w-3.5 accent-primary'
                                                  checked={allChecked}
                                                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                                                  onChange={() => {
                                                    if (allChecked) {
                                                      setInviteRoles((prev) => prev.filter((r) => !group.roles.includes(r)));
                                                    } else {
                                                      setInviteRoles((prev) => Array.from(new Set([...prev, ...group.roles])));
                                                    }
                                                  }}
                                                />
                                                {group.label}
                                              </label>
                                              <div className='mt-1.5 ml-5 flex flex-col gap-1'>
                                                {group.roles.map((role) => (
                                                  <label key={role} className='flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground'>
                                                    <input
                                                      type='checkbox'
                                                      className='h-3 w-3 accent-primary'
                                                      checked={inviteRoles.includes(role)}
                                                      onChange={(e) =>
                                                        setInviteRoles((prev) =>
                                                          e.target.checked
                                                            ? [...prev, role]
                                                            : prev.filter((r) => r !== role),
                                                        )
                                                      }
                                                    />
                                                    {roleDisplayName(role)}
                                                  </label>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  <p className='sm:col-span-2 text-xs text-muted-foreground'>
                                    New users will receive an invitation email with a set-password link. Existing users will be notified they were added to this tenant.
                                  </p>
                                  <div className='sm:col-span-2 flex items-center justify-end pt-1'>
                                    <Button onClick={inviteAdmin} disabled={!inviteEmail || !inviteName}>
                                      Send invite
                                    </Button>
                                  </div>
                                </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <Alert variant='info'>
                          <AlertTitle>No tenant selected</AlertTitle>
                          <AlertDescription>Select a tenant from the Tenants section to configure modules and admins.</AlertDescription>
                        </Alert>
                      )
                    ) : null}

                    {activeSection === 'plans' ? (
                      <div className='space-y-4'>
                        <div className='rounded-lg border bg-white p-4'>
                          <div className='flex flex-wrap items-start justify-between gap-3'>
                            <div>
                              <p className='text-sm font-semibold'>Create plan</p>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                Plans are global templates used when provisioning tenants.
                              </p>
                            </div>
                            <Badge variant='muted' className='text-[10px]'>
                              Existing: {plans.length}
                            </Badge>
                          </div>

                          <div className='mt-4 grid gap-3 sm:grid-cols-6'>
                            <div className='space-y-2 sm:col-span-2'>
                              <Label>Key</Label>
                              <Input placeholder='pro' value={newPlanKey} onChange={(event) => setNewPlanKey(event.target.value)} />
                            </div>
                            <div className='space-y-2 sm:col-span-3'>
                              <Label>Name</Label>
                              <Input placeholder='Pro' value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} />
                            </div>
                            <div className='space-y-2 sm:col-span-1'>
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
                            <div className='sm:col-span-6 flex items-center justify-end pt-1'>
                              <Button onClick={createPlan} disabled={!newPlanKey || !newPlanName}>
                                Create plan
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className='rounded-lg border bg-white'>
                          <div className='flex items-center justify-between gap-3 border-b p-4'>
                            <div>
                              <p className='text-sm font-semibold'>Plans</p>
                              <p className='text-xs text-muted-foreground'>Global templates, sorted by name.</p>
                            </div>
                          </div>
                          <div className='p-4'>
                            {plans.length === 0 ? (
                              <p className='text-sm text-muted-foreground'>No plans created yet.</p>
                            ) : (
                              <div className='grid gap-2 md:grid-cols-2'>
                                {plans
                                  .slice()
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map((plan) =>
                                    editingPlanId === plan.id ? (
                                      <div key={plan.id} className='rounded-md border border-primary bg-primary/5 p-3 space-y-3'>
                                        <div className='grid gap-2'>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Name</Label>
                                            <Input value={editPlanName} onChange={(e) => setEditPlanName(e.target.value)} />
                                          </div>
                                          <div className='grid grid-cols-2 gap-2'>
                                            <div className='space-y-1'>
                                              <Label className='text-xs'>Scope</Label>
                                              <select
                                                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                                                value={editPlanScope}
                                                onChange={(e) => setEditPlanScope(e.target.value)}
                                              >
                                                <option value='all'>all</option>
                                                <option value='company'>company</option>
                                                <option value='education'>education</option>
                                              </select>
                                            </div>
                                            <div className='space-y-1'>
                                              <Label className='text-xs'>Active</Label>
                                              <select
                                                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                                                value={editPlanActive ? 'true' : 'false'}
                                                onChange={(e) => setEditPlanActive(e.target.value === 'true')}
                                              >
                                                <option value='true'>Yes</option>
                                                <option value='false'>No</option>
                                              </select>
                                            </div>
                                          </div>
                                        </div>
                                        <div className='flex items-center justify-end gap-2'>
                                          <Button variant='outline' size='sm' onClick={cancelEditPlan}>
                                            <X className='mr-1 h-3 w-3' />
                                            Cancel
                                          </Button>
                                          <Button size='sm' onClick={savePlan}>
                                            Save
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div key={plan.id} className='rounded-md border bg-white p-3'>
                                        <div className='flex items-start justify-between gap-3'>
                                          <div>
                                            <p className='text-sm font-semibold leading-none'>
                                              {plan.name}
                                              {!plan.is_active && (
                                                <Badge variant='outline' className='ml-2 text-[10px]'>Inactive</Badge>
                                              )}
                                            </p>
                                            <p className='mt-1 text-xs text-muted-foreground'>
                                              Key: {plan.key} · Scope: {plan.tenant_type_scope}
                                            </p>
                                          </div>
                                          <div className='flex items-center gap-1'>
                                            <Button variant='ghost' size='sm' onClick={() => startEditPlan(plan)} title='Edit plan'>
                                              <Pencil className='h-3.5 w-3.5' />
                                            </Button>
                                            <Button
                                              variant='ghost'
                                              size='sm'
                                              onClick={() => {
                                                if (window.confirm(`Delete plan "${plan.name}"? Plans with active subscriptions cannot be deleted.`)) {
                                                  void deletePlan(plan.id);
                                                }
                                              }}
                                              title='Delete plan'
                                            >
                                              <Trash2 className='h-3.5 w-3.5 text-destructive' />
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    ),
                                  )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {activeSection === 'billing' ? (
                      <div className='space-y-4'>
                        <div className='rounded-lg border bg-white p-4'>
                          <div className='flex flex-wrap items-start justify-between gap-3'>
                            <div>
                              <p className='text-sm font-semibold'>Create plan price mapping</p>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                Map internal plans to Stripe prices (or other providers).
                              </p>
                            </div>
                            <Badge variant='muted' className='text-[10px]'>
                              Existing: {planPrices.length}
                            </Badge>
                          </div>

                          <div className='mt-4 grid gap-3 md:grid-cols-6'>
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
                            <div className='md:col-span-6 flex items-center justify-end pt-1'>
                              <Button onClick={createPlanPrice} disabled={!newPlanPricePlanId}>
                                Create mapping
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className='rounded-lg border bg-white'>
                          <div className='flex items-center justify-between gap-3 border-b p-4'>
                            <div>
                              <p className='text-sm font-semibold'>Mappings</p>
                              <p className='text-xs text-muted-foreground'>Compact view for quick scanning.</p>
                            </div>
                          </div>
                          <ScrollArea className='h-[520px]'>
                            <div className='space-y-2 p-4'>
                              {planPrices.length === 0 ? (
                                <p className='text-sm text-muted-foreground'>No plan price mappings yet.</p>
                              ) : (
                                planPrices.map((price) => {
                                  const planName = planLookup.get(price.plan_id)?.name || price.plan_id;
                                  if (editingPriceId === price.id) {
                                    return (
                                      <div key={price.id} className='rounded-lg border border-primary bg-primary/5 p-3 space-y-3'>
                                        <p className='text-sm font-semibold'>{planName}</p>
                                        <div className='grid gap-2 md:grid-cols-3'>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Amount</Label>
                                            <Input value={editPriceAmount} onChange={(e) => setEditPriceAmount(e.target.value)} />
                                          </div>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Interval</Label>
                                            <select
                                              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                                              value={editPriceInterval}
                                              onChange={(e) => setEditPriceInterval(e.target.value)}
                                            >
                                              <option value='month'>month</option>
                                              <option value='year'>year</option>
                                            </select>
                                          </div>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Currency</Label>
                                            <Input value={editPriceCurrency} onChange={(e) => setEditPriceCurrency(e.target.value)} />
                                          </div>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Provider</Label>
                                            <Input value={editPriceProvider} onChange={(e) => setEditPriceProvider(e.target.value)} />
                                          </div>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Provider price ID</Label>
                                            <Input value={editPriceProviderId} onChange={(e) => setEditPriceProviderId(e.target.value)} />
                                          </div>
                                          <div className='space-y-1'>
                                            <Label className='text-xs'>Nickname</Label>
                                            <Input value={editPriceNickname} onChange={(e) => setEditPriceNickname(e.target.value)} />
                                          </div>
                                        </div>
                                        <div className='flex items-center justify-end gap-2'>
                                          <Button variant='outline' size='sm' onClick={cancelEditPrice}>
                                            <X className='mr-1 h-3 w-3' />
                                            Cancel
                                          </Button>
                                          <Button size='sm' onClick={savePrice}>
                                            Save
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div
                                      key={price.id}
                                      className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm'
                                    >
                                      <div>
                                        <p className='font-semibold'>{planName}</p>
                                        <p className='text-xs text-muted-foreground'>
                                          {price.billing_interval} · {price.currency.toUpperCase()} · {price.provider}
                                          {price.nickname ? ` · ${price.nickname}` : ''}
                                        </p>
                                      </div>
                                      <div className='flex items-center gap-3'>
                                        <div className='text-right'>
                                          <p className='font-semibold'>{price.amount}</p>
                                          <p className='text-xs text-muted-foreground'>
                                            {price.provider_price_id || 'No provider price id'}
                                          </p>
                                        </div>
                                        <div className='flex items-center gap-1'>
                                          <Button variant='ghost' size='sm' onClick={() => startEditPrice(price)} title='Edit price'>
                                            <Pencil className='h-3.5 w-3.5' />
                                          </Button>
                                          <Button
                                            variant='ghost'
                                            size='sm'
                                            onClick={() => {
                                              if (window.confirm(`Delete this price mapping for ${planName}?`)) {
                                                void deletePrice(price.id);
                                              }
                                            }}
                                            title='Delete price'
                                          >
                                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
