'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { comboToDisplay, eventToCombo, normalizeCombo } from '@/lib/hotkeys';
import {
  KEYBINDING_ACTIONS,
  KeybindingProfile,
  applyDefaultBindings,
  getDefaultBindings,
  normalizeBindingsMap,
  saveLocalProfile,
  saveRemoteProfile,
  syncKeybindingsProfile,
} from '@/lib/keybindingsStore';
import { cn } from '@/lib/utils';
import { AlertTriangle, Download, RefreshCcw, Upload } from 'lucide-react';

type PendingConflict = {
  actionId: string;
  conflictId: string;
  combo: string;
};

export default function SettingsKeybindingsPage() {
  const { accessToken, isLoading } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const router = useRouter();
  const [profile, setProfile] = useState<KeybindingProfile>(applyDefaultBindings({ updated_at: 0, bindings: {} }));
  const [baseline, setBaseline] = useState<KeybindingProfile>(applyDefaultBindings({ updated_at: 0, bindings: {} }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listeningAction, setListeningAction] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const dirty = useMemo(() => profile.updated_at !== baseline.updated_at, [baseline.updated_at, profile.updated_at]);

  useEffect(() => {
    if (!isLoading && !tenantLoading && !(hasModule('releases') && hasPermission('releases:read'))) {
      router.replace('/dashboard');
    }
  }, [hasModule, hasPermission, isLoading, router, tenantLoading]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    syncKeybindingsProfile(accessToken)
      .then((loaded) => {
        if (!mounted) return;
        setProfile(loaded);
        setBaseline(loaded);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!listeningAction) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setListeningAction(null);
        return;
      }
      const combo = normalizeCombo(eventToCombo(event));
      if (!combo) return;
      event.preventDefault();
      const existing = Object.entries(profile.bindings).find(
        ([actionId, bindings]) => actionId !== listeningAction && bindings?.includes(combo),
      );
      if (existing) {
        setConflict({ actionId: listeningAction, conflictId: existing[0], combo });
        setListeningAction(null);
        return;
      }
      const next = applyDefaultBindings({
        updated_at: Date.now(),
        bindings: { ...profile.bindings, [listeningAction]: [combo] },
      });
      setProfile(next);
      setListeningAction(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [listeningAction, profile.bindings]);

  const groupedActions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = KEYBINDING_ACTIONS.filter((action) => {
      if (!query) return true;
      return (
        action.label.toLowerCase().includes(query) ||
        action.id.toLowerCase().includes(query) ||
        (profile.bindings[action.id] || []).some((binding) => binding.toLowerCase().includes(query))
      );
    });
    const grouped: Record<string, typeof filtered> = {};
    filtered.forEach((action) => {
      grouped[action.category] = grouped[action.category] || [];
      grouped[action.category].push(action);
    });
    return grouped;
  }, [profile.bindings, search]);

  const saveProfile = async () => {
    const payload = applyDefaultBindings({ ...profile, updated_at: Date.now() });
    setSaving(true);
    try {
      if (accessToken) {
        const saved = await saveRemoteProfile(accessToken, payload);
        if (saved) {
          setProfile(saved);
          setBaseline(saved);
          saveLocalProfile(saved);
        }
      } else {
        saveLocalProfile(payload);
        setProfile(payload);
        setBaseline(payload);
      }
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    const defaults = applyDefaultBindings({ updated_at: Date.now(), bindings: getDefaultBindings() });
    setProfile(defaults);
  };

  const clearBinding = (actionId: string) => {
    const next = applyDefaultBindings({
      updated_at: Date.now(),
      bindings: { ...profile.bindings, [actionId]: [] },
    });
    setProfile(next);
  };

  const resolveConflict = (mode: 'swap' | 'clear') => {
    if (!conflict) return;
    const currentBindings = profile.bindings[conflict.actionId] || [];
    const nextBindings = { ...profile.bindings };
    nextBindings[conflict.actionId] = [conflict.combo];
    nextBindings[conflict.conflictId] = mode === 'swap' ? currentBindings : [];
    const next = applyDefaultBindings({ updated_at: Date.now(), bindings: nextBindings });
    setProfile(next);
    setConflict(null);
  };

  const handleImport = () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importValue) as KeybindingProfile;
      const next = applyDefaultBindings({
        updated_at: Date.now(),
        bindings: normalizeBindingsMap(parsed.bindings || {}),
      });
      setProfile(next);
      setImportOpen(false);
      setImportValue('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  if (loading) {
    return <p className='text-sm text-muted-foreground'>Loading keybindings…</p>;
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Keybindings</h2>
          <p className='text-sm text-muted-foreground'>Customize shortcuts for the Work Order editor.</p>
        </div>
        <div className='flex items-center gap-2'>
          <Button type='button' variant='outline' onClick={resetDefaults}>
            <RefreshCcw className='mr-2 h-4 w-4' />
            Reset defaults
          </Button>
          <Button type='button' variant='outline' onClick={() => setImportOpen(true)}>
            <Upload className='mr-2 h-4 w-4' />
            Import
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              if (!navigator.clipboard) return;
              void navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
            }}
          >
            <Download className='mr-2 h-4 w-4' />
            Export
          </Button>
          <Button type='button' onClick={saveProfile} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {conflict ? (
        <Card className='border-amber-200 bg-amber-50/40'>
          <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-amber-900'>
            <div className='flex items-center gap-2'>
              <AlertTriangle className='h-4 w-4' />
              <span>
                {comboToDisplay(conflict.combo)} is already assigned to{' '}
                {KEYBINDING_ACTIONS.find((action) => action.id === conflict.conflictId)?.label ?? conflict.conflictId}.
              </span>
            </div>
            <div className='flex gap-2'>
              <Button type='button' size='sm' variant='outline' onClick={() => resolveConflict('swap')}>
                Swap
              </Button>
              <Button type='button' size='sm' variant='outline' onClick={() => resolveConflict('clear')}>
                Clear other
              </Button>
              <Button type='button' size='sm' variant='ghost' onClick={() => setConflict(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Search bindings</CardTitle>
          <CardDescription>Press “Change” then type your preferred keys.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Input placeholder='Search actions…' value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className='space-y-6'>
            {Object.entries(groupedActions).map(([group, actions]) => (
              <div key={group} className='space-y-2'>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>{group}</p>
                <div className='space-y-2'>
                  {actions.map((action) => {
                    const bindings = profile.bindings[action.id] || [];
                    const isListening = listeningAction === action.id;
                    return (
                      <div
                        key={action.id}
                        className={cn(
                          'flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2',
                          isListening && 'border-primary/40 bg-primary/5',
                        )}
                      >
                        <div>
                          <p className='text-sm font-medium'>{action.label}</p>
                          <p className='text-xs text-muted-foreground'>{action.id}</p>
                        </div>
                        <div className='flex flex-wrap items-center gap-2'>
                          {bindings.length ? (
                            bindings.map((binding) => (
                              <span key={binding} className='rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground'>
                                {comboToDisplay(binding)}
                              </span>
                            ))
                          ) : (
                            <span className='text-[10px] text-muted-foreground'>Unbound</span>
                          )}
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            onClick={() => setListeningAction(action.id)}
                          >
                            {isListening ? 'Press keys…' : 'Change'}
                          </Button>
                          <Button type='button' size='sm' variant='ghost' onClick={() => clearBinding(action.id)}>
                            Clear
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <DialogPrimitive.Root open={importOpen} onOpenChange={setImportOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-slate-950/40' />
          <DialogPrimitive.Content className='fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-soft'>
            <DialogPrimitive.Title className='text-lg font-semibold'>Import keybindings</DialogPrimitive.Title>
            <div className='mt-4 space-y-3'>
              <Textarea
                rows={8}
                value={importValue}
                onChange={(event) => setImportValue(event.target.value)}
                placeholder='Paste keybindings JSON here...'
              />
              {importError ? <p className='text-sm text-destructive'>{importError}</p> : null}
              <div className='flex justify-end gap-2'>
                <Button type='button' variant='ghost' onClick={() => setImportOpen(false)}>
                  Cancel
                </Button>
                <Button type='button' onClick={handleImport}>
                  Import
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
