"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

type GroupDetail = {
  group: {
    id: string;
    country?: string | null;
    bank_name?: string | null;
    project?: string | null;
  };
  versions: Array<{
    id: string;
    version_label: string;
    is_active_version: boolean;
    created_at: string;
  }>;
};

type Requirement = {
  id: string;
  text: string;
  order_index: number;
};

type VersionDetail = {
  version: {
    id: string;
    version_label: string;
    last_matched_at?: string | null;
  };
  requirements: Requirement[];
};

type MatchResult = {
  id: string;
  client_requirement_id: string;
  control_key: string;
  confidence: number;
  rationale: string;
  accepted: boolean;
};

export default function ComplianceClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = String(params.id || "");
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<VersionDetail | null>(null);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [newVersionLabel, setNewVersionLabel] = useState("v2");
  const [newRequirements, setNewRequirements] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:read"))) {
      router.replace("/dashboard");
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const loadGroup = async () => {
    if (!accessToken || !groupId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<GroupDetail>(`/compliance/clients/${groupId}`, accessToken);
      setGroup(data);
      const active = data.versions.find((v) => v.is_active_version) ?? data.versions[0];
      setVersionId(active?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client group.");
    } finally {
      setLoading(false);
    }
  };

  const loadVersion = async (id: string) => {
    if (!accessToken) return;
    const data = await api.get<VersionDetail>(`/compliance/clients/versions/${id}`, accessToken);
    setVersionDetail(data);
    const resultsData = await api.get<MatchResult[]>(`/compliance/clients/versions/${id}/results`, accessToken);
    setResults(resultsData);
  };

  useEffect(() => {
    void loadGroup();
  }, [accessToken, groupId]);

  useEffect(() => {
    if (versionId) {
      void loadVersion(versionId);
    }
  }, [versionId, accessToken]);

  const runMatch = async () => {
    if (!accessToken || !versionId) return;
    setMatching(true);
    setError(null);
    try {
      await api.post(`/compliance/clients/versions/${versionId}/match`, {}, accessToken);
      await loadVersion(versionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match failed.");
    } finally {
      setMatching(false);
    }
  };

  const toggleAccept = async (result: MatchResult, accepted: boolean) => {
    if (!accessToken) return;
    await api.put(
      `/compliance/clients/results/${result.id}`,
      { accepted, manual_override: true, override_reason: accepted ? "accepted" : "rejected" },
      accessToken,
    );
    await loadVersion(versionId!);
  };

  const createVersion = async () => {
    if (!accessToken || !groupId) return;
    setCreating(true);
    setError(null);
    try {
      await api.post(
        `/compliance/clients/${groupId}/versions`,
        { version_label: newVersionLabel || "v2", requirements_text: newRequirements },
        accessToken,
      );
      setNewRequirements("");
      await loadGroup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create version.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingState label="Loading client set..." />;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {group?.group.bank_name || "Client"} {group?.group.project ? `• ${group.group.project}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">{group?.group.country || "Global"}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push("/compliance-hub/clients")}>
          Back to clients
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {group?.versions.map((version) => (
            <Button
              key={version.id}
              type="button"
              variant={version.id === versionId ? "default" : "outline"}
              onClick={() => setVersionId(version.id)}
            >
              {version.version_label}
            </Button>
          ))}
          <Button type="button" variant="outline" onClick={runMatch} disabled={matching || !versionId}>
            {matching ? "Matching..." : "Run match"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create new version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Version label</Label>
            <Input value={newVersionLabel} onChange={(e) => setNewVersionLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Requirements (one per line)</Label>
            <Textarea value={newRequirements} onChange={(e) => setNewRequirements(e.target.value)} rows={6} />
          </div>
          <Button type="button" disabled={creating} onClick={createVersion}>
            {creating ? "Creating..." : "Create version"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          {versionDetail?.requirements.length ? (
            <ol className="space-y-1 text-sm">
              {versionDetail.requirements.map((req) => (
                <li key={req.id}>{req.text}</li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No requirements" description="This version has no requirements." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Match results</CardTitle>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <EmptyState title="No results yet" description="Run matching to see results." />
          ) : (
            <div className="space-y-2">
              {results.map((result) => (
                <div key={result.id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{result.control_key}</div>
                      <div className="text-xs text-muted-foreground">{result.rationale}</div>
                    </div>
                    <div className="text-sm font-semibold">{(result.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={result.accepted ? "default" : "outline"}
                    onClick={() => toggleAccept(result, !result.accepted)}
                  >
                    {result.accepted ? "Accepted" : "Accept"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
