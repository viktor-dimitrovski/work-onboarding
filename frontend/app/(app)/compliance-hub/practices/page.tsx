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

type PracticeItem = {
  id: string;
  title: string;
  description_text: string;
  tags: string[];
  created_at: string;
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
  const [selected, setSelected] = useState<PracticeItem | null>(null);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [matching, setMatching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [setStatus, setSetStatus] = useState("");

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
      const data = await api.get<PracticeItem[]>("/compliance/practices", accessToken);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load practices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, [accessToken]);

  const createPractice = async () => {
    if (!accessToken || !title.trim()) return;
    setCreating(true);
    try {
      await api.post(
        "/compliance/practices",
        { title: title.trim(), description_text: description.trim(), tags: [] },
        accessToken,
      );
      setTitle("");
      setDescription("");
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create practice.");
    } finally {
      setCreating(false);
    }
  };

  const runMatch = async (item: PracticeItem) => {
    if (!accessToken) return;
    setMatching(true);
    setError(null);
    try {
      const data = await api.post<{ results: MatchResult[] }>(`/compliance/practices/${item.id}/match`, {}, accessToken);
      setSelected(item);
      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matching failed.");
    } finally {
      setMatching(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Practices</h2>
        <p className="text-sm text-muted-foreground">Describe what you do and map it to controls.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Add practice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button type="button" disabled={creating} onClick={createPractice}>
            {creating ? "Saving..." : "Create practice"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Practice items</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState title="No practices yet" description="Add your first practice to start mapping." />
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.description_text}</div>
                  </div>
                  <Button type="button" variant="outline" disabled={matching} onClick={() => runMatch(item)}>
                    {matching ? "Matching..." : "Run match"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex h-full w-full max-w-xl flex-col">
          <SheetHeader>
            <SheetTitle>{selected?.title ?? "Match results"}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {results.length === 0 ? (
              <EmptyState title="No matches yet" description="Run matching to see suggestions." />
            ) : (
              results.map((result) => (
                <div key={result.id} className="rounded border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{result.control_key}</div>
                      <div className="text-xs text-muted-foreground">{result.rationale}</div>
                    </div>
                    <div className="text-sm font-semibold">{(result.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={result.accepted ? "default" : "outline"}
                      onClick={() => toggleAccept(result, !result.accepted)}
                    >
                      {result.accepted ? "Accepted" : "Accept"}
                    </Button>
                  </div>
                </div>
              ))
            )}
            <div className="space-y-2 border-t pt-4">
              <Label>Set status on apply (optional)</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                value={setStatus}
                onChange={(e) => setSetStatus(e.target.value)}
              >
                <option value="">Do not change</option>
                <option value="partial">Partial</option>
                <option value="mostly">Mostly</option>
                <option value="implemented">Implemented</option>
              </select>
              <Button type="button" disabled={applying} onClick={applyMapping}>
                {applying ? "Applying..." : "Apply mapping"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
