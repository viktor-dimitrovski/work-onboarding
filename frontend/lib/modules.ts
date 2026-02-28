import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Crown,
  FileQuestion,
  FileStack,
  FileText,
  Layers,
  ListChecks,
  Rocket,
  Send,
  Settings,
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
    label: 'Onboarding',
    description: 'Assignments, tracks, and employee onboarding progress.',
    icon: ListChecks,
    defaultHref: '/my-onboarding',
    routeMatchers: ['/my-onboarding', '/assignments', '/tracks'],
    moduleKeys: ['assignments', 'tracks'],
    navItems: [
      {
        href: '/my-onboarding',
        label: 'My Onboarding',
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
    defaultHref: '/assessments',
    routeMatchers: ['/assessments'],
    moduleKeys: ['assessments'],
    navItems: [
      {
        href: '/assessments',
        label: 'Overview',
        icon: FileQuestion,
        moduleKey: 'assessments',
        permission: 'assessments:read',
      },
      {
        href: '/assessments/questions',
        label: 'Questions',
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
        label: 'Billing overview',
        icon: CreditCard,
        moduleKey: 'billing',
        permission: 'billing:read',
      },
    ],
  },
  {
    id: 'admin-settings',
    label: 'Admin & Settings',
    description: 'User access, tenant settings, and configuration.',
    icon: Settings,
    defaultHref: '/users',
    routeMatchers: ['/users', '/settings'],
    moduleKeys: ['users', 'settings'],
    navItems: [
      {
        href: '/users',
        label: 'Users',
        icon: Users,
        moduleKey: 'users',
        permission: 'users:read',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: Settings,
        moduleKey: 'settings',
        permission: 'settings:manage',
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
    id: 'notifications',
    label: 'Notifications',
    description: 'Alerts, templates, and delivery preferences.',
    icon: Bell,
    defaultHref: '/notifications',
    routeMatchers: ['/notifications'],
    moduleKeys: ['notifications', 'settings'],
    navItems: [
      {
        href: '/notifications',
        label: 'Notification center',
        icon: Bell,
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
  return module.navItems.filter((item) => isNavItemVisible(item, ctx));
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

export function getModuleDefaultHref(module: ModuleDefinition, ctx: ModuleAccessContext) {
  const items = getModuleNavItems(module, ctx);
  return items[0]?.href ?? module.defaultHref ?? '/modules';
}
