'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, CheckCircle2, Clock, GitMerge, Plus, Rocket, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type ReleaseSummary = {
  id: string;
  name: string;
  release_type: string;
  status: string;
  environment: string | null;
  data_center_id: string | null;
  data_center_name: string | null;
  cab_approver_id: string | null;
  cab_approved_at: string | null;
  generated_at: string | null;
  work_order_count: number;
  service_count: number;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
};

const TYPE_STYLES: Record<string, { label: string; classes: string }> = {
  quarterly: { label: 'Quarterly',    classes: 'border-blue-200 bg-blue-50 text-blue-700' },
  ad_hoc:    { label: 'Ad-hoc',       classes: 'border-violet-200 bg-violet-50 text-violet-700' },
  security:  { label: 'Security',     classes: 'border-red-200 bg-red-50 text-red-700' },
  bugfix:    { label: 'Bug Fix',       classes: 'border-amber-200 bg-amber-50 text-amber-700' },
};

const STATUS_STYLES: Record<string, { label: string; icon: React.ElementType; classes: string }> = {
  draft:        { label: 'Draft',        icon: Clock,         classes: 'text-slate-500' },
  preparation:  { label: 'Preparation',  icon: GitMerge,      classes: 'text-blue-600' },
  cab_approved: { label: 'CAB Approved', icon: CheckCircle2,  classes: 'text-emerald-600' },
  deploying:    { label: 'Deploying',    icon: Rocket,        classes: 'text-amber-600' },
  deployed:     { label: 'Deployed',     icon: CheckCircle2,  classes: 'text-emerald-700' },
  closed:       { label: 'Closed',       icon: XCircle,       classes: 'text-slate-400' },
};

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PlatformReleasesPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const [items, setItems] = useState<ReleaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: ReleaseSummary[] }>('/platform-releases', accessToken);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Platform Releases</h1>
            <Link
              href="/release-management/guide"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Release Management Guide"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Guide
            </Link>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quarterly, ad-hoc, security, and bug-fix releases for all data centers
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => router.push('/platform-releases/new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Release
          </Button>
        )}
      </div>

      {loading && <LoadingState label="Loading releases…" />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error} <button onClick={load} className="underline ml-2">Retry</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No platform releases"
          description="Create the first quarterly or ad-hoc release for your platform."
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="space-y-2">
          {items.map((rel) => {
            const typeStyle = TYPE_STYLES[rel.release_type] ?? TYPE_STYLES.quarterly;
            const statusStyle = STATUS_STYLES[rel.status] ?? STATUS_STYLES.draft;
            const StatusIcon = statusStyle.icon;
            return (
              <Link
                key={rel.id}
                href={`/platform-releases/${rel.id}`}
                className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={cn('text-[10px] font-semibold uppercase tracking-wide', typeStyle.classes)}>
                      {typeStyle.label}
                    </Badge>
                    <span className="font-semibold text-slate-800">{rel.name}</span>
                    {rel.data_center_name && (
                      <Badge variant="outline" className="text-xs bg-slate-50">
                        {rel.data_center_name}
                      </Badge>
                    )}
                    {rel.environment && (
                      <Badge variant="muted" className="text-xs">
                        {rel.environment}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span>{rel.work_order_count} WOs</span>
                    {rel.generated_at && <span>{rel.service_count} services</span>}
                    {rel.cab_approved_at && <span>CAB ✓</span>}
                    <span>{relativeTime(rel.updated_at)}</span>
                  </div>
                </div>

                <div className={cn('flex items-center gap-1.5 text-sm font-medium flex-shrink-0', statusStyle.classes)}>
                  <StatusIcon className="h-4 w-4" />
                  {statusStyle.label}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
