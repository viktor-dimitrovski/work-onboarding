'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function NewReleaseNoteSheet({ open, onClose }: Props) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [tag, setTag] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [componentType, setComponentType] = useState<'service' | 'config'>('service');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isConfig = componentType === 'config';

  const handleRepoChange = (val: string) => {
    setRepo(val);
    if (!serviceName || serviceName === repo.split('/').pop()) {
      setServiceName(val.split('/').pop() ?? '');
    }
    // Auto-detect config repos (heuristic: contains "config")
    if (val.toLowerCase().includes('config')) {
      setComponentType('config');
    } else {
      setComponentType('service');
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!repo.trim()) errs.repo = 'Repository is required';
    if (!tag.trim()) errs.tag = 'Tag/version is required';
    if (!serviceName.trim()) errs.serviceName = 'Service name is required';
    if (isConfig && !branch.trim()) errs.branch = 'Branch is required for config repos';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!validate() || !accessToken) return;
    setSaving(true);
    try {
      const body = {
        repo: repo.trim(),
        branch: isConfig ? branch.trim() || null : null,
        service_name: serviceName.trim(),
        component_type: componentType,
        tag: tag.trim(),
      };
      const result = await api.post<{ id: string }>('/release-notes', body, accessToken);
      onClose();
      router.push(`/release-notes/${result.id}`);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Failed to create release note' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>New Release Note</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Create a release note document for a service or bank configuration version.
          </p>
        </SheetHeader>

        <div className="space-y-4">
          {/* Component type */}
          <div>
            <Label className="text-xs font-medium mb-2 block">Component Type</Label>
            <div className="flex gap-2">
              {(['service', 'config'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setComponentType(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    componentType === t
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t === 'service' ? 'Service / Library' : 'Bank Configuration'}
                </button>
              ))}
            </div>
          </div>

          {/* Repo */}
          <div>
            <Label className="text-xs font-medium mb-1 block">
              GitHub Repository <span className="text-red-500">*</span>
            </Label>
            <Input
              value={repo}
              onChange={(e) => handleRepoChange(e.target.value)}
              placeholder="my-org/open-banking-gateway"
              className={errors.repo ? 'border-red-400' : ''}
            />
            {errors.repo && <p className="text-xs text-red-500 mt-0.5">{errors.repo}</p>}
            <p className="text-xs text-muted-foreground mt-1">Format: org/repo-name</p>
          </div>

          {/* Branch (config only) */}
          {isConfig && (
            <div>
              <Label className="text-xs font-medium mb-1 block">
                Bank Branch <span className="text-red-500">*</span>
              </Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="pl_pko"
                className={errors.branch ? 'border-red-400' : ''}
              />
              {errors.branch && <p className="text-xs text-red-500 mt-0.5">{errors.branch}</p>}
              <p className="text-xs text-muted-foreground mt-1">Branch name = bank identifier (e.g. pl_pko, de_ing)</p>
            </div>
          )}

          {/* Service name */}
          <div>
            <Label className="text-xs font-medium mb-1 block">
              Display Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="Open Banking Gateway"
              className={errors.serviceName ? 'border-red-400' : ''}
            />
            {errors.serviceName && <p className="text-xs text-red-500 mt-0.5">{errors.serviceName}</p>}
          </div>

          {/* Tag */}
          <div>
            <Label className="text-xs font-medium mb-1 block">
              Version Tag <span className="text-red-500">*</span>
            </Label>
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={isConfig ? 'pl_pko_1.3.2' : '2.4.1'}
              className={errors.tag ? 'border-red-400' : ''}
            />
            {errors.tag && <p className="text-xs text-red-500 mt-0.5">{errors.tag}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              {isConfig ? 'Format: bankId_x.x.x or country_bank_x.x.x' : 'Semantic version: x.y.z'}
            </p>
          </div>

          {errors.submit && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {errors.submit}
            </p>
          )}

          <Button className="w-full" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create & Edit'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
