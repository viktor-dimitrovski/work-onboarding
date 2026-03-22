import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Crown,
  FileQuestion,
  FileStack,
  FileText,
  FolderTree,
  History,
  Keyboard,
  Layers,
  LayoutDashboard,
  ListChecks,
  Network,
  PlayCircle,
  Rocket,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';

import type { RoleName } from '@/lib/types';

export type ModuleNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  moduleKey?: string;
  permission?: string;
  requiresRole?: RoleName | string;
};

export type ModuleDefinition = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultHref: string;
  routeMatchers: string[];
  navItems: ModuleNavItem[];
  moduleKeys?: string[];
  requiresRole?: RoleName | string;
  isGlobalOnly?: boolean;
};

export type ModuleAccessContext = {
  hasModule: (moduleKey: string) => boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  tenantSlug?: string | null;
  isLoading?: boolean;
};

const DEFAULT_TENANT_SLUG = (process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || '').toLowerCase();

export const MODULES: ModuleDefinition[] = [
  {
    id: 'onboarding',
    label: 'Tracks',
    description: 'Assignments, tracks, and employee onboarding progress.',
    icon: ListChecks,
    defaultHref: '/my-onboarding',
    routeMatchers: ['/my-onboarding', '/assignments', '/tracks'],
    moduleKeys: ['assignments', 'tracks'],
    navItems: [
      {
        href: '/my-onboarding',
        label: 'My Assigned Tracks',
        icon: ListChecks,
        moduleKey: 'assignments',
        permission: 'assignments:read',
      },
      {
        href: '/assignments',
        label: 'Assignments',
        icon: ClipboardList,
        moduleKey: 'assignments',
        permission: 'assignments:read',
      },
      {
        href: '/tracks',
        label: 'Tracks',
        icon: Layers,
        moduleKey: 'tracks',
        permission: 'tracks:read',
      },
    ],
  },
  {
    id: 'assessments',
    label: 'Assessments',
    description: 'Question bank, tests, deliveries, and results.',
    icon: FileQuestion,
    defaultHref: '/assessments/questions',
    routeMatchers: ['/assessments'],
    moduleKeys: ['assessments'],
    navItems: [
      {
        href: '/assessments/my-tests',
        label: 'My Tests',
        icon: PlayCircle,
        moduleKey: 'assessments',
        permission: 'assessments:take',
      },
      {
        href: '/assessments/my-results',
        label: 'My Results',
        icon: Trophy,
        moduleKey: 'assessments',
        permission: 'assessments:take',
      },
      {
        href: '/assessments/questions',
        label: 'Question Bank',
        icon: FileText,
        moduleKey: 'assessments',
        permission: 'assessments:read',
      },
      {
        href: '/assessments/tests',
        label: 'Tests',
        icon: ClipboardList,
        moduleKey: 'assessments',
        permission: 'assessments:read',
      },
      {
        href: '/assessments/deliveries',
        label: 'Deliveries',
        icon: Send,
        moduleKey: 'assessments',
        permission: 'assessments:read',
      },
      {
        href: '/assessments/results',
        label: 'Results',
        icon: BarChart3,
        moduleKey: 'assessments',
        permission: 'assessments:read',
      },
      {
        href: '/assessments/categories',
        label: 'Categories',
        icon: FolderTree,
        moduleKey: 'assessments',
        permission: 'assessments:write',
      },
    ],
  },
  {
    id: 'release-management',
    label: 'Release Management',
    description: 'Release center, work orders, and manifests.',
    icon: Rocket,
    defaultHref: '/release-center',
    routeMatchers: ['/release-center', '/work-orders', '/release-manifests'],
    moduleKeys: ['releases'],
    navItems: [
      {
        href: '/release-center',
        label: 'Release Center',
        icon: Rocket,
        moduleKey: 'releases',
        permission: 'releases:read',
      },
      {
        href: '/work-orders',
        label: 'Work Orders',
        icon: ClipboardCheck,
        moduleKey: 'releases',
        permission: 'releases:read',
      },
      {
        href: '/release-manifests',
        label: 'Release Manifests',
        icon: FileStack,
        moduleKey: 'releases',
        permission: 'releases:read',
      },
      {
        href: '/settings/keybindings',
        label: 'Keybindings',
        icon: Keyboard,
        moduleKey: 'releases',
        permission: 'releases:read',
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Subscriptions, usage, and invoices.',
    icon: CreditCard,
    defaultHref: '/billing',
    routeMatchers: ['/billing'],
    moduleKeys: ['billing'],
    navItems: [
      {
        href: '/billing',
        label: 'Billing',
        icon: CreditCard,
        moduleKey: 'billing',
        permission: 'billing:read',
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Operational, progress, and usage summaries.',
    icon: FileText,
    defaultHref: '/reports',
    routeMatchers: ['/reports'],
    moduleKeys: ['reports'],
    navItems: [
      {
        href: '/reports',
        label: 'Reports',
        icon: FileText,
        moduleKey: 'reports',
        permission: 'reports:read',
      },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    description: 'Standards library, controls tracking, and client matching.',
    icon: ClipboardCheck,
    defaultHref: '/compliance-hub/profile',
    routeMatchers: ['/compliance-hub'],
    moduleKeys: ['compliance'],
    navItems: [
      {
        href: '/compliance-hub/profile',
        label: 'Overview',
        icon: ShieldCheck,
        moduleKey: 'compliance',
        permission: 'compliance:read',
      },
      {
        href: '/compliance-hub/practices',
        label: 'Practices',
        icon: ClipboardList,
        moduleKey: 'compliance',
        permission: 'compliance:read',
      },
      {
        href: '/compliance-hub/clients',
        label: 'Clients',
        icon: FileText,
        moduleKey: 'compliance',
        permission: 'compliance:read',
      },
      {
        href: '/compliance-hub/gaps',
        label: 'Gaps',
        icon: FileQuestion,
        moduleKey: 'compliance',
        permission: 'compliance:read',
      },
      {
        href: '/compliance-hub/admin/library',
        label: 'Library Admin',
        icon: Settings,
        moduleKey: 'compliance',
        permission: 'compliance:admin',
      },
    ],
  },
  {
    id: 'integration-registry',
    label: 'Integration Registry',
    description: 'Connection catalog — manage integration metadata across clients, environments, and datacenters.',
    icon: Network,
    defaultHref: '/integration-registry/overview',
    routeMatchers: ['/integration-registry'],
    moduleKeys: ['integration_registry'],
    navItems: [
      {
        href: '/integration-registry/overview',
        label: 'Overview',
        icon: LayoutDashboard,
        moduleKey: 'integration_registry',
        permission: 'ir:read',
      },
      {
        href: '/integration-registry/connections',
        label: 'Connections',
        icon: Network,
        moduleKey: 'integration_registry',
        permission: 'ir:read',
      },
      {
        href: '/integration-registry/services',
        label: 'Services',
        icon: Layers,
        moduleKey: 'integration_registry',
        permission: 'ir:read',
      },
      {
        href: '/integration-registry/dictionaries',
        label: 'Dictionaries',
        icon: BookOpen,
        moduleKey: 'integration_registry',
        permission: 'ir:admin',
      },
      {
        href: '/integration-registry/audit',
        label: 'Audit / History',
        icon: History,
        moduleKey: 'integration_registry',
        permission: 'ir:read',
      },
      {
        href: '/integration-registry/settings',
        label: 'Settings',
        icon: Settings,
        moduleKey: 'integration_registry',
        permission: 'ir:admin',
      },
    ],
  },
  {
    id: 'admin-settings',
    label: 'Admin & Settings',
    description: 'User access, tenant settings, and configuration.',
    icon: Settings,
    defaultHref: '/users',
    routeMatchers: ['/users', '/settings', '/notifications', '/audit'],
    navItems: [
      {
        href: '/users',
        label: 'Users',
        icon: Users,
        // No moduleKey — user management is always accessible to holders of users:read,
        // regardless of whether the 'users' module is explicitly enabled for the tenant.
        permission: 'users:read',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: Settings,
        moduleKey: 'settings',
        permission: 'settings:manage',
      },
      {
        href: '/notifications',
        label: 'Notifications',
        icon: Bell,
        moduleKey: 'settings',
        permission: 'settings:manage',
      },
      {
        href: '/audit',
        label: 'Audit log',
        icon: FileText,
        moduleKey: 'settings',
        permission: 'settings:manage',
      },
    ],
  },
  {
    id: 'global-admin',
    label: 'Global Admin',
    description: 'Tenant management and global configuration.',
    icon: Crown,
    defaultHref: '/admin',
    routeMatchers: ['/admin'],
    navItems: [
      {
        href: '/admin',
        label: 'Admin console',
        icon: Crown,
        requiresRole: 'super_admin',
      },
    ],
    requiresRole: 'super_admin',
    isGlobalOnly: true,
  },
];

export function isDefaultTenant(tenantSlug?: string | null) {
  if (!DEFAULT_TENANT_SLUG || !tenantSlug) {
    return false;
  }
  return tenantSlug.toLowerCase() === DEFAULT_TENANT_SLUG;
}

function isNavItemVisible(item: ModuleNavItem, ctx: ModuleAccessContext) {
  if (item.requiresRole && !ctx.hasRole(item.requiresRole)) {
    return false;
  }
  if (ctx.isLoading && (item.moduleKey || item.permission)) {
    return false;
  }
  if (item.moduleKey && !ctx.hasModule(item.moduleKey)) {
    return false;
  }
  if (item.permission && !ctx.hasPermission(item.permission)) {
    return false;
  }
  return true;
}

export function getModuleNavItems(module: ModuleDefinition, ctx: ModuleAccessContext) {
  const items = module.navItems.filter((item) => isNavItemVisible(item, ctx));
  if (module.id === 'global-admin' && items.length > 0) {
    const adminUrl = getAdminConsoleUrl();
    return items.map((item) => (item.href === '/admin' ? { ...item, href: adminUrl } : item));
  }
  return items;
}

export function getVisibleModules(ctx: ModuleAccessContext) {
  return MODULES.filter((module) => {
    if (module.isGlobalOnly && !isDefaultTenant(ctx.tenantSlug)) {
      return false;
    }
    if (module.requiresRole && !ctx.hasRole(module.requiresRole)) {
      return false;
    }
    if (ctx.isLoading) {
      return false;
    }
    if (module.moduleKeys?.length) {
      const hasAnyModule = module.moduleKeys.some((moduleKey) => ctx.hasModule(moduleKey));
      if (!hasAnyModule) {
        return false;
      }
    }
    return getModuleNavItems(module, ctx).length > 0;
  });
}

export function getActiveModule(pathname: string | null, modules: ModuleDefinition[] = MODULES) {
  if (!pathname) {
    return null;
  }
  return (
    modules.find((module) =>
      module.routeMatchers.some(
        (matcher) => pathname === matcher || pathname.startsWith(`${matcher}/`),
      ),
    ) ?? null
  );
}

export function getAdminConsoleUrl(): string {
  if (typeof window === 'undefined') return '/admin';
  const raw = (process.env.NEXT_PUBLIC_BASE_DOMAINS || '').trim();
  const baseDomains = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const host = window.location.hostname.toLowerCase();
  let baseDomain: string | undefined;
  for (const bd of baseDomains) {
    if (host === bd || host.endsWith(`.${bd}`)) {
      baseDomain = bd;
      break;
    }
  }
  if (!baseDomain) {
    const parts = host.split('.').filter(Boolean);
    baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : host;
  }
  const isAlreadyAdmin = host === `admin.${baseDomain}`;
  if (isAlreadyAdmin) return '/admin';
  const { protocol, port } = window.location;
  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//admin.${baseDomain}${portSuffix}/admin`;
}

export function getModuleDefaultHref(module: ModuleDefinition, ctx: ModuleAccessContext) {
  if (module.id === 'global-admin') return getAdminConsoleUrl();
  const items = getModuleNavItems(module, ctx);
  return items[0]?.href ?? module.defaultHref ?? '/modules';
}
