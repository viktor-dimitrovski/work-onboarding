'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { FileText, Plus, Search, Tag } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { NewReleaseNoteSheet } from '@/components/release-notes/new-release-note-sheet';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';

type ReleaseNoteSummary = {
  id: string;
  repo: string;
  branch: string | null;
  service_name: string;
  component_type: string;
  tag: string;
  status: string;
  approved_by: string | null;
  item_count: number;
  author_count: number;
  created_at: string;
  updated_at: string;
};

const STATUS_STYLES: Record<string, { label: string; dot: string; text: string }> = {
  draft:     { label: 'Draft',     dot: 'bg-slate-400', text: 'text-slate-600' },
  published: { label: 'Published', dot: 'bg-emerald-400', text: 'text-emerald-700' },
  approved:  { label: 'Approved',  dot: 'bg-blue-500', text: 'text-blue-700' },
};

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_FILTERS = ['draft', 'published', 'approved'];
const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'service', label: 'Services' },
  { value: 'config', label: 'Config' },
];

export default function ReleaseNotesPage() {
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const [items, setItems] = useState<ReleaseNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [showNew, setShowNew] = useState(false);

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (typeFilter) params.set('component_type', typeFilter);
      if (statusFilters.length === 1) params.set('status', statusFilters[0]);
      const res = await api.get<{ items: ReleaseNoteSummary[] }>(`/release-notes?${params}`, accessToken);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load release notes');
    } finally {
      setLoading(false);
    }
  }, [accessToken, query, typeFilter, statusFilters]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = (s: string) =>
    setStatusFilters((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const filtered = items.filter((item) => {
    if (statusFilters.length > 0 && !statusFilters.includes(item.status)) return false;
    return true;
  });

  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Release Notes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Per-service and per-configuration version documents
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Release Note
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Component type */}
        <div className="flex rounded-lg border bg-white p-0.5 gap-0.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                typeFilter === f.value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Status chips */}
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((s) => {
            const sm = STATUS_STYLES[s];
            const active = statusFilters.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-white' : sm.dot)} />
                {sm.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search service, repo, tag…"
            className="pl-8 h-8 text-sm w-56"
          />
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm animate-pulse">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-14 rounded-full bg-slate-200" />
                  <div className="h-4 w-32 rounded bg-slate-200" />
                  <div className="h-4 w-16 rounded bg-slate-100" />
                </div>
                <div className="h-3 w-48 rounded bg-slate-100" />
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="h-3 w-16 rounded bg-slate-200" />
                <div className="h-3 w-12 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error} <button onClick={load} className="underline ml-2">Retry</button>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title="No release notes"
          description={
            items.length > 0
              ? 'No notes match your filters. Try changing or clearing them.'
              : 'Create the first release note for a service or bank configuration.'
          }
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((note) => {
            const sm = STATUS_STYLES[note.status] ?? STATUS_STYLES.draft;
            return (
              <Link
                key={note.id}
                href={`/release-notes/${note.id}`}
                className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/50"
              >
                {/* Left: type + name */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] px-1.5 py-0 font-semibold tracking-wide uppercase',
                        note.component_type === 'service'
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700',
                      )}
                    >
                      {note.component_type === 'service' ? 'Service' : 'Config'}
                    </Badge>
                    <span className="font-medium text-sm text-slate-800">{note.service_name}</span>
                    {note.branch && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50">
                        {note.branch}
                      </Badge>
                    )}
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground font-mono">
                      <Tag className="h-3 w-3" />
                      {note.tag}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{note.repo}</p>
                </div>

                {/* Right: status + counts + time */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className={cn('flex items-center gap-1.5 text-xs font-medium', sm.text)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', sm.dot)} />
                    {sm.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{note.item_count} items</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(note.updated_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <NewReleaseNoteSheet open={showNew} onClose={() => { setShowNew(false); load(); }} />
    </div>
  );
}
