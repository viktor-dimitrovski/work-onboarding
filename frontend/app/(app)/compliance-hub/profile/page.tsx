"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Requirement = {
  control_key: string;
  control_code: string;
  control_title: string;
  ref: string;
  note: string | null;
  implementation_score: number | null;
  practice_score: number | null;
};

type FrameworkPreview = {
  framework_key: string;
  name: string;
  implementation_percent: number | null;
  practice_coverage_percent: number | null;
  practice_implementation_percent: number | null;
  controls_total: number;
  requirements_total: number;
  requirements: Requirement[];
};

type ProfileControlLite = { control_key: string; code: string; title: string };

type ProfilePreview = {
  active_profile_key: string | null;
  frameworks: FrameworkPreview[];
  profile_controls: ProfileControlLite[];
};

type SemanticControlResult = {
  control_key: string;
  control_code: string;
  control_title: string;
  framework_key: string;
  confidence: number;
  covered_by: string[];
  gap_description: string | null;
};

type SemanticFrameworkResult = {
  framework_key: string;
  framework_name: string;
  coverage_percent: number;
  controls_covered: number;
  controls_total: number;
  controls: SemanticControlResult[];
};

type SemanticMatchResult = {
  overall_coverage_percent: number;
  frameworks: SemanticFrameworkResult[];
  analysis_summary: string;
  recommendations: string[];
  ran_at: string;
};

type SemanticMatchApplySummary = {
  results_created: number;
  results_updated: number;
  evidence_created: number;
  statuses_updated: number;
  practices_updated: number;
  unmatched_practices: string[];
};

