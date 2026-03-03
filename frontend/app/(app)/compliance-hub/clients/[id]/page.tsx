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

type CoverageFrameworkRef = {
  framework_key: string;
  framework_name: string;
  ref: string;
  note?: string | null;
};

type CoverageControl = {
  control_key: string;
  control_code: string;
  control_title: string;
  match_confidence: number;
  match_coverage_score: number;
  accepted: boolean;
  implementation_score?: number | null;
  framework_refs: CoverageFrameworkRef[];
};

type CoverageEvidence = {
  id: string;
  control_key: string;
  type: string;
  title: string;
  url?: string | null;
};

type CoverageRequirement = {
  requirement_id: string;
  requirement_text: string;
  coverage_percent?: number | null;
  match_confidence?: number | null;
  controls: CoverageControl[];
  evidence: CoverageEvidence[];
  evidence_count: number;
};

type CoverageResponse = {
  overall_percent?: number | null;
  coverage_percent?: number | null;
  requirements: CoverageRequirement[];
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
  const [applying, setApplying] = useState(false);
  const [applyStatus, setApplyStatus] = useState("");
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState("v2");
  const [newRequirements, setNewRequirements] = useState("");
  const [creating, setCreating] = useState(false);

  const pct = (value?: number | null) => {
    if (value === null || value === undefined) return "—";
    return `${Math.round(value * 100)}%`;
  };

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
    setCoverageError(null);
    setCoverageLoading(true);
    try {
      const coverageData = await api.get<CoverageResponse>(
        `/compliance/clients/versions/${id}/coverage`,
        accessToken,
      );
      setCoverage(coverageData);
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Failed to load coverage.");
      setCoverage(null);
    } finally {
      setCoverageLoading(false);
    }
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

  const refreshCoverage = async () => {
    if (!accessToken || !versionId) return;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const data = await api.post<CoverageResponse>(
        `/compliance/clients/versions/${versionId}/coverage`,
        {},
        accessToken,
      );
      setCoverage(data);
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Failed to refresh coverage.");
    } finally {
      setCoverageLoading(false);
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

  const applyAccepted = async () => {
    if (!accessToken || !versionId) return;
    const acceptedIds = results.filter((r) => r.accepted).map((r) => r.id);
    if (acceptedIds.length === 0) {
      setError("Select at least one accepted match to apply.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await api.post(
        `/compliance/clients/versions/${versionId}/apply`,
        { result_ids: acceptedIds, add_evidence: true, set_status: applyStatus || null },
        accessToken,
      );
      setApplyStatus("");
      await loadVersion(versionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply accepted matches.");
    } finally {
      setApplying(false);
    }
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

  const reqMap = new Map((versionDetail?.requirements || []).map((r) => [r.id, r.text] as const));
  const resultsByReq = results.reduce<Record<string, MatchResult[]>>((acc, r) => {
    acc[r.client_requirement_id] = acc[r.client_requirement_id] || [];
    acc[r.client_requirement_id]!.push(r);
    return acc;
  }, {});
  const acceptedCount = results.filter((r) => r.accepted).length;

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
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Coverage & evidence</CardTitle>
            <p className="text-sm text-muted-foreground">
              Based on accepted matches, framework requirements, and linked evidence.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={refreshCoverage} disabled={coverageLoading || !versionId}>
            {coverageLoading ? "Re-evaluating..." : "Re-evaluate coverage"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverageError ? <p className="text-sm text-red-600">{coverageError}</p> : null}
          {coverageLoading && !coverage ? (
            <div className="text-sm text-muted-foreground">Loading coverage…</div>
          ) : coverage ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Overall coverage</div>
                  <div className="text-lg font-semibold">{pct(coverage.overall_percent)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Requirements covered</div>
                  <div className="text-lg font-semibold">{pct(coverage.coverage_percent)}</div>
                </div>
              </div>
              <div className="space-y-3">
                {coverage.requirements.map((req) => (
                  <details key={req.requirement_id} className="rounded-lg border p-3">
                    <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer">
                      <span className="text-sm font-medium">{req.requirement_text}</span>
                      <span className="text-sm font-semibold">{pct(req.coverage_percent)}</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="text-xs text-muted-foreground">
                        Evidence linked: {req.evidence_count}
                        {req.match_confidence !== null && req.match_confidence !== undefined
                          ? ` · Match confidence ${Math.round(req.match_confidence * 100)}%`
                          : ""}
                      </div>

                      {req.controls.length > 0 ? (
                        <div className="space-y-2">
                          {req.controls.map((control) => (
                            <div key={control.control_key} className="rounded border px-3 py-2">
                              <div className="text-sm font-semibold">
                                {control.control_code} · {control.control_title}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Match {Math.round(control.match_confidence * 100)}% · Impl{" "}
                                {pct(control.implementation_score)}
                              </div>
                              {control.framework_refs.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {control.framework_refs.map((ref) => (
                                    <span
                                      key={`${control.control_key}-${ref.framework_key}-${ref.ref}`}
                                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]"
                                    >
                                      {ref.framework_name} {ref.ref}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No accepted framework links yet.</div>
                      )}

                      {req.evidence.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">Evidence</div>
                          {req.evidence.slice(0, 5).map((ev) => (
                            <div key={ev.id} className="text-xs">
                              {ev.url ? (
                                <a className="text-primary hover:underline" href={ev.url} target="_blank" rel="noreferrer">
                                  {ev.title}
                                </a>
                              ) : (
                                <span>{ev.title}</span>
                              )}
                            </div>
                          ))}
                          {req.evidence.length > 5 && (
                            <div className="text-xs text-muted-foreground">
                              +{req.evidence.length - 5} more evidence items
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No coverage data yet"
              description="Run matching and accept results to compute coverage."
            />
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
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    Accepted: <span className="font-semibold text-foreground">{acceptedCount}</span> / {results.length}
                  </div>
                  <Button type="button" variant="outline" disabled={applying || acceptedCount === 0} onClick={applyAccepted}>
                    {applying ? "Applying..." : "Apply accepted matches"}
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Set status on apply (optional)</Label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={applyStatus}
                      onChange={(e) => setApplyStatus(e.target.value)}
                      disabled={applying}
                    >
                      <option value="">Do not change</option>
                      <option value="partial">Partial</option>
                      <option value="mostly">Mostly</option>
                      <option value="implemented">Implemented</option>
                    </select>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-end">
                    Applying creates Evidence entries on matched controls (and optionally updates status).
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {Object.entries(resultsByReq)
                  .sort(([a], [b]) => (reqMap.get(a) || "").localeCompare(reqMap.get(b) || ""))
                  .map(([reqId, matches]) => (
                    <div key={reqId} className="rounded-lg border p-3 space-y-2">
                      <div className="text-sm font-medium">Requirement</div>
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {reqMap.get(reqId) || reqId}
                      </div>
                      <div className="pt-1 space-y-2">
                        {matches
                          .slice()
                          .sort((x, y) => y.confidence - x.confidence)
                          .map((result) => (
                            <div key={result.id} className="rounded border bg-background px-3 py-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold">{result.control_key}</div>
                                  <div className="text-xs text-muted-foreground line-clamp-2">{result.rationale}</div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-sm font-semibold tabular-nums">
                                    {(result.confidence * 100).toFixed(0)}%
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={result.accepted ? "default" : "outline"}
                                    className="mt-2"
                                    onClick={() => toggleAccept(result, !result.accepted)}
                                  >
                                    {result.accepted ? "Accepted" : "Accept"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
