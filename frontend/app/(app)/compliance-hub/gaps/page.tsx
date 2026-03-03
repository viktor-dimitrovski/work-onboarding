"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

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

  if (loading) return <LoadingState label="Loading gaps..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Gaps & remediation</h2>
          <p className="text-sm text-muted-foreground">Prioritize controls below the compliance threshold.</p>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Framework</Label>
            <select
              className="h-10 rounded-md border border-input bg-white px-3 text-sm"
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
          <div className="space-y-2">
            <Label>Threshold</Label>
            <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0.75" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gaps</CardTitle>
        </CardHeader>
        <CardContent>
          {gaps.length === 0 ? (
            <EmptyState title="No gaps found" description="Adjust filters or ensure statuses are set." />
          ) : (
            <div className="space-y-2">
              {gaps.map((gap) => (
                <button
                  key={gap.control_key}
                  type="button"
                  onClick={() => openGap(gap)}
                  className="flex w-full items-center justify-between rounded border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-muted/30"
                >
                  <div>
                    <div className="text-sm font-medium">{gap.title}</div>
                    <div className="text-xs text-muted-foreground">{gap.control_key}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{(gap.score * 100).toFixed(0)}%</div>
                    <div className="text-xs text-muted-foreground">{gap.criticality}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
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
