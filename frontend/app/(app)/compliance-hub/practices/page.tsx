"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";
import { ClipboardList, MoreHorizontal, X } from "lucide-react";

type PracticeItem = {
  id: string;
  title: string;
  description_text: string;
  category?: string | null;
  status?: string | null;
  frequency?: string | null;
  evidence?: string | null;
  frameworks?: string[];
  tags: string[];
  created_at: string;
};

type PracticeListResponse = {
  items: PracticeItem[];
  meta: { page: number; page_size: number; total: number };
};

type MatchResult = {
  id: string;
  practice_item_id: string;
  control_key: string;
  confidence: number;
  rationale: string;
  accepted: boolean;
  manual_override: boolean;
  override_reason?: string | null;
};

export default function CompliancePracticesPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; page_size: number; total: number }>({
    page: 1,
    page_size: 20,
    total: 0,
  });
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<PracticeItem | null>(null);
  const [mode, setMode] = useState<"add" | "edit" | "review">("review");
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [bulkMatching, setBulkMatching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [setStatus, setSetStatus] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("Secure Development");
  const [editImplStatus, setEditImplStatus] = useState("Planned");
  const [editFrequency, setEditFrequency] = useState("Ad-hoc");
  const [editEvidence, setEditEvidence] = useState("");
  const [editFrameworks, setEditFrameworks] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:read"))) {
      router.replace("/dashboard");
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const loadItems = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(meta.page));
      params.set("page_size", String(meta.page_size));
      if (q.trim()) params.set("q", q.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      const data = await api.get<PracticeListResponse>(`/compliance/practices?${params.toString()}`, accessToken);
      setItems(data.items || []);
      setMeta(data.meta || meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load practices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, [accessToken, meta.page, meta.page_size, q, categoryFilter]);

  // Creation is handled via the shared drawer (createFromDrawer).

  const runMatch = async (item: PracticeItem) => {
    if (!accessToken) return;
    setMatching(true);
    setError(null);
    try {
      const data = await api.post<{ results: MatchResult[] }>(`/compliance/practices/${item.id}/match`, {}, accessToken);
      setSelected(item);
      setEditTitle(item.title);
      setEditDescription(item.description_text);
      setEditCategory(item.category || "Secure Development");
      setEditImplStatus(item.status || "Planned");
      setEditFrequency(item.frequency || "Ad-hoc");
      setEditEvidence(item.evidence || "");
      setEditFrameworks(item.frameworks || []);
      setEditTagInput("");
      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matching failed.");
    } finally {
      setMatching(false);
    }
  };

  const bulkMatch = async () => {
    if (!accessToken) return;
    setBulkMatching(true);
    setError(null);
    try {
      await api.post("/compliance/practices/match/bulk", {}, accessToken);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk match failed.");
    } finally {
      setBulkMatching(false);
    }
  };

  const openEditor = (item: PracticeItem) => {
    setMode("edit");
    setSelected(item);
    setResults([]);
    setSetStatus("");
    setEditTitle(item.title);
    setEditDescription(item.description_text);
    setEditCategory(item.category || "Secure Development");
    setEditImplStatus(item.status || "Planned");
    setEditFrequency(item.frequency || "Ad-hoc");
    setEditEvidence(item.evidence || "");
    setEditFrameworks(item.frameworks || []);
    setEditTagInput("");
  };

  const openAdd = () => {
    setMode("add");
    setSelected(null);
    setResults([]);
    setSetStatus("");
    setEditTitle("");
    setEditDescription("");
    setEditCategory("Secure Development");
    setEditImplStatus("Planned");
    setEditFrequency("Ad-hoc");
    setEditEvidence("");
    setEditFrameworks([]);
    setEditTagInput("");
  };

  const savePractice = async () => {
    if (!accessToken || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<PracticeItem>(
        `/compliance/practices/${selected.id}`,
        {
          title: editTitle.trim(),
          description_text: editDescription.trim(),
          category: editCategory,
          status: editImplStatus,
          frequency: editFrequency,
          evidence: editEvidence.trim() || null,
          frameworks: editFrameworks,
          tags: [],
        },
        accessToken,
      );
      setSelected(updated);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update practice.");
    } finally {
      setSaving(false);
    }
  };

  const createFromDrawer = async (stayOpen: boolean) => {
    if (!accessToken) return;
    if (!editTitle.trim() || !editDescription.trim()) {
      setError("Title and Description are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(
        "/compliance/practices",
        {
          title: editTitle.trim(),
          description_text: editDescription.trim(),
          category: editCategory,
          status: editImplStatus,
          frequency: editFrequency,
          evidence: editEvidence.trim() || null,
          frameworks: editFrameworks,
          tags: [],
        },
        accessToken,
      );
      // Refresh list via ajax
      await loadItems();
      if (stayOpen) {
        // reset for next entry
        setEditTitle("");
        setEditDescription("");
        setEditEvidence("");
        setEditFrameworks([]);
        setEditTagInput("");
        setMode("add");
        setSelected(null);
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create practice.");
    } finally {
      setSaving(false);
    }
  };

  const deletePractice = async () => {
    if (!accessToken || !selected) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete practice "${selected.title}"?`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/compliance/practices/${selected.id}`, accessToken);
      setSelected(null);
      setResults([]);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete practice.");
    } finally {
      setDeleting(false);
    }
  };

  const deletePracticeByItem = async (item: PracticeItem) => {
    if (!accessToken) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete practice "${item.title}"?`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/compliance/practices/${item.id}`, accessToken);
      if (selected?.id === item.id) {
        setSelected(null);
        setResults([]);
      }
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete practice.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleAccept = async (result: MatchResult, accepted: boolean) => {
    if (!accessToken) return;
    try {
      const updated = await api.put<MatchResult>(
        `/compliance/practices/results/${result.id}`,
        { accepted, manual_override: true, override_reason: accepted ? "accepted" : "rejected" },
        accessToken,
      );
      setResults((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update match.");
    }
  };

  const applyMapping = async () => {
    if (!accessToken || !selected) return;
    const acceptedIds = results.filter((r) => r.accepted).map((r) => r.id);
    if (acceptedIds.length === 0) {
      setError("Select at least one accepted match to apply.");
      return;
    }
    setApplying(true);
    try {
      await api.post(
        `/compliance/practices/${selected.id}/apply`,
        { result_ids: acceptedIds, add_evidence: true, set_status: setStatus || null },
        accessToken,
      );
      setSetStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply mapping.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <LoadingState label="Loading practices..." />;

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.page_size));
  const rangeStart = meta.total ? (meta.page - 1) * meta.page_size + 1 : 0;
  const rangeEnd = Math.min(meta.page * meta.page_size, meta.total);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Practices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Describe what you do and map it to controls.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={bulkMatching} onClick={bulkMatch}>
            {bulkMatching ? "Bulk matching..." : "Bulk match"}
          </Button>
          <Button type="button" size="sm" onClick={openAdd}>
            Add practice
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Practice items</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-9 w-48 sm:w-56"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setMeta((m) => ({ ...m, page: 1 }));
                }}
                placeholder="Search..."
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm min-w-[160px]"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setMeta((m) => ({ ...m, page: 1 }));
                }}
              >
                <option value="">All categories</option>
                <option>Secure Development</option>
                <option>Vulnerability Management</option>
                <option>Supply Chain Security</option>
                <option>Data Protection & Privacy</option>
                <option>Access Control</option>
                <option>Incident Response & Resilience</option>
                <option>Infrastructure & Asset Security</option>
              </select>
              {(q || categoryFilter) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-9"
                  onClick={() => {
                    setQ("");
                    setCategoryFilter("");
                    setMeta((m) => ({ ...m, page: 1 }));
                  }}
                >
                  Clear
                </Button>
              ) : null}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{rangeStart}-{rangeEnd} of {meta.total}</span>
                <select
                  className="h-8 rounded border border-input bg-background px-2 text-xs"
                  value={String(meta.page_size)}
                  onChange={(e) => setMeta((m) => ({ ...m, page_size: Number(e.target.value), page: 1 }))}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
                <span className="hidden sm:inline">per page</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-8">
              <EmptyState title="No practices yet" description="Add your first practice to start mapping." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4 w-[22%] min-w-[180px]">
                      Practice
                    </th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-3 w-[14%] min-w-[120px]">
                      Category
                    </th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-3 w-[16%] min-w-[130px]">
                      Status
                    </th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-3 w-[14%] min-w-[100px]">
                      Frequency
                    </th>
                    <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-3 w-[22%] min-w-[140px]">
                      Framework tags
                    </th>
                    <th className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-3 w-[10%] min-w-[56px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(
                    items.reduce<Record<string, PracticeItem[]>>((acc, item) => {
                      const key = item.category || "Uncategorized";
                      acc[key] = acc[key] || [];
                      acc[key].push(item);
                      return acc;
                    }, {}),
                  )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([cat, group]) => (
                      <React.Fragment key={cat}>
                        <tr className="border-b border-border bg-muted/30">
                          <td colSpan={6} className="py-2 px-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {cat}
                            </span>
                            <Badge variant="secondary" className="ml-2 text-[10px] font-normal">
                              {group.length}
                            </Badge>
                          </td>
                        </tr>
                        {group.map((item) => (
                          <tr
                            key={item.id}
                            className="border-b border-border/60 transition-colors hover:bg-muted/20"
                          >
                            <td className="py-2.5 px-4 align-top">
                              <div className="min-w-0">
                                <div className="font-medium text-sm text-foreground truncate max-w-[280px]" title={item.title}>
                                  {item.title}
                                </div>
                                <div className="text-xs text-muted-foreground truncate max-w-[280px] mt-0.5" title={item.description_text}>
                                  {item.description_text}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 align-top">
                              {item.category ? (
                                <Badge variant="secondary" className="text-[10px] font-normal whitespace-nowrap">
                                  {item.category}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-top">
                              {item.status ? (
                                <Badge variant="outline" className="text-[10px] font-normal whitespace-nowrap">
                                  {item.status}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-top">
                              {item.frequency ? (
                                <Badge variant="outline" className="text-[10px] font-normal whitespace-nowrap">
                                  {item.frequency}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-top">
                              {(item.frameworks?.length ?? 0) > 0 ? (
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {item.frameworks!.slice(0, 3).map((tag) => (
                                    <Badge key={tag} variant="outline" className="text-[10px] font-normal py-0 px-1.5">
                                      {tag}
                                    </Badge>
                                  ))}
                                  {item.frameworks!.length > 3 && (
                                    <Badge variant="outline" className="text-[10px] font-normal py-0 px-1.5 text-muted-foreground">
                                      +{item.frameworks!.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-top text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    aria-label="Row actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditor(item)}>Edit</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => runMatch(item)}>Run match</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => void deletePracticeByItem(item)}
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {meta.total > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3 bg-muted/20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setMeta((m) => ({ ...m, page: Math.max(1, m.page - 1) }))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {meta.page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={meta.page >= totalPages}
                onClick={() => setMeta((m) => ({ ...m, page: m.page + 1 }))}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={mode === "add" || !!selected}
        onOpenChange={(open) => {
          if (open) return;
          setSelected(null);
          setMode("review");
        }}
      >
        <SheetContent side="right" className="flex h-full w-full max-w-xl flex-col overflow-hidden">
          <SheetHeader className="shrink-0">
            <SheetTitle className="text-base">
              {mode === "add" ? "Add practice" : selected?.title ?? "Practice"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pr-2 -mr-2">
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-2">
                <Label className="text-xs">Title</Label>
                <Input
                  className="h-9"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Practice title"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <Textarea
                  className="min-h-[80px] resize-y"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  placeholder="What you do..."
                />
              </div>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                  >
                    <option>Secure Development</option>
                    <option>Vulnerability Management</option>
                    <option>Supply Chain Security</option>
                    <option>Data Protection & Privacy</option>
                    <option>Access Control</option>
                    <option>Incident Response & Resilience</option>
                    <option>Infrastructure & Asset Security</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Implementation Status</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                    value={editImplStatus}
                    onChange={(e) => setEditImplStatus(e.target.value)}
                  >
                    <option>Planned</option>
                    <option>In Progress</option>
                    <option>Partially Implemented</option>
                    <option>Fully Implemented</option>
                    <option>Continuous/Optimized</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Frequency</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                    value={editFrequency}
                    onChange={(e) => setEditFrequency(e.target.value)}
                  >
                    <option>On every Build/Push (Automated)</option>
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Monthly</option>
                    <option>Quarterly</option>
                    <option>Annually</option>
                    <option>Ad-hoc</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Evidence / Artifact</Label>
                <Input
                  className="h-9"
                  value={editEvidence}
                  onChange={(e) => setEditEvidence(e.target.value)}
                  placeholder="URL or path to document"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Framework Tags</Label>
                <div className="rounded-md border border-input bg-background px-2.5 py-1.5">
                  <Input
                    className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
                    value={editTagInput}
                    onChange={(e) => setEditTagInput(e.target.value)}
                    placeholder='e.g. PCI-DSS 6.3.3 — press Enter'
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const next = editTagInput.trim();
                      if (!next) return;
                      setEditFrameworks((prev) => (prev.includes(next) ? prev : [...prev, next]));
                      setEditTagInput("");
                    }}
                  />
                </div>
                {editFrameworks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {editFrameworks.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
                      >
                        {tag}
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-muted"
                          onClick={() => setEditFrameworks((prev) => prev.filter((t) => t !== tag))}
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {mode === "add" ? (
                  <>
                    <Button type="button" size="sm" disabled={saving} onClick={() => void createFromDrawer(false)}>
                      {saving ? "Saving..." : "Create"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void createFromDrawer(true)}
                    >
                      {saving ? "Saving..." : "Create & add another"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => { setMode("review"); setSelected(null); }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" size="sm" disabled={saving} onClick={savePractice}>
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => { setMode("review"); setSelected(null); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={deleting}
                      onClick={deletePractice}
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {results.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center">
                <p className="text-sm font-medium text-muted-foreground">No matches yet</p>
                <p className="text-xs text-muted-foreground mt-1">Use “Run match” from the list to get AI suggestions.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Match results — accept then apply</Label>
                  {results.map((result) => {
                    const pct = Math.round(result.confidence * 100);
                    const confidenceVariant =
                      pct >= 75 ? "default" : pct >= 50 ? "secondary" : "outline";
                    return (
                      <div
                        key={result.id}
                        className="rounded-lg border border-border bg-card p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{result.control_key}</div>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                              {result.rationale}
                            </p>
                          </div>
                          <Badge variant={confidenceVariant} className="shrink-0 text-[10px]">
                            {pct}%
                          </Badge>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={result.accepted ? "default" : "outline"}
                          className="h-8"
                          onClick={() => toggleAccept(result, !result.accepted)}
                        >
                          {result.accepted ? "Accepted" : "Accept"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <Label className="text-xs">Set status on apply (optional)</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                    value={setStatus}
                    onChange={(e) => setSetStatus(e.target.value)}
                  >
                    <option value="">Do not change</option>
                    <option value="partial">Partial</option>
                    <option value="mostly">Mostly</option>
                    <option value="implemented">Implemented</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={applying || results.filter((r) => r.accepted).length === 0}
                    onClick={applyMapping}
                  >
                    {applying ? "Applying..." : "Apply mapping"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
