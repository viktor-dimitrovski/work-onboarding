"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/tenant-context";

type ClientGroup = {
  id: string;
};

export default function ComplianceClientsNewPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading } = useTenant();
  const [country, setCountry] = useState("");
  const [bankName, setBankName] = useState("");
  const [project, setProject] = useState("");
  const [versionLabel, setVersionLabel] = useState("v1");
  const [requirementsText, setRequirementsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !(hasModule("compliance") && hasPermission("compliance:write"))) {
      router.replace("/compliance-hub/clients");
    }
  }, [hasModule, hasPermission, isLoading, router]);

  const create = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const group = await api.post<ClientGroup>(
        "/compliance/clients",
        { country: country || null, bank_name: bankName || null, project: project || null },
        accessToken,
      );
      await api.post(
        `/compliance/clients/${group.id}/versions`,
        { version_label: versionLabel || "v1", requirements_text: requirementsText },
        accessToken,
      );
      router.push(`/compliance-hub/clients/${group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client set.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">New client set</h2>
        <p className="text-sm text-muted-foreground">Create a versioned client requirement set.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Client metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Country</Label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bank / Client</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Project</Label>
            <Input value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Version label</Label>
            <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Paste requirements (one per line)</Label>
            <Textarea value={requirementsText} onChange={(e) => setRequirementsText(e.target.value)} rows={10} />
          </div>
          <Button type="button" disabled={saving} onClick={create}>
            {saving ? "Creating..." : "Create client set"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
