"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDateShort, riskTone, statusTone } from "@/lib/constants";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type GapItem = {
  control_key: string;
  code: string;
  title: string;
  domain_code: string;
  criticality: string;
  weight: number;
  status_enum: string | null;
  score: number;
  gap_score: number;
  priority?: string | null;
  due_date?: string | null;
  remediation_notes?: string | null;
  framework_keys?: string[];
};

type Framework = {
  framework_key: string;
  name: string;
};

type WorkItemLink = {
  id: string;
  link_type: string;
  url?: string | null;
  work_order_id?: string | null;
  status?: string | null;
};

export default function ComplianceGapsPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkKey, setFrameworkKey] = useState("");
  const [threshold, setThreshold] = useState("0.75");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GapItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [workItems, setWorkItems] = useState<WorkItemLink[]>([]);
  const [jiraUrl, setJiraUrl] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [sortBy, setSortBy] = useState<"score_asc" | "score_desc" | "criticality" | "title">("score_asc");

  const fwNameMap = useMemo(() => {
    const m = new Map<string, string>();
    frameworks.forEach((f) => m.set(f.framework_key, f.name));
    return m;
  }, [frameworks]);

  const sortedGaps = useMemo(() => {
    const copy = [...gaps];
    const critOrder = (c: string) => (c?.toLowerCase() === "high" ? 0 : c?.toLowerCase() === "medium" ? 1 : 2);
    if (sortBy === "score_asc") copy.sort((a, b) => a.score - b.score);
    else if (sortBy === "score_desc") copy.sort((a, b) => b.score - a.score);
    else if (sortBy === "criticality") copy.sort((a, b) => critOrder(a.criticality) - critOrder(b.criticality));
    else if (sortBy === "title") copy.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return copy;
  }, [gaps, sortBy]);

  const paginatedGaps = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedGaps.slice(start, start + pageSize);
  }, [sortedGaps, page, pageSize]);
  const totalPages = Math.max(1, Math.ceil(sortedGaps.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [gaps.length, frameworkKey, threshold]);

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:read"))) {
      router.replace("/dashboard");
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const loadFrameworks = async () => {
    if (!accessToken) return;
    const data = await api.get<Framework[]>("/compliance/frameworks", accessToken);
    setFrameworks(data);
  };

  const loadGaps = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("threshold", threshold);
      if (frameworkKey) params.set("framework_key", frameworkKey);
      const data = await api.get<GapItem[]>(`/compliance/gaps?${params.toString()}`, accessToken);
      setGaps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gaps.");
    } finally {
      setLoading(false);
    }
  };

  const loadWorkItems = async (controlKey: string) => {
    if (!accessToken) return;
    const params = new URLSearchParams();
    params.set("source_type", "control");
    params.set("source_key", controlKey);
    const data = await api.get<WorkItemLink[]>(`/compliance/work-items?${params.toString()}`, accessToken);
    setWorkItems(data);
  };

  useEffect(() => {
    void loadFrameworks();
  }, [accessToken]);

  useEffect(() => {
    void loadGaps();
  }, [accessToken, threshold, frameworkKey]);

  const openGap = (gap: GapItem) => {
    setSelected(gap);
    setJiraUrl("");
    void loadWorkItems(gap.control_key);
  };

  const saveRemediation = async () => {
    if (!accessToken || !selected) return;
    setSaving(true);
    try {
      const payload = {
        priority: selected.priority || null,
        due_date: selected.due_date || null,
        remediation_notes: selected.remediation_notes || null,
      };
      await api.put(`/compliance/controls/${selected.control_key}/remediation`, payload, accessToken);
      await loadGaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update remediation.");
    } finally {
      setSaving(false);
    }
  };

  const linkJira = async () => {
    if (!accessToken || !selected || !jiraUrl.trim()) return;
    setSaving(true);
    try {
      await api.post(
        "/compliance/work-items/link",
        {
          source_type: "control",
          source_key: selected.control_key,
          link_type: "jira",
          url: jiraUrl.trim(),
        },
        accessToken,
      );
      setJiraUrl("");
      await loadWorkItems(selected.control_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link Jira.");
    } finally {
      setSaving(false);
    }
  };

  const createWorkOrder = async () => {
    if (!accessToken || !selected) return;
    setSaving(true);
    try {
      await api.post(
        "/compliance/work-items/create-work-order",
        {
          source_type: "control",
          source_key: selected.control_key,
          title: `Remediate ${selected.title}`,
          description: selected.remediation_notes || "",
        },
        accessToken,
      );
      await loadWorkItems(selected.control_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create work order.");
    } finally {
      setSaving(false);
    }
  };

  const isInitialLoad = loading && gaps.length === 0;
  if (isInitialLoad) return <LoadingState label="Loading gaps..." />;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Gaps & remediation</h2>
        <p className="text-sm text-muted-foreground">Prioritize controls below the compliance threshold.</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive font-medium">{error}</p>
      ) : null}

      {/* Toolbar: filters + sort + pagination controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="gaps-framework" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Framework
            </Label>
            <select
              id="gaps-framework"
              className="h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
              value={frameworkKey}
              onChange={(e) => setFrameworkKey(e.target.value)}
            >
              <option value="">All frameworks</option>
              {frameworks.map((fw) => (
                <option key={fw.framework_key} value={fw.framework_key}>
                  {fw.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="gaps-threshold" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Threshold
            </Label>
            <Input
              id="gaps-threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="h-9 w-20"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0.75"
            />
          </div>
        </div>
        <div className="h-6 w-px bg-border hidden sm:block" aria-hidden />
        {gaps.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="gaps-sort" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                Sort by
              </Label>
              <select
                id="gaps-sort"
                className="h-9 min-w-[140px] rounded-md border border-input bg-background px-3 text-sm"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as typeof sortBy);
                  setPage(1);
                }}
              >
                <option value="score_asc">Compliance ↑</option>
                <option value="score_desc">Compliance ↓</option>
                <option value="criticality">Severity</option>
                <option value="title">Title</option>
              </select>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">
                {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
              </span>
              <Label htmlFor="gaps-per-page" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                Per page
              </Label>
              <select
                id="gaps-per-page"
                className="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 15, 25, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="relative">
          {loading && gaps.length > 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground" aria-hidden="true">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Updating...</span>
            </div>
          )}
          {gaps.length === 0 ? (
            <div className="p-8">
              <EmptyState title="No gaps found" description="Adjust filters or ensure statuses are set." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="sticky top-0 z-[1] bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <tr className="border-b">
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[100px]">Control ID</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 min-w-[200px]">Title</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[140px]">Frameworks</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[100px]">Compliance</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[80px]">Severity</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[90px]">Priority</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[95px]">Due date</th>
                    <th className="text-left font-medium text-muted-foreground py-3 px-4 w-[90px]">Status</th>
                    <th className="w-10 px-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedGaps.map((gap) => (
                    <tr
                      key={gap.control_key}
                      role="button"
                      tabIndex={0}
                      onClick={() => openGap(gap)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openGap(gap);
                        }
                      }}
                      className="border-b transition-colors hover:bg-muted/40 focus:outline-none focus:bg-muted/40 cursor-pointer"
                      aria-label={`View remediation for ${gap.title ?? gap.control_key}`}
                    >
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground align-top">
                        {gap.control_key}
                      </td>
                      <td className="py-3 px-4 align-top">
                        <span className="line-clamp-2 font-medium text-foreground">{gap.title}</span>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <div className="flex flex-wrap gap-1">
                          {(gap.framework_keys?.length ?? 0) > 0
                            ? gap.framework_keys!.slice(0, 3).map((fk) => (
                                <Badge
                                  key={fk}
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0 font-normal"
                                >
                                  {fwNameMap.get(fk) ?? fk}
                                </Badge>
                              ))
                            : "—"}
                          {(gap.framework_keys?.length ?? 0) > 3 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              +{gap.framework_keys!.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold tabular-nums">{(gap.score * 100).toFixed(0)}%</span>
                          <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                gap.score >= 0.75 ? "bg-emerald-500" : gap.score >= 0.5 ? "bg-amber-500" : "bg-rose-500"
                              )}
                              style={{ width: `${Math.min(100, gap.score * 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <Badge
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 font-medium capitalize",
                            riskTone((gap.criticality ?? "").toLowerCase())
                          )}
                        >
                          {gap.criticality}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 align-top text-muted-foreground text-xs capitalize">
                        {gap.priority ?? "—"}
                      </td>
                      <td className="py-3 px-4 align-top text-muted-foreground text-xs tabular-nums">
                        {formatDateShort(gap.due_date)}
                      </td>
                      <td className="py-3 px-4 align-top">
                        {gap.status_enum ? (
                          <Badge className={cn("text-[10px] px-1.5 py-0 font-normal", statusTone(gap.status_enum))}>
                            {gap.status_enum.replace(/_/g, " ")}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-2 align-middle">
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {gaps.length > pageSize && (
          <div className="flex items-center justify-between gap-4 border-t px-4 py-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sortedGaps.length)} of {sortedGaps.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[4rem] text-center tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex h-full w-full max-w-xl flex-col">
          <SheetHeader>
            <SheetTitle>{selected?.title ?? "Remediation"}</SheetTitle>
          </SheetHeader>
          {selected ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  value={selected.priority ?? ""}
                  onChange={(e) => setSelected({ ...selected, priority: e.target.value || null })}
                >
                  <option value="">Not set</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={selected.due_date ? selected.due_date.slice(0, 10) : ""}
                  onChange={(e) => setSelected({ ...selected, due_date: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label>Remediation notes</Label>
                <Textarea
                  value={selected.remediation_notes ?? ""}
                  onChange={(e) => setSelected({ ...selected, remediation_notes: e.target.value })}
                />
              </div>
              <Button type="button" disabled={saving} onClick={saveRemediation}>
                {saving ? "Saving..." : "Save remediation"}
              </Button>

              <div className="space-y-2 border-t pt-4">
                <Label>Link Jira ticket</Label>
                <div className="flex gap-2">
                  <Input value={jiraUrl} onChange={(e) => setJiraUrl(e.target.value)} placeholder="https://jira/..." />
                  <Button type="button" variant="outline" disabled={saving} onClick={linkJira}>
                    Link
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Work items</Label>
                {workItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No work items linked.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {workItems.map((item) => (
                      <li key={item.id}>
                        {item.link_type}: {item.url || item.work_order_id}
                      </li>
                    ))}
                  </ul>
                )}
                <Button type="button" variant="outline" disabled={saving} onClick={createWorkOrder}>
                  Create Work Order
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
