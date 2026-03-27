'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Gauge, LayoutGrid, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { getActiveModule, getModuleNavItems, getVisibleModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { useTenant } from '@/lib/tenant-context';

// Design tokens (single source of truth)
const TOKENS = {
  H0: 38, // top-level row height (36–40)
  H1: 34, // nested row height (32–36)
  indentStep: 15, // per depth (14–16)
  iconSize: 18, // (18–20)
  radius: 11, // (10–12)
  gapItem: 4,
  gapGroup: 8,
  basePaddingX: 10,
  basePaddingLeft: 12,
  iconColW: 28,
  chevronColW: 28,
  labelGap: 8,
  chevronSize: 16,
  railWidthClass: 'w-20', // ~80px
  expandedWidthClass: 'w-64',
} as const;

const BASE_ITEMS = [
  { href: '/modules', label: 'Modules', icon: LayoutGrid },
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
];

type FlyoutModel = {
  id: string;
  label: string;
  anchorRect: DOMRect;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string; size?: string | number }>;
  }>;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function rowPaddingLeft(depth: number) {
  return TOKENS.basePaddingLeft + depth * TOKENS.indentStep;
}

function treeLineX(depth: number) {
  // Fixed column: center within indentation gutter (classic tree look).
  return rowPaddingLeft(depth) - Math.round(TOKENS.indentStep / 2);
}

function rowHeight(depth: number) {
  return depth === 0 ? TOKENS.H0 : TOKENS.H1;
}

function RowContent({
  icon: Icon,
  label,
  showChevron,
  chevron,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string; size?: string | number }>;
  label: React.ReactNode;
  showChevron: boolean;
  chevron?: React.ReactNode;
  iconClassName?: string;
}) {
  return (
    <>
      <span
        className='flex items-center justify-center'
        style={{ width: TOKENS.iconColW }}
        aria-hidden
      >
        <Icon size={TOKENS.iconSize} className={cn('text-slate-500 group-hover:text-slate-700', iconClassName)} />
      </span>
      <span className='min-w-0 flex-1 truncate text-left' style={{ marginLeft: TOKENS.labelGap }}>
        {label}
      </span>
      <span
        className='ml-auto flex items-center justify-center text-slate-400 group-hover:text-slate-600'
        style={{ width: TOKENS.chevronColW }}
        aria-hidden={!showChevron}
      >
        {showChevron ? chevron : <span className='h-4 w-4 opacity-0' />}
      </span>
    </>
  );
}

function AccordionBody({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState(0);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    if (!open) {
      setMaxHeight(0);
      return;
    }
    setMaxHeight(innerRef.current.scrollHeight);
  }, [open, children]);

  return (
    <div
      className='overflow-hidden transition-[max-height] duration-300 ease-in-out'
      style={{ maxHeight: open ? maxHeight : 0 }}
    >
      <div ref={innerRef} className='pt-1'>
        {children}
      </div>
    </div>
  );
}

