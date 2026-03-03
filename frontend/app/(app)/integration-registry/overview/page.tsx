'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Network, Server, Activity, FileEdit, Clock, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrOverview } from '@/lib/types';
import { irEnvTone, irStatusTone, formatDateShort } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/common/loading-state';
import { EmptyState } from '@/components/common/empty-state';

export default function IrOverviewPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [data, setData] = useState<IrOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:read')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .get<IrOverview>('/integration-registry/overview', accessToken)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load overview'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Integration Registry</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of integration connections across all clients and environments.
          </p>
        </div>
        <Link
          href="/integration-registry/connections"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Network className="h-4 w-4" />
          View Connections
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading overview…" />
      ) : !data ? null : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile label="Total" value={data.total} icon={<Network className="h-4 w-4" />} />
            <KpiTile label="UAT" value={data.uat_count} icon={<Activity className="h-4 w-4" />} color="sky" />
            <KpiTile label="PROD" value={data.prod_count} icon={<Activity className="h-4 w-4" />} color="orange" />
            <KpiTile label="Active" value={data.active_count} icon={<Activity className="h-4 w-4" />} color="emerald" />
            <KpiTile label="Draft" value={data.draft_count} icon={<FileEdit className="h-4 w-4" />} color="amber" />
            <KpiTile label="Services" value={data.service_count} icon={<Server className="h-4 w-4" />} />
          </div>

          {/* Recently changed */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Recently Changed
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.recently_changed.length === 0 ? (
                  <EmptyState title="No recent changes" description="Changes will appear here." />
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.recently_changed.map((item) => (
                      <Link
                        key={item.instance_id}
                        href={`/integration-registry/connections?highlight=${item.instance_id}`}
                        className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-medium text-sm truncate">{item.service_name}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${irEnvTone(item.env)}`}
                          >
                            {item.env}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${irStatusTone(item.status)}`}
                          >
                            {item.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {formatDateShort(item.changed_at)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick Links</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {[
                    { href: '/integration-registry/connections', label: 'All Connections', desc: 'Browse the full connection grid' },
                    { href: '/integration-registry/connections?env=UAT', label: 'UAT Connections', desc: 'Filter to UAT only' },
                    { href: '/integration-registry/connections?env=PROD', label: 'PROD Connections', desc: 'Filter to PROD only' },
                    { href: '/integration-registry/services', label: 'Services Catalog', desc: 'Manage logical services' },
                    { href: '/integration-registry/audit', label: 'Audit History', desc: 'Full change log' },
                  ].map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="flex flex-col rounded-md border border-border/60 px-3 py-2 hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-medium">{link.label}</span>
                      <span className="text-xs text-muted-foreground">{link.desc}</span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: 'sky' | 'orange' | 'emerald' | 'amber';
}) {
  const colorMap: Record<string, string> = {
    sky: 'text-sky-600',
    orange: 'text-orange-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  const numColor = color ? colorMap[color] : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${numColor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
