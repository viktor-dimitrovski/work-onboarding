'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, AlertTriangle, BookOpen } from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { api } from '@/lib/api';
import type { IrDictionary, IrDictionaryItem } from '@/lib/types';
import { formatDateShort } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState } from '@/components/common/loading-state';
import { EmptyState } from '@/components/common/empty-state';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function IrDictionariesPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasModule, hasPermission, isLoading: tenantLoading } = useTenant();
  const { isLoading: authLoading } = useAuth();

  const [dictionaries, setDictionaries] = useState<IrDictionary[]>([]);
  const [selectedDict, setSelectedDict] = useState<IrDictionary | null>(null);
  const [items, setItems] = useState<IrDictionaryItem[]>([]);
  const [loadingDicts, setLoadingDicts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<IrDictionaryItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [itemForm, setItemForm] = useState({ code: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !tenantLoading) {
      if (!hasModule('integration_registry') || !hasPermission('ir:read')) {
        router.replace('/dashboard');
      }
    }
  }, [authLoading, tenantLoading, hasModule, hasPermission, router]);

  const loadDictionaries = useCallback(() => {
    if (!accessToken) return;
    setLoadingDicts(true);
    api
      .get<IrDictionary[]>('/integration-registry/dictionaries', accessToken)
      .then((dicts) => {
        setDictionaries(dicts);
        if (dicts.length > 0 && !selectedDict) {
          setSelectedDict(dicts[0]);
        }
      })
      .catch((e) => setError(e.message || 'Failed to load dictionaries'))
      .finally(() => setLoadingDicts(false));
  }, [accessToken, selectedDict]);

  useEffect(() => { loadDictionaries(); }, [loadDictionaries]);

  const loadItems = useCallback(() => {
    if (!accessToken || !selectedDict) return;
    setLoadingItems(true);
    api
      .get<IrDictionaryItem[]>(
        `/integration-registry/dictionaries/${selectedDict.key}/items?active_only=false`,
        accessToken,
      )
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));
  }, [accessToken, selectedDict]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const openAddItem = () => {
    setEditItem(null);
    setItemForm({ code: '', label: '' });
    setSaveError(null);
    setDrawerOpen(true);
  };

  const openEditItem = (item: IrDictionaryItem) => {
    setEditItem(item);
    setItemForm({ code: item.code, label: item.label });
    setSaveError(null);
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!accessToken || !selectedDict) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editItem) {
        await api.patch(
          `/integration-registry/dictionaries/${selectedDict.key}/items/${editItem.id}`,
          { label: itemForm.label },
          accessToken,
        );
      } else {
        await api.post(
          `/integration-registry/dictionaries/${selectedDict.key}/items`,
          { code: itemForm.code.toUpperCase().replace(/[^A-Z0-9]/g, '_'), label: itemForm.label },
          accessToken,
        );
      }
      setDrawerOpen(false);
      loadItems();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: IrDictionaryItem) => {
    if (!accessToken || !selectedDict) return;
    try {
      await api.patch(
        `/integration-registry/dictionaries/${selectedDict.key}/items/${item.id}`,
        { is_active: !item.is_active },
        accessToken,
      );
      loadItems();
    } catch {
      setError('Failed to update item');
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto min-w-0">
      <div>
        <h1 className="text-xl font-semibold">Dictionaries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage code lists that drive all dropdowns in the Integration Registry.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-4 min-h-[400px]">
        {/* Left: dictionary list */}
        <Card className="w-60 shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              Lists
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingDicts ? (
              <LoadingState />
            ) : (
              <div className="flex flex-col">
                {dictionaries.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDict(d)}
                    className={`text-left px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 border-l-2 ${
                      selectedDict?.id === d.id
                        ? 'border-primary bg-muted/20 font-medium'
                        : 'border-transparent'
                    }`}
                  >
                    <div>{d.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {d.key}
                      {d.is_addable && (
                        <span className="ml-1 text-emerald-600">+addable</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: items table */}
        <Card className="flex-1">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {selectedDict ? selectedDict.name : 'Select a dictionary'}
            </CardTitle>
            {selectedDict?.is_addable && hasPermission('ir:write') && (
              <Button size="sm" onClick={openAddItem}>
                <Plus className="h-3 w-3 mr-1" />
                Add Item
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {!selectedDict ? (
              <div className="p-6">
                <EmptyState title="No dictionary selected" description="Choose a dictionary from the left panel." />
              </div>
            ) : loadingItems ? (
              <LoadingState />
            ) : items.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No items" description="This dictionary has no entries yet." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Code</th>
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Label</th>
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Active</th>
                      <th className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Updated</th>
                      {hasPermission('ir:write') && (
                        <th className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground py-3 px-4">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs">{item.code}</td>
                        <td className="py-3 px-4">{item.label}</td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className={`text-xs ${item.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}
                          >
                            {item.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {formatDateShort(item.updated_at)}
                        </td>
                        {hasPermission('ir:write') && (
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                onClick={() => openEditItem(item)}
                              >
                                <Pencil className="h-3 w-3" /> Edit
                              </button>
                              <button
                                className="text-xs text-muted-foreground hover:underline"
                                onClick={() => toggleActive(item)}
                              >
                                {item.is_active ? 'Disable' : 'Enable'}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit item drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="flex h-full w-full max-w-md flex-col">
          <SheetHeader>
            <SheetTitle>
              {editItem ? 'Edit Item' : `Add Item to ${selectedDict?.name}`}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 py-4 flex flex-col gap-4">
            {!editItem && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-code">Code *</Label>
                <Input
                  id="item-code"
                  value={itemForm.code}
                  onChange={(e) => setItemForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. MY_VALUE"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Uppercase alphanumeric. Will be auto-normalized.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-label">Label *</Label>
              <Input
                id="item-label"
                value={itemForm.label}
                onChange={(e) => setItemForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Human-readable label"
              />
            </div>

            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            )}
          </div>

          <div className="border-t pt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDrawerOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !itemForm.label.trim() || (!editItem && !itemForm.code.trim())}
            >
              {saving ? 'Saving…' : editItem ? 'Save' : 'Add Item'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
