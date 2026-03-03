"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

type OverviewItem = {
  group: {
    id: string;
    country?: string | null;
    bank_name?: string | null;
    project?: string | null;
  };
  active_version?: {
    id: string;
    version_label: string;
    last_matched_at?: string | null;
  } | null;
  compliance_percent?: number | null;
  gap_count: number;
};

type OverviewResponse = {
  items: OverviewItem[];
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
};

export default function ComplianceClientsPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkMatching, setBulkMatching] = useState(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:read"))) {
      router.replace("/dashboard");
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<OverviewResponse>("/compliance/clients", accessToken);
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client requirements.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  const bulkMatch = async () => {
    if (!accessToken) return;
    setBulkMatching(true);
    setError(null);
    try {
      await api.post("/compliance/clients/match/bulk", {}, accessToken);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk match failed.");
    } finally {
      setBulkMatching(false);
    }
  };

  if (loading) return <LoadingState label="Loading clients..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Client requirements</h2>
          <p className="text-sm text-muted-foreground">Import, match, and track client-specific compliance.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={bulkMatch} disabled={bulkMatching}>
            {bulkMatching ? "Re-matching..." : "Bulk re-match"}
          </Button>
          <Button type="button" onClick={() => router.push("/compliance-hub/clients/new")}>
            New client set
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Client sets</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState title="No client sets yet" description="Create a new client requirement set to begin." />
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <Link
                  key={item.group.id}
                  href={`/compliance-hub/clients/${item.group.id}`}
                  className="flex items-center justify-between rounded border px-3 py-2 transition hover:border-primary/40 hover:bg-muted/20"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {item.group.bank_name || "Client"} {item.group.project ? `• ${item.group.project}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.group.country || "Global"} {item.active_version ? `• ${item.active_version.version_label}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatPercent(item.compliance_percent)}</div>
                    <div className="text-xs text-muted-foreground">{item.gap_count} gaps</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
