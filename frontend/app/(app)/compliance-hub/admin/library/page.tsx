"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { LoadingState } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type DiffResult = {
  added: Record<string, number>;
  updated: Record<string, number>;
  deactivated: Record<string, number>;
};

type ImportResult = {
  batch_id: string;
  counts: Record<string, number>;
};

type Version = {
  id: string;
  schema_version: string;
  dataset: string;
  exported_at: string;
  version_label?: string | null;
  source: string;
  payload_sha256: string;
  imported_at: string;
  imported_by_user_id?: string | null;
};

const DEFAULT_SERVER_FILE = "docs/compliance-hub/compliance_tenant_import_package_v1_2.json";

export default function ComplianceLibraryAdminPage() {
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [serverFile, setServerFile] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState("");

  useEffect(() => {
    if (!authLoading && !tenantLoading && !(hasModule("compliance") && hasPermission("compliance:admin"))) {
      router.replace("/compliance-hub");
    }
  }, [authLoading, hasModule, hasPermission, router, tenantLoading]);

  const loadVersions = async () => {
    if (!accessToken) return;
    const data = await api.get<Version[]>("/compliance/library/versions", accessToken);
    setVersions(data);
  };

  useEffect(() => {
    void loadVersions();
  }, [accessToken]);

  const requestBody = useMemo(() => {
    if (serverFile) {
      return { server_file: serverFile, version_label: versionLabel || null };
    }
    if (payload) {
      return { payload, version_label: versionLabel || null };
    }
    return null;
  }, [payload, serverFile, versionLabel]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setValidation(null);
    setDiff(null);
    setServerFile(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse JSON file.");
      setPayload(null);
    }
  };

  const runValidate = async () => {
    if (!accessToken || !requestBody) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<ValidationResult>("/compliance/library/validate", requestBody, accessToken);
      setValidation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  };

  const runDiff = async () => {
    if (!accessToken || !requestBody) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<DiffResult>("/compliance/library/diff", requestBody, accessToken);
      setDiff(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diff failed.");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!accessToken || !requestBody) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<ImportResult>("/compliance/library/import", requestBody, accessToken);
      setValidation(null);
      setDiff(null);
      await loadVersions();
      setError(`Import completed. Batch ${data.batch_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (batchId: string) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<ImportResult>(`/compliance/library/rollback/${batchId}`, {}, accessToken);
      await loadVersions();
      setError(`Rollback completed. Batch ${data.batch_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || tenantLoading) {
    return <LoadingState label="Loading library admin..." />;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div>
        <h2 className="text-2xl font-semibold">Library Admin</h2>
        <p className="text-sm text-muted-foreground">
          Import or update the tenant library snapshot. This never changes control status or evidence.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Import source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Upload JSON package</Label>
              <Input type="file" accept="application/json" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-2">
              <Label>Use default baseline</Label>
              <Button
                type="button"
                variant={serverFile ? "default" : "outline"}
                onClick={() => {
                  setPayload(null);
                  setServerFile(DEFAULT_SERVER_FILE);
                  setValidation(null);
                  setDiff(null);
                }}
              >
                Load canonical tenant package
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Version label (optional)</Label>
            <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. v1.2-tenant" />
          </div>
          <div className="text-xs text-muted-foreground">
            {serverFile
              ? `Using server file: ${serverFile}`
              : payload
                ? "Custom JSON payload loaded."
                : "No package selected yet."}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!requestBody || busy} onClick={runValidate}>
              Validate
            </Button>
            <Button type="button" variant="outline" disabled={!requestBody || busy} onClick={runDiff}>
              Diff
            </Button>
            <Button type="button" disabled={!requestBody || busy} onClick={runImport}>
              Apply Import
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
          </CardHeader>
          <CardContent>
            {!validation ? (
              <EmptyState title="No validation yet" description="Run validation to check the package." />
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  Status: <span className={validation.valid ? "text-green-600" : "text-red-600"}>{validation.valid ? "Valid" : "Invalid"}</span>
                </div>
                {validation.errors.length ? (
                  <div>
                    <div className="font-medium">Errors</div>
                    <ul className="list-disc pl-5">
                      {validation.errors.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {validation.warnings.length ? (
                  <div>
                    <div className="font-medium">Warnings</div>
                    <ul className="list-disc pl-5">
                      {validation.warnings.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Diff preview</CardTitle>
          </CardHeader>
          <CardContent>
            {!diff ? (
              <EmptyState title="No diff yet" description="Run diff to preview changes." />
            ) : (
              <div className="space-y-3 text-sm">
                {["added", "updated", "deactivated"].map((section) => (
                  <div key={section}>
                    <div className="font-medium capitalize">{section}</div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      {Object.entries(diff[section as keyof DiffResult]).map(([key, value]) => (
                        <div key={key}>{`${key}: ${value}`}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <EmptyState title="No imports yet" description="Run an import to start version history." />
          ) : (
            <div className="space-y-3 text-sm">
              {versions.map((version) => (
                <div key={version.id} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{version.dataset}</div>
                      <div className="text-xs text-muted-foreground">
                        {version.schema_version} · {version.exported_at} · {version.source}
                      </div>
                      <div className="text-xs text-muted-foreground">SHA: {version.payload_sha256}</div>
                    </div>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => rollback(version.id)}>
                      Rollback
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
