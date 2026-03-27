'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ChevronRight, Copy, Download, GitMerge, Rocket, Users, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState } from '@/components/common/loading-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { ItemTypeBadge } from '@/components/release-notes/item-type-badge';
import { DeploymentRunsTab } from '@/components/deployment-runs/deployment-runs-tab';
import { cn } from '@/lib/utils';

type PlatformReleaseDetail = {
  id: string;
  name: string;
  release_type: string;
  status: string;
  environment: string | null;
  data_center_id: string | null;
  data_center_name: string | null;
  cab_approver_id: string | null;
  cab_approved_at: string | null;
  cab_notes: string | null;
  generated_at: string | null;
  generated_by: string | null;
  services_snapshot: any[];
  changelog_snapshot: any[];
  deploy_steps_snapshot: any[];
  deployed_at: string | null;
  work_orders: { work_order_id: string; wo_id: string; title: string; included_at: string }[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type DCDeployment = {
  id: string;
  work_order_id: string;
  data_center_id: string;
  data_center_name: string | null;
  platform_release_id: string | null;
  environment: string | null;
  status: string;
  deployed_at: string | null;
  deployed_by: string | null;
  notes: string | null;
  created_at: string;
};

type DataCenter = { id: string; name: string; slug: string; environment: string; is_primary: boolean; is_dr: boolean };

const STATUS_FLOW = ['draft', 'preparation', 'cab_approved', 'deploying', 'deployed', 'closed'];
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', preparation: 'Preparation', cab_approved: 'CAB Approved',
  deploying: 'Deploying', deployed: 'Deployed', closed: 'Closed',
};
const TYPE_LABELS: Record<string, string> = {
  quarterly: 'Quarterly', ad_hoc: 'Ad-hoc', security: 'Security', bugfix: 'Bug Fix',
};

const CHANGELOG_ORDER = ['feature', 'security', 'api_change', 'breaking_change', 'bug_fix', 'config_change'];

function exportMarkdown(release: PlatformReleaseDetail, mode: 'changelog' | 'deploy') {
  let md = '';
  if (mode === 'changelog') {
    md += `# Changelog — ${release.name}\n\n`;
    CHANGELOG_ORDER.forEach((type) => {
      const items = release.changelog_snapshot.filter((i) => i.item_type === type);
      if (!items.length) return;
      md += `## ${type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}\n\n`;
      items.forEach((item) => {
        md += `- **${item.title}**`;
        if (item.description) md += ` — ${item.description}`;
        md += ` _(${item.service_name} @ ${item.tag})_\n`;
      });
      md += '\n';
    });
  } else {
    md += `# Deployment Steps — ${release.name}\n\n`;
    release.deploy_steps_snapshot.forEach((group) => {
      md += `## ${group.service_name ?? group.repo} @ ${group.tag}\n`;
      if (group.branch) md += `> Branch: \`${group.branch}\`\n`;
      md += '\n';
      (group.steps ?? []).forEach((step: any, i: number) => {
        md += `${i + 1}. **${step.item_title}**\n\n\`\`\`\n${step.migration_step}\n\`\`\`\n\n`;
      });
    });
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${release.name}-${mode}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PlatformReleaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();

  const [release, setRelease] = useState<PlatformReleaseDetail | null>(null);
  const [deployments, setDeployments] = useState<DCDeployment[]>([]);
  const [dataCenters, setDataCenters] = useState<DataCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approvingCAB, setApprovingCAB] = useState(false);
  const [recording, setRecording] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showDeployDCDialog, setShowDeployDCDialog] = useState(false);
  const [targetDCId, setTargetDCId] = useState('');
  const [deployingToDC, setDeployingToDC] = useState(false);

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError(null);
    try {
      const [data, deps, dcs] = await Promise.all([
        api.get<PlatformReleaseDetail>(`/platform-releases/${id}`, accessToken),
        api.get<DCDeployment[]>(`/platform-releases/${id}/deployments`, accessToken).catch(() => []),
        api.get<{ items: DataCenter[] }>('/data-centers', accessToken).catch(() => ({ items: [] })),
      ]);
      setRelease(data);
      setDeployments(Array.isArray(deps) ? deps : []);
      setDataCenters(dcs.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!accessToken) return;
    setGenerating(true);
    try {
      const updated = await api.post<PlatformReleaseDetail>(`/platform-releases/${id}/generate`, {}, accessToken);
      setRelease(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleApproveCAB = async () => {
    if (!accessToken) return;
    setApprovingCAB(true);
    try {
      const updated = await api.post<PlatformReleaseDetail>(`/platform-releases/${id}/approve-cab`, { notes: null }, accessToken);
      setRelease(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setApprovingCAB(false);
    }
  };

  const handleRecordDeployment = async () => {
    if (!accessToken || !release?.data_center_id) {
      alert('Set a data center before recording deployment.');
      return;
    }
    setRecording(true);
    try {
      const updated = await api.post<PlatformReleaseDetail>(`/platform-releases/${id}/record-deployment`, {
        data_center_id: release.data_center_id,
        environment: release.environment,
      }, accessToken);
      setRelease(updated);
      // Refresh deployments list
      const deps = await api.get<DCDeployment[]>(`/platform-releases/${id}/deployments`, accessToken).catch(() => []);
      setDeployments(Array.isArray(deps) ? deps : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setRecording(false);
    }
  };

  const handleClose = async () => {
    if (!accessToken) return;
    setClosing(true);
    try {
      const updated = await api.post<PlatformReleaseDetail>(`/platform-releases/${id}/close`, {}, accessToken);
      setRelease(updated);
    } finally {
      setClosing(false);
    }
  };

  const handleDeployToAnotherDC = async () => {
    if (!accessToken || !targetDCId) return;
    setDeployingToDC(true);
    try {
      const result = await api.post<{ id: string }>(`/platform-releases/${id}/deploy-to-dc`, {
        target_data_center_id: targetDCId,
      }, accessToken);
      setShowDeployDCDialog(false);
      router.push(`/platform-releases/${result.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create DC deployment');
    } finally {
      setDeployingToDC(false);
    }
  };

  if (loading) return <LoadingState label="Loading release…" />;
  if (error || !release) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <p className="text-red-600">{error ?? 'Not found'}</p>
        <Button variant="outline" onClick={load} className="mt-2">Retry</Button>
      </div>
    );
  }

  const statusIdx = STATUS_FLOW.indexOf(release.status);

  const changelogByType = CHANGELOG_ORDER.reduce<Record<string, any[]>>((acc, type) => {
    acc[type] = release.changelog_snapshot.filter((i) => i.item_type === type);
    return acc;
  }, {});

  const serviceItems = release.services_snapshot.filter((s) => s.component_type === 'service');
  const configItems = release.services_snapshot.filter((s) => s.component_type === 'config');
  const serviceSteps = release.deploy_steps_snapshot.filter((s) => s.component_type === 'service');
  const configSteps = release.deploy_steps_snapshot.filter((s) => s.component_type === 'config');

  // Group deployments by DC
  const deploymentsByDC = deployments.reduce<Record<string, DCDeployment[]>>((acc, dep) => {
    const key = dep.data_center_name ?? dep.data_center_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(dep);
    return acc;
  }, {});

  // DCs available for "Deploy to Another DC" (exclude the current one)
  const otherDCs = dataCenters.filter((dc) => dc.id !== release.data_center_id);

  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/platform-releases" className="hover:text-slate-700 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Platform Releases
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-slate-800">{release.name}</span>
      </div>

      {/* Header card */}
      <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">
                {TYPE_LABELS[release.release_type] ?? release.release_type}
              </Badge>
              <h1 className="text-xl font-bold text-slate-900">{release.name}</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              {release.data_center_name && <span>📍 {release.data_center_name}</span>}
              {release.environment && <span className="capitalize">🌐 {release.environment}</span>}
              {release.cab_approved_at && <span>✓ CAB Approved</span>}
              {release.generated_at && (
                <span>{release.services_snapshot.length} services · {release.changelog_snapshot.length} changes</span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Export buttons (when plan is generated) */}
            {release.generated_at && release.changelog_snapshot.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportMarkdown(release, 'changelog')}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Changelog
              </Button>
            )}
            {release.generated_at && release.deploy_steps_snapshot.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportMarkdown(release, 'deploy')}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Deploy Steps
              </Button>
            )}

            {canWrite && release.status === 'draft' && (
              <Button onClick={handleGenerate} disabled={generating || release.work_orders.length === 0}>
                <Zap className="mr-1.5 h-4 w-4" />
                {generating ? 'Generating…' : 'Generate Release Plan'}
              </Button>
            )}
            {canWrite && release.status === 'preparation' && (
              <>
                <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </Button>
                <Button onClick={handleApproveCAB} disabled={approvingCAB}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {approvingCAB ? 'Approving…' : 'Approve CAB'}
                </Button>
              </>
            )}
            {canWrite && release.status === 'cab_approved' && (
              <>
                <Button onClick={handleRecordDeployment} disabled={recording}>
                  <Rocket className="mr-1.5 h-4 w-4" />
                  {recording ? 'Recording…' : 'Record Deployment'}
                </Button>
                {otherDCs.length > 0 && (
                  <Button variant="outline" onClick={() => setShowDeployDCDialog(true)}>
                    <Copy className="mr-1.5 h-4 w-4" />
                    Deploy to Another DC
                  </Button>
                )}
              </>
            )}
            {canWrite && release.status === 'deployed' && (
              <>
                {otherDCs.length > 0 && (
                  <Button variant="outline" onClick={() => setShowDeployDCDialog(true)}>
                    <Copy className="mr-1.5 h-4 w-4" />
                    Deploy to Another DC
                  </Button>
                )}
                <Button variant="outline" onClick={handleClose} disabled={closing}>
                  {closing ? 'Closing…' : 'Close Release'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Status progress bar */}
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FLOW.filter((s) => s !== 'closed').map((s, idx) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className={cn(
                  'h-1.5 rounded-full transition-colors',
                  idx <= statusIdx ? 'bg-emerald-500' : 'bg-slate-200',
                )}
                style={{ width: 40 }}
              />
              <span className={cn('text-[10px]', idx === statusIdx ? 'font-medium text-slate-700' : 'text-slate-400')}>
                {STATUS_LABELS[s]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work-orders">Work Orders ({release.work_orders.length})</TabsTrigger>
          <TabsTrigger value="services">
            Services ({release.services_snapshot.length})
          </TabsTrigger>
          <TabsTrigger value="changelog">
            Changelog ({release.changelog_snapshot.length})
          </TabsTrigger>
          <TabsTrigger value="deployment-steps">Deploy Steps</TabsTrigger>
          <TabsTrigger value="history">
            History {deployments.length > 0 ? `(${deployments.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="deployment-runs">Deployment Runs</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 pt-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Work Orders', value: release.work_orders.length },
              { label: 'Services', value: release.services_snapshot.length },
              { label: 'Changes', value: release.changelog_snapshot.length },
              { label: 'Deploy Steps', value: release.deploy_steps_snapshot.reduce((acc, g) => acc + (g.steps?.length ?? 0), 0) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          {release.cab_approved_at && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">
                ✓ CAB Approved {new Date(release.cab_approved_at).toLocaleString()}
              </p>
              {release.cab_notes && <p className="text-xs text-emerald-700 mt-1">{release.cab_notes}</p>}
            </div>
          )}

          {!release.generated_at && release.work_orders.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">
                Release plan not yet generated. Click &ldquo;Generate Release Plan&rdquo; to aggregate services, changelog, and deployment steps.
              </p>
            </div>
          )}

          {deployments.length > 0 && (
            <div className="rounded-lg border bg-white p-4 shadow-sm space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">DC Deployment Status</h3>
              {Object.entries(deploymentsByDC).map(([dcName, deps]) => {
                const latest = deps[0];
                return (
                  <div key={dcName} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{dcName}</span>
                    <span className={cn(
                      'text-xs rounded-full px-2 py-0.5 border font-medium',
                      latest.status === 'deployed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200',
                    )}>
                      {latest.status} {latest.deployed_at ? `· ${new Date(latest.deployed_at).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Work Orders */}
        <TabsContent value="work-orders" className="pt-3">
          {release.work_orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No work orders included.</p>
          ) : (
            <div className="space-y-2">
              {release.work_orders.map((wo) => (
                <Link
                  key={wo.work_order_id}
                  href={`/work-orders/${wo.wo_id}`}
                  className="flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5 shadow-sm hover:border-slate-300 hover:bg-slate-50/50 transition-colors"
                >
                  <span className="text-xs font-mono text-muted-foreground">{wo.wo_id}</span>
                  <span className="text-sm font-medium">{wo.title}</span>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Services */}
        <TabsContent value="services" className="pt-3 space-y-4">
          {release.services_snapshot.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Generate the release plan to see services.</p>
          ) : (
            <>
              {serviceItems.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Application Services ({serviceItems.length})</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Service</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Tag</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Change</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Source WOs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {serviceItems.map((svc, idx) => (
                          <tr key={idx} className="bg-white hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{svc.service_name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{svc.repo}</div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">{svc.tag}</td>
                            <td className="px-4 py-2.5 text-xs capitalize">{svc.change_type}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{svc.wo_ids?.length ?? 0} WO(s)</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {configItems.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Bank Configurations ({configItems.length})</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Config / Bank</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Branch</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Tag</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Source WOs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {configItems.map((svc, idx) => (
                          <tr key={idx} className="bg-white hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium font-mono text-xs">{svc.repo}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className="text-xs font-mono">{svc.branch}</Badge>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">{svc.tag}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{svc.wo_ids?.length ?? 0} WO(s)</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Changelog */}
        <TabsContent value="changelog" className="pt-3 space-y-4">
          {release.changelog_snapshot.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Generate the release plan to see changelog.</p>
          ) : (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => exportMarkdown(release, 'changelog')}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export .md
                </Button>
              </div>
              {CHANGELOG_ORDER.map((type) => {
                const typeItems = changelogByType[type] ?? [];
                if (typeItems.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-2">
                      <ItemTypeBadge type={type} />
                      <span className="text-xs text-muted-foreground">{typeItems.length} item(s)</span>
                    </div>
                    <div className="space-y-1.5">
                      {typeItems.map((item, idx) => (
                        <div key={idx} className="rounded-md border bg-white px-4 py-2.5 shadow-sm">
                          <div className="text-sm font-medium text-slate-800">{item.title}</div>
                          {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span className="font-mono">{item.service_name}</span>
                            <span>·</span>
                            <span className="font-mono">{item.tag}</span>
                            {item.wo_number && <><span>·</span><span>WO {item.wo_number}</span></>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </TabsContent>

        {/* Deployment Steps */}
        <TabsContent value="deployment-steps" className="pt-3 space-y-5">
          {release.deploy_steps_snapshot.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {release.generated_at ? 'No deployment steps found.' : 'Generate the release plan to see deployment steps.'}
            </p>
          ) : (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => exportMarkdown(release, 'deploy')}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export .md
                </Button>
              </div>

              {serviceSteps.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Application Services</h3>
                  {serviceSteps.map((group, gi) => (
                    <div key={gi} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b">
                        <span className="font-medium text-sm">{group.service_name}</span>
                        <Badge variant="outline" className="font-mono text-xs">{group.tag}</Badge>
                      </div>
                      <div className="divide-y">
                        {(group.steps ?? []).map((step: any, si: number) => (
                          <div key={si} className="flex gap-3 px-4 py-3">
                            <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
                              {si + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-700 mb-1">{step.item_title}</p>
                              <pre className="text-xs bg-slate-50 rounded px-2 py-1.5 overflow-x-auto font-mono whitespace-pre-wrap break-all">
                                {step.migration_step}
                              </pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {configSteps.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bank Configurations</h3>
                  {configSteps.map((group, gi) => (
                    <div key={gi} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b">
                        <span className="font-medium text-sm font-mono text-xs">{group.repo}</span>
                        <Badge variant="outline" className="font-mono text-xs">{group.branch}</Badge>
                        <Badge variant="outline" className="font-mono text-xs">{group.tag}</Badge>
                      </div>
                      <div className="divide-y">
                        {(group.steps ?? []).map((step: any, si: number) => (
                          <div key={si} className="flex gap-3 px-4 py-3">
                            <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
                              {si + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-700 mb-1">{step.item_title}</p>
                              <pre className="text-xs bg-slate-50 rounded px-2 py-1.5 overflow-x-auto font-mono whitespace-pre-wrap break-all">
                                {step.migration_step}
                              </pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Deployment History */}
        <TabsContent value="history" className="pt-3 space-y-4">
          {deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No deployments recorded yet. Use &ldquo;Record Deployment&rdquo; to log a deployment to a data center.
            </p>
          ) : (
            Object.entries(deploymentsByDC).map(([dcName, deps]) => (
              <div key={dcName} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b">
                  <GitMerge className="h-4 w-4 text-slate-500" />
                  <span className="font-medium text-sm">{dcName}</span>
                  <Badge variant="outline" className={cn(
                    'text-xs ml-auto',
                    deps[0].status === 'deployed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600',
                  )}>
                    {deps[0].status}
                  </Badge>
                </div>
                <div className="divide-y">
                  {deps.map((dep) => (
                    <div key={dep.id} className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-800 capitalize">{dep.status}</p>
                          {dep.notes && <p className="text-xs text-muted-foreground">{dep.notes}</p>}
                        </div>
                        <div className="text-xs text-muted-foreground text-right">
                          {dep.deployed_at && <p>{new Date(dep.deployed_at).toLocaleString()}</p>}
                          <p className="capitalize">{dep.environment ?? 'production'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* Deployment Runs */}
        <TabsContent value="deployment-runs" className="pt-3">
          <DeploymentRunsTab platformReleaseId={id as string} releaseStatus={release.status} />
        </TabsContent>
      </Tabs>

      {/* Deploy to Another DC dialog */}
      {showDeployDCDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border shadow-xl p-6 max-w-md w-full mx-4 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Deploy to Another DC</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Creates a new release (DC Extension) from <strong>{release.name}</strong> targeting a different data center.
                Snapshots, changelog, and deployment steps are copied — no regeneration needed.
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-600 mb-2">Select Target Data Center</p>
              <div className="space-y-2">
                {otherDCs.map((dc) => (
                  <button
                    key={dc.id}
                    onClick={() => setTargetDCId(dc.id)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm text-left transition-colors',
                      targetDCId === dc.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{dc.name}</span>
                      {dc.is_primary && <Badge variant="outline" className="text-[10px] py-0 border-emerald-200 text-emerald-700">Primary</Badge>}
                      {dc.is_dr && <Badge variant="outline" className="text-[10px] py-0 border-amber-200 text-amber-700">DR</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground capitalize">{dc.environment}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => { setShowDeployDCDialog(false); setTargetDCId(''); }}>
                Cancel
              </Button>
              <Button
                onClick={handleDeployToAnotherDC}
                disabled={!targetDCId || deployingToDC}
              >
                <Rocket className="mr-1.5 h-4 w-4" />
                {deployingToDC ? 'Creating…' : 'Create DC Release'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