function Flyout({
  model,
  activeHref,
  onPointerEnter,
  onPointerLeave,
}: {
  model: FlyoutModel;
  activeHref: string | null;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = flyoutRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const desiredLeft = model.anchorRect.right + 12;
    const desiredTop = model.anchorRect.top - 8;
    const top = clamp(desiredTop, 12, Math.max(12, window.innerHeight - rect.height - 12));
    const left = clamp(desiredLeft, 12, Math.max(12, window.innerWidth - rect.width - 12));
    setPos({ left, top });
  }, [model.anchorRect]);

  return (
    <div
      ref={flyoutRef}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className='fixed z-50 w-64 border border-slate-200/70 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.12)]'
      style={{ left: pos.left, top: pos.top, borderRadius: TOKENS.radius }}
      role='menu'
      aria-label={`${model.label} navigation`}
    >
      <div className='px-2 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-slate-500'>
        {model.label}
      </div>
      <div className='space-y-1 px-1 pb-2'>
        {model.items.map((item) => {
          const Icon = item.icon;
          const active = activeHref === item.href || activeHref?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-2 rounded-md px-2 text-sm transition-colors',
                active ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
              )}
              style={{ height: TOKENS.H1, borderRadius: TOKENS.radius }}
            >
              <Icon size={TOKENS.iconSize} className='shrink-0 text-slate-500 group-hover:text-slate-700' />
              <span className='truncate'>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  const { context, hasModule, hasPermission, isLoading } = useTenant();
  const { hasRole } = useAuth();
  const closeTimerRef = useRef<number | null>(null);

  const accessContext = useMemo(
    () => ({
      hasModule,
      hasPermission,
      hasRole,
      tenantSlug: context?.tenant?.slug,
      isLoading,
    }),
    [hasModule, hasPermission, hasRole, context?.tenant?.slug, isLoading],
  );

  const visibleModules = getVisibleModules(accessContext);
  const activeModule = getActiveModule(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<FlyoutModel | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('sidebar:collapsed') : null;
    if (stored !== null) {
      setCollapsed(stored === '1');
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches) {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!activeModule?.id) return;
    setOpenModules((prev) => ({ ...prev, [activeModule.id]: true }));
  }, [activeModule?.id]);

  useEffect(() => {
    if (!flyout) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlyout(null);
    };
    const onScroll = () => setFlyout(null);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [flyout]);

  const activeHref = pathname ?? null;

  const moduleGroups = useMemo(() => {
    return visibleModules
      .map((module) => {
        const items = getModuleNavItems(module, accessContext);
        return { module, items };
      })
      .filter((g) => g.items.length > 0);
  }, [visibleModules, accessContext]);

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => setFlyout(null), 120);
  };

  const toggleCollapsed = () => {
    setFlyout(null);
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('sidebar:collapsed', next ? '1' : '0');
      return next;
    });
  };

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-slate-200 bg-white',
        collapsed ? TOKENS.railWidthClass : TOKENS.expandedWidthClass,
      )}
      onPointerLeave={() => {
        if (!collapsed) return;
        scheduleClose();
      }}
    >
      <div
        className={cn('flex items-center border-b border-slate-200/70', collapsed ? 'justify-center' : 'justify-between')}
        style={{ padding: 10 }}
      >
        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <div className='bg-primary text-primary-foreground' style={{ borderRadius: TOKENS.radius, padding: 8 }}>
            <ShieldCheck size={18} />
          </div>
          {!collapsed && (
            <div className='leading-tight'>
              <div className='text-[11px] font-medium text-slate-500'>Internal</div>
              <div className='text-sm font-semibold text-slate-900'>SolveBox Hub</div>
            </div>
          )}
        </div>

        <button
          type='button'
          onClick={toggleCollapsed}
          className={cn(
            'inline-flex items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900',
          )}
          style={{ height: 32, width: 32, borderRadius: TOKENS.radius }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className='flex min-h-0 flex-1 flex-col' aria-label='Sidebar navigation'>
        <div className='flex-1 overflow-y-auto' style={{ padding: 10 }}>
          <div style={{ gap: TOKENS.gapItem }} className='flex flex-col'>
          {BASE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                className={cn(
                  'group relative flex items-center text-[13px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white',
                  active ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
                )}
                style={{
                  height: rowHeight(0),
                  borderRadius: TOKENS.radius,
                  paddingLeft: collapsed ? 10 : rowPaddingLeft(0),
                  paddingRight: TOKENS.basePaddingX,
                }}
              >
                <span className={cn('flex w-full items-center', collapsed && 'justify-center')}>
                  {collapsed ? (
                    <Icon size={TOKENS.iconSize} className='text-slate-600 group-hover:text-slate-800' />
                  ) : (
                    <RowContent icon={Icon} label={item.label} showChevron={false} iconClassName={active ? 'text-slate-700' : undefined} />
                  )}
                </span>
              </Link>
            );
          })}
          </div>

          <div className='my-2 border-t border-slate-200/70' />

          <div style={{ gap: TOKENS.gapItem }} className='flex flex-col'>
          {moduleGroups.length > 0 ? (
            moduleGroups.map(({ module, items }) => {
              const isActiveModule = activeModule?.id === module.id;
              const normalizedItems = items;

              const open = Boolean(openModules[module.id]);
              const ModuleIcon = module.icon;
              const groupHasActiveChild = normalizedItems.some(
                (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
              );
              const branchActive = open || groupHasActiveChild || isActiveModule;
              const showAncestorAccent = groupHasActiveChild || isActiveModule;

              if (collapsed) {
                return (
                  <div key={module.id} className='relative'>
                    <button
                      type='button'
                      className={cn(
                        'group relative flex w-full items-center justify-center text-sm transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white',
                        isActiveModule ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
                      )}
                      style={{ height: TOKENS.H0, borderRadius: TOKENS.radius }}
                      title={module.label}
                      aria-label={module.label}
                      onPointerEnter={(e) => {
                        cancelScheduledClose();
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setFlyout({
                          id: module.id,
                          label: module.label,
                          anchorRect: rect,
                          items: normalizedItems.map((i) => ({ href: i.href, label: i.label, icon: i.icon })),
                        });
                      }}
                      onPointerLeave={() => scheduleClose()}
                    >
                      <ModuleIcon size={TOKENS.iconSize} className='shrink-0 text-slate-600 group-hover:text-slate-800' />
                    </button>
                  </div>
                );
              }

              return (
                <div key={module.id}>
                  <button
                    type='button'
                    onClick={() => setOpenModules((prev) => ({ ...prev, [module.id]: !Boolean(prev[module.id]) }))}
                    className={cn(
                      'group relative flex w-full items-center text-[13px] transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white',
                      'text-slate-800 hover:bg-slate-50 hover:text-slate-900',
                      (open || showAncestorAccent) && 'text-slate-900 font-medium',
                    )}
                    style={{
                      height: rowHeight(0),
                      borderRadius: TOKENS.radius,
                      paddingLeft: rowPaddingLeft(0),
                      paddingRight: TOKENS.basePaddingX,
                    }}
                    aria-expanded={open}
                    aria-controls={`sidebar-group-${module.id}`}
                  >
                    <RowContent
                      icon={ModuleIcon}
                      label={module.label}
                      showChevron
                      chevron={
                        <ChevronDown
                          size={TOKENS.chevronSize}
                          className={cn('transition-transform', open && 'rotate-180')}
                        />
                      }
                      iconClassName={showAncestorAccent ? 'text-slate-700' : undefined}
                    />
                  </button>

                  <div id={`sidebar-group-${module.id}`}>
                    <AccordionBody open={open}>
                      <div className='relative'>
                        {/* Tree connector line for this group (depth=1 children) */}
                        <div
                          className={cn(
                            'pointer-events-none absolute w-px z-0',
                            branchActive
                              ? 'bg-slate-400/80 dark:bg-slate-500/70'
                              : 'bg-slate-300/60 dark:bg-slate-600/50',
                          )}
                          style={{
                            left: treeLineX(1),
                            top: Math.round(TOKENS.H1 / 2),
                            bottom: Math.round(TOKENS.H1 / 2),
                          }}
                        />

                        <div style={{ gap: TOKENS.gapItem }} className='flex flex-col'>
                          {normalizedItems.map((item) => {
                            const Icon = item.icon;
                            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                title={item.label}
                                aria-label={item.label}
                                className={cn('group relative flex items-center text-[13px]')}
                                style={{
                                  height: rowHeight(1),
                                }}
                              >
                                {/* Horizontal tick into each child row */}
                                <span
                                  className={cn(
                                    'pointer-events-none absolute top-1/2 h-px -translate-y-1/2 z-10',
                                    branchActive
                                      ? 'bg-slate-400/80 dark:bg-slate-500/70'
                                      : 'bg-slate-300/60 dark:bg-slate-600/50',
                                  )}
                                  style={{
                                    left: treeLineX(1),
                                    // End tick exactly at the content container edge (gutter stays visible).
                                    width: rowPaddingLeft(1) - treeLineX(1),
                                  }}
                                />

                                <div
                                  className={cn(
                                    'relative z-10 flex w-full items-center transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white',
                                    active
                                      ? 'bg-slate-100 text-slate-900 font-semibold'
                                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900',
                                  )}
                                  style={{
                                    marginLeft: rowPaddingLeft(1),
                                    paddingRight: TOKENS.basePaddingX,
                                    height: rowHeight(1),
                                    borderRadius: TOKENS.radius,
                                  }}
                                >
                                  <RowContent
                                    icon={Icon}
                                    label={item.label}
                                    showChevron={false}
                                    iconClassName={active ? 'text-slate-700' : undefined}
                                  />
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </AccordionBody>
                  </div>
                </div>
              );
            })
          ) : (
            <p className='px-3 text-xs text-slate-500'>No modules enabled.</p>
          )}
          </div>
        </div>
      </nav>

      {collapsed && flyout && (
        <Flyout
          model={flyout}
          activeHref={activeHref}
          onPointerEnter={() => cancelScheduledClose()}
          onPointerLeave={() => scheduleClose()}
        />
      )}
    </aside>
  );
}