type SemanticMatchApplyResponse = SemanticMatchApplySummary & {
  match: SemanticMatchResult;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}%`;
}

function confidenceBar(confidence: number) {
  const pctVal = Math.round(confidence * 100);
  const color =
    pctVal >= 75 ? "bg-emerald-500" : pctVal >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pctVal}%</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { context, isLoading: tenantLoading, hasModule, hasPermission } = useTenant();
  const tenantSlug = context?.tenant?.slug;
  const canWriteCompliance = hasPermission("compliance:write");

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:read"))) {
      router.replace("/dashboard");
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // accordion open state
  const [openFrameworks, setOpenFrameworks] = useState<Set<string>>(new Set());
  // semantic match
  const [matchResult, setMatchResult] = useState<SemanticMatchResult | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<SemanticMatchApplySummary | null>(null);
  const [showMatchPanel, setShowMatchPanel] = useState(false);

  // Framework CRUD
  const [fwDrawer, setFwDrawer] = useState<"add" | "edit" | null>(null);
  const [editingFw, setEditingFw] = useState<FrameworkPreview | null>(null);
  const [fwForm, setFwForm] = useState({
    framework_key: "",
    name: "",
    full_name: "",
    version: "",
    type: "",
    region: "",
  });
  const [fwSaving, setFwSaving] = useState(false);

  // Requirement CRUD
  const [reqDrawer, setReqDrawer] = useState<"add" | "edit" | null>(null);
  const [reqFwKey, setReqFwKey] = useState<string>("");
  const [editingReq, setEditingReq] = useState<Requirement | null>(null);
  const [reqForm, setReqForm] = useState({
    control_key: "",
    ref: "",
    note: "",
  });
  const [reqSaving, setReqSaving] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!accessToken || !tenantSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ProfilePreview>(
        "/compliance/profile/preview",
        accessToken
      );
      setPreview(data);
      if (data.frameworks.length > 0) {
        setOpenFrameworks(new Set(data.frameworks.map((f) => f.framework_key)));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, tenantSlug]);

  const loadLatestMatch = useCallback(async () => {
    if (!accessToken || !tenantSlug) return;
    try {
      const data = await api.get<Partial<SemanticMatchResult>>(
        "/compliance/profile/semantic-match/latest",
        accessToken
      );
      if (!data || typeof data.overall_coverage_percent !== "number" || !Array.isArray(data.frameworks)) {
        return;
      }
      setMatchResult(data as SemanticMatchResult);
      setApplySummary(null);
      setShowMatchPanel(true);
    } catch {
      // Ignore if no prior run exists.
    }
  }, [accessToken, tenantSlug]);

  useEffect(() => {
    if (tenantLoading) return;
    if (!tenantSlug) {
      setLoading(false);
      return;
    }
    loadPreview();
    loadLatestMatch();
  }, [tenantLoading, tenantSlug, loadPreview, loadLatestMatch]);

  // ── Semantic Match ──────────────────────────────────────────────────────────
  const runSemanticMatch = async () => {
    if (!accessToken) return;
    setMatchLoading(true);
    setMatchError(null);
    setApplySummary(null);
    setShowMatchPanel(true);
    try {
      if (canWriteCompliance) {
        const result = await api.post<SemanticMatchApplyResponse>(
          "/compliance/profile/semantic-match/apply",
          {},
          accessToken
        );
        setMatchResult(result.match);
        setApplySummary({
          results_created: result.results_created,
          results_updated: result.results_updated,
          evidence_created: result.evidence_created,
          statuses_updated: result.statuses_updated,
          practices_updated: result.practices_updated,
          unmatched_practices: result.unmatched_practices || [],
        });
      } else {
        const result = await api.post<SemanticMatchResult>(
          "/compliance/profile/semantic-match",
          {},
          accessToken
        );
        setMatchResult(result);
      }
    } catch (e: unknown) {
      setMatchError(e instanceof Error ? e.message : "Semantic match failed.");
    } finally {
      setMatchLoading(false);
    }
  };

  // ── Toggle accordion ────────────────────────────────────────────────────────
  const toggleFw = (key: string) => {
    setOpenFrameworks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Framework CRUD ──────────────────────────────────────────────────────────
  const openAddFw = () => {
    setFwForm({ framework_key: "", name: "", full_name: "", version: "", type: "", region: "" });
    setEditingFw(null);
    setFwDrawer("add");
  };

  const openEditFw = (fw: FrameworkPreview) => {
    setFwForm({
      framework_key: fw.framework_key,
      name: fw.name,
      full_name: "",
      version: "",
      type: "",
      region: "",
    });
    setEditingFw(fw);
    setFwDrawer("edit");
  };

  const saveFw = async () => {
    if (!accessToken || !fwForm.name.trim()) return;
    setFwSaving(true);
    try {
      if (fwDrawer === "add") {
        if (!fwForm.framework_key.trim()) return;
        await api.post(
          "/compliance/library/frameworks",
          {
            framework_key: fwForm.framework_key.trim(),
            name: fwForm.name.trim(),
            full_name: fwForm.full_name || null,
            version: fwForm.version || null,
            type: fwForm.type || null,
            region: fwForm.region || null,
            tags: [],
            references: [],
          },
          accessToken
        );
      } else if (fwDrawer === "edit" && editingFw) {
        await api.put(
          `/compliance/library/frameworks/${editingFw.framework_key}`,
          {
            name: fwForm.name.trim(),
            full_name: fwForm.full_name || null,
            version: fwForm.version || null,
            type: fwForm.type || null,
            region: fwForm.region || null,
          },
          accessToken
        );
      }
      setFwDrawer(null);
      await loadPreview();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setFwSaving(false);
    }
  };

  const deleteFw = async (fw: FrameworkPreview) => {
    if (!accessToken) return;
    if (!confirm(`Delete framework "${fw.name}"? This will also remove all its requirement refs.`)) return;
    try {
      await api.delete(`/compliance/library/frameworks/${fw.framework_key}`, accessToken);
      await loadPreview();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  // ── Requirement CRUD ────────────────────────────────────────────────────────
  const openAddReq = (fwKey: string) => {
    setReqFwKey(fwKey);
    setEditingReq(null);
    setReqForm({ control_key: "", ref: "", note: "" });
    setReqDrawer("add");
  };

  const openEditReq = (fwKey: string, req: Requirement) => {
    setReqFwKey(fwKey);
    setEditingReq(req);
    setReqForm({ control_key: req.control_key, ref: req.ref, note: req.note ?? "" });
    setReqDrawer("edit");
  };

  const saveReq = async () => {
    if (!accessToken || !reqForm.control_key.trim() || !reqForm.ref.trim()) return;
    setReqSaving(true);
    try {
      if (reqDrawer === "add") {
        await api.post(
          `/compliance/library/frameworks/${reqFwKey}/requirements`,
          { control_key: reqForm.control_key.trim(), ref: reqForm.ref.trim(), note: reqForm.note || null },
          accessToken
        );
      } else if (reqDrawer === "edit" && editingReq) {
        await api.put(
          `/compliance/library/frameworks/${reqFwKey}/requirements`,
          {
            control_key: reqForm.control_key,
            old_ref: editingReq.ref,
            new_ref: reqForm.ref.trim(),
            note: reqForm.note || null,
          },
          accessToken
        );
      }
      setReqDrawer(null);
      await loadPreview();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setReqSaving(false);
    }
  };

  const deleteReq = async (fwKey: string, req: Requirement) => {
    if (!accessToken) return;
    if (!confirm(`Remove requirement "${req.ref}" from this framework?`)) return;
    try {
      await api.delete(
        `/compliance/library/frameworks/${fwKey}/requirements?control_key=${encodeURIComponent(req.control_key)}&ref=${encodeURIComponent(req.ref)}`,
        accessToken
      );
      await loadPreview();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  // ── Semantic match ctrl lookup ──────────────────────────────────────────────
  const matchCtrlMap = useCallback((): Map<string, SemanticControlResult> => {
    const m = new Map<string, SemanticControlResult>();
    if (!matchResult) return m;
    for (const fw of matchResult.frameworks) {
      for (const c of fw.controls) {
        m.set(c.control_key, c);
      }
    }
    return m;
  }, [matchResult]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (tenantLoading || (tenantSlug && loading)) {
    return (
      <div className="min-h-[300px] flex items-center justify-center">
        <LoadingState label={tenantLoading ? "Loading tenant…" : "Loading profile…"} />
      </div>
    );
  }

  if (!tenantSlug) {
    return (
      <div className="max-w-md mx-auto">
        <EmptyState
          title="No tenant"
          description="You need to be in a tenant context to view the compliance profile."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center">
        <EmptyState
          title="Could not load profile"
          description={error}
        />
        <Button className="mt-4" variant="outline" onClick={loadPreview}>
          Retry
        </Button>
      </div>
    );
  }

  if (!preview?.active_profile_key) {
    return (
      <div className="max-w-md mx-auto">
        <EmptyState
          title="No active profile"
          description="Enable a profile first via the Library Admin page."
        />
      </div>
    );
  }

  const ctrlMap = matchCtrlMap();

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Compliance Overview
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Active profile: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{preview.active_profile_key}</code>
            {" · "}{preview.frameworks.length} frameworks{" · "}
            {preview.profile_controls.length} controls
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={openAddFw}>
            <Plus className="h-4 w-4 mr-1" /> Add Framework
          </Button>
          <Button size="sm" onClick={runSemanticMatch} disabled={matchLoading}>
            {matchLoading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            {canWriteCompliance
              ? matchResult
                ? "Re-run & Apply AI Analysis"
                : "Run & Apply AI Analysis"
              : matchResult
              ? "Re-run AI Analysis"
              : "Run AI Analysis"}
          </Button>
        </div>
      </div>

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      {matchResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Overall AI Coverage"
            value={`${Math.round(matchResult.overall_coverage_percent)}%`}
            color={
              matchResult.overall_coverage_percent >= 75
                ? "text-emerald-600"
                : matchResult.overall_coverage_percent >= 50
                ? "text-yellow-600"
                : "text-red-500"
            }
          />
          <KpiTile label="Frameworks" value={String(matchResult.frameworks.length)} />
          <KpiTile
            label="Controls Covered"
            value={`${matchResult.frameworks.reduce((s, f) => s + f.controls_covered, 0)} / ${matchResult.frameworks.reduce((s, f) => s + f.controls_total, 0)}`}
          />
          <KpiTile
            label="Open Gaps"
            value={String(
              matchResult.frameworks.reduce(
                (s, f) => s + f.controls.filter((c) => c.confidence < 0.5).length,
                0
              )
            )}
            color="text-red-500"
          />
        </div>
      )}

      <div className={`grid gap-6 ${showMatchPanel && matchResult ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* ── Left: Framework Accordions ───────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Frameworks
          </h2>
          {preview.frameworks.length === 0 && (
            <EmptyState
              title="No frameworks yet"
              description='Add a framework to this profile using "Add Framework" above.'
            />
          )}
          {preview.frameworks.map((fw) => {
            const isOpen = openFrameworks.has(fw.framework_key);
            const fwMatch = matchResult?.frameworks.find(
              (f) => f.framework_key === fw.framework_key
            );

            return (
              <Card key={fw.framework_key} className="overflow-hidden">
                {/* Framework header: button for a11y, actions in separate div to avoid double-focus */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-3 min-w-0 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => toggleFw(fw.framework_key)}
                    aria-expanded={isOpen}
                    aria-controls={`fw-content-${fw.framework_key}`}
                    id={`fw-header-${fw.framework_key}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{fw.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {fw.requirements_total} requirements
                        {fw.implementation_percent !== null &&
                          ` · impl ${Math.round(fw.implementation_percent)}%`}
                        {fw.practice_coverage_percent !== null &&
                          ` · practice cov. ${Math.round(fw.practice_coverage_percent * 100)}%`}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0 pr-2">
                    {fwMatch && (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          fwMatch.coverage_percent >= 75
                            ? "bg-emerald-100 text-emerald-700"
                            : fwMatch.coverage_percent >= 50
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-600"
                        }`}
                      >
                        AI: {Math.round(fwMatch.coverage_percent)}%
                      </span>
                    )}
                    <button
                      type="button"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Edit framework"
                      onClick={() => openEditFw(fw)}
                    >
                      <Edit2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Delete framework"
                      onClick={() => deleteFw(fw)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {/* Framework content (collapsed/expanded) */}
                {isOpen && (
                  <div id={`fw-content-${fw.framework_key}`} className="border-t" aria-labelledby={`fw-header-${fw.framework_key}`}>
                    {fw.requirements.length === 0 ? (
                      <div className="px-4 py-6">
                        <EmptyState
                          title="No requirements"
                          description='Add a requirement with "+ Add Requirement" below.'
                        />
                      </div>
                    ) : (
                      <div className="divide-y">
                        {fw.requirements.map((req) => {
                          const match = ctrlMap.get(req.control_key);
                          return (
                            <RequirementRow
                              key={`${req.control_key}__${req.ref}`}
                              req={req}
                              match={match}
                              onEdit={() => openEditReq(fw.framework_key, req)}
                              onDelete={() => deleteReq(fw.framework_key, req)}
                            />
                          );
                        })}
                      </div>
                    )}
                    <div className="px-4 py-2 bg-gray-50 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 text-gray-500"
                        onClick={() => openAddReq(fw.framework_key)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Requirement
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* ── Right: Semantic Match Panel ──────────────────────────────────── */}
        {showMatchPanel && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-primary" aria-hidden /> AI Analysis
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground -mr-1"
                onClick={() => setShowMatchPanel(false)}
              >
                <X className="h-4 w-4 mr-1" aria-hidden />
                Close
              </Button>
            </div>

            {matchLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 rounded-lg border border-dashed">
                <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
                <p className="text-sm">Analysing practices vs. profile…</p>
              </div>
            )}

            {matchError && (
              <Alert variant="destructive" className="text-sm">
                {matchError}
              </Alert>
            )}

            {matchResult && !matchLoading && (
              <div className="space-y-4">
                {applySummary && (
                  <Alert className="flex items-start gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" aria-hidden />
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        Applied AI results to coverage and evidence
                      </div>
                      <div className="text-muted-foreground">
                        Matches: {applySummary.results_created + applySummary.results_updated} · Evidence:{" "}
                        {applySummary.evidence_created} · Status updates: {applySummary.statuses_updated} · Practices:{" "}
                        {applySummary.practices_updated}
                      </div>
                      {applySummary.unmatched_practices.length > 0 && (
                        <div className="text-muted-foreground">
                          Unmatched practice titles: {applySummary.unmatched_practices.slice(0, 4).join(", ")}
                          {applySummary.unmatched_practices.length > 4 &&
                            ` +${applySummary.unmatched_practices.length - 4} more`}
                        </div>
                      )}
                    </div>
                  </Alert>
                )}
                {/* Summary */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-500">Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {matchResult.analysis_summary}
                    </p>
                  </CardContent>
                </Card>

                {/* Recommendations */}
                {matchResult.recommendations.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-gray-500">Recommendations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {matchResult.recommendations.map((r, i) => (
                          <li key={i} className="flex gap-2 text-sm text-gray-700">
                            <span className="text-purple-400 mt-0.5">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Per-framework results */}
                {matchResult.frameworks.map((fw) => (
                  <Card key={fw.framework_key}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold">{fw.framework_name}</CardTitle>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            fw.coverage_percent >= 75
                              ? "bg-emerald-100 text-emerald-700"
                              : fw.coverage_percent >= 50
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-600"
                          }`}
                        >
                          {Math.round(fw.coverage_percent)}% covered
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {fw.controls_covered}/{fw.controls_total} controls ≥50% confidence
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {fw.controls.map((c) => (
                          <div
                            key={c.control_key}
                            className={`rounded-lg px-3 py-2 text-xs ${
                              c.confidence >= 0.75
                                ? "bg-emerald-50"
                                : c.confidence >= 0.5
                                ? "bg-yellow-50"
                                : "bg-red-50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-800 truncate">
                                  {c.control_code} — {c.control_title}
                                </div>
                                {c.covered_by.length > 0 && (
                                  <div className="text-gray-500 mt-0.5 truncate">
                                    Covered by: {c.covered_by.join(", ")}
                                  </div>
                                )}
                                {c.gap_description && (
                                  <div className="text-red-600 mt-0.5">{c.gap_description}</div>
                                )}
                              </div>
                              <div className="flex-shrink-0">{confidenceBar(c.confidence)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <p className="text-xs text-muted-foreground text-center pt-2">
                  Analysis run at {new Date(matchResult.ran_at).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Framework Drawer ─────────────────────────────────────────────────── */}
      <Sheet open={fwDrawer !== null} onOpenChange={(v) => !v && setFwDrawer(null)}>
        <SheetContent className="w-[400px] sm:w-[480px]">
          <SheetHeader>
            <SheetTitle>{fwDrawer === "add" ? "Add Framework" : "Edit Framework"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {fwDrawer === "add" && (
              <div>
                <Label>Framework Key *</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. ISO27001"
                  value={fwForm.framework_key}
                  onChange={(e) => setFwForm((p) => ({ ...p, framework_key: e.target.value }))}
                />
                <p className="text-xs text-gray-400 mt-1">Unique identifier, cannot be changed later.</p>
              </div>
            )}
            <div>
              <Label>Name *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. ISO 27001:2022"
                value={fwForm.name}
                onChange={(e) => setFwForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Full Name</Label>
              <Input
                className="mt-1"
                placeholder="Information security management systems"
                value={fwForm.full_name}
                onChange={(e) => setFwForm((p) => ({ ...p, full_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Version</Label>
                <Input
                  className="mt-1"
                  placeholder="2022"
                  value={fwForm.version}
                  onChange={(e) => setFwForm((p) => ({ ...p, version: e.target.value }))}
                />
              </div>
              <div>
                <Label>Type</Label>
                <Input
                  className="mt-1"
                  placeholder="standard / regulation"
                  value={fwForm.type}
                  onChange={(e) => setFwForm((p) => ({ ...p, type: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Region</Label>
              <Input
                className="mt-1"
                placeholder="EU / Global"
                value={fwForm.region}
                onChange={(e) => setFwForm((p) => ({ ...p, region: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={saveFw} disabled={fwSaving || !fwForm.name.trim()}>
                {fwSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" onClick={() => setFwDrawer(null)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Requirement Drawer ───────────────────────────────────────────────── */}
      <Sheet open={reqDrawer !== null} onOpenChange={(v) => !v && setReqDrawer(null)}>
        <SheetContent className="w-[400px] sm:w-[480px]">
          <SheetHeader>
            <SheetTitle>
              {reqDrawer === "add" ? "Add Requirement" : "Edit Requirement"}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Control Key *</Label>
              {reqDrawer === "edit" ? (
                <Input className="mt-1" value={reqForm.control_key} disabled />
              ) : (
                <>
                  <Input
                    className="mt-1"
                    placeholder="e.g. CTL_CONTAINER_01"
                    value={reqForm.control_key}
                    onChange={(e) =>
                      setReqForm((p) => ({ ...p, control_key: e.target.value }))
                    }
                    list="profile-controls-datalist"
                  />
                  <datalist id="profile-controls-datalist">
                    {preview?.profile_controls.map((c) => (
                      <option key={c.control_key} value={c.control_key}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                  </datalist>
                  <p className="text-xs text-gray-400 mt-1">
                    Must match an existing control key in this profile.
                  </p>
                </>
              )}
            </div>
            <div>
              <Label>Reference *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. ISO 27001:2022 A.8.25"
                value={reqForm.ref}
                onChange={(e) => setReqForm((p) => ({ ...p, ref: e.target.value }))}
              />
            </div>
            <div>
              <Label>Note</Label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="Optional context or guidance…"
                value={reqForm.note}
                onChange={(e) => setReqForm((p) => ({ ...p, note: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                onClick={saveReq}
                disabled={
                  reqSaving || !reqForm.control_key.trim() || !reqForm.ref.trim()
                }
              >
                {reqSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" onClick={() => setReqDrawer(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function RequirementRow({
  req,
  match,
  onEdit,
  onDelete,
}: {
  req: Requirement;
  match?: SemanticControlResult;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 group transition-colors">
      {/* Status icon */}
      <div className="mt-0.5 flex-shrink-0">
        {match ? (
          match.confidence >= 0.75 ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : match.confidence >= 0.5 ? (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )
        ) : (
          <div className="h-4 w-4 rounded-full border-2 border-gray-200" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-gray-400">{req.control_code}</span>
          <span className="text-sm font-medium text-gray-800 truncate">{req.control_title}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            {req.ref}
          </span>
          {req.note && (
            <span className="text-xs text-gray-400 truncate">{req.note}</span>
          )}
          {match && (
            <div className="ml-auto">{confidenceBar(match.confidence)}</div>
          )}
        </div>
        {match?.gap_description && match.confidence < 0.5 && (
          <p className="text-xs text-red-500 mt-1">{match.gap_description}</p>
        )}
      </div>

      {/* Actions: visible on hover, always visible on touch (focus) for accessibility */}
      <div className="flex gap-1 opacity-70 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Edit"
          onClick={onEdit}
          aria-label="Edit requirement"
        >
          <Edit2 className="h-3 w-3" aria-hidden />
        </button>
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title="Remove"
          onClick={onDelete}
          aria-label="Remove requirement"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
