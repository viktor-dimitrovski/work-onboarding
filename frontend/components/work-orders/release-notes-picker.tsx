'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, X, Plus, Search, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

type ReleaseNoteSummary = {
  id: string;
  repo: string;
  branch: string | null;
  service_name: string;
  component_type: string;
  tag: string;
  status: string;
  item_count: number;
  updated_at: string;
};

type Props = {
  woId: string;
  serviceDbId: string;
  repo: string | null | undefined;
  linkedId: string | null;
  linkedLabel: string | null;
  onLinked: (id: string | null, label: string | null) => void;
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  published: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export function ReleaseNotesPicker({ woId, serviceDbId, repo, linkedId, linkedLabel, onLinked }: Props) {
  const { accessToken } = useAuth();
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ReleaseNoteSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); return; }
    void fetchOptions('');
  }, [open]);

  const fetchOptions = async (q: string) => {
    if (!accessToken || !woId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ linkable_for_wo: woId });
      if (repo) params.set('repo', repo);
      if (q) params.set('q', q);
      const data = await api.get<{ items: ReleaseNoteSummary[] }>(`/release-notes?${params}`, accessToken);
      setResults(data.items ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const patchLink = async (id: string | null) => {
    if (!accessToken || !serviceDbId) return;
    setSaving(true);
    try {
      await api.patch(`/work-orders/services/${serviceDbId}/release-note`, { release_note_id: id }, accessToken);
    } catch {
      // ignore, optimistic update already applied
    } finally {
      setSaving(false);
    }
  };

  const handleLink = async (id: string, label: string) => {
    onLinked(id, label);
    await patchLink(id);
    setOpen(false);
  };

  const handleUnlink = async () => {
    onLinked(null, null);
    await patchLink(null);
  };

  if (linkedId) {
    return (
      <div className="flex items-center gap-1">
        <a
          href={`/release-notes/${linkedId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100 transition-colors max-w-[140px] truncate"
          title={linkedLabel ?? linkedId}
        >
          <Link2 className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">{linkedLabel ?? 'Linked'}</span>
          <ExternalLink className="h-2 w-2 flex-shrink-0" />
        </a>
        <button
          type="button"
          onClick={handleUnlink}
          disabled={saving}
          className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
          title="Unlink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors',
          open
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
        )}
      >
        <Link2 className="h-2.5 w-2.5" />
        Link RN
      </button>

      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 rounded-lg border bg-white shadow-xl">
          {/* Search input */}
          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              placeholder="Search by service, repo, tag…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); void fetchOptions(e.target.value); }}
            />
          </div>

          {/* Results */}
          <div className="max-h-52 overflow-y-auto">
            {loading && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-3 py-4 text-center space-y-2">
                <p className="text-xs text-muted-foreground">No linkable Release Notes found.</p>
                <a
                  href="/release-notes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Create new Release Note
                </a>
              </div>
            )}
            {!loading && results.map((rn) => (
              <button
                key={rn.id}
                type="button"
                className="w-full flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                onClick={() => {
                  const label = `${rn.service_name} @ ${rn.tag}`;
                  void handleLink(rn.id, label);
                }}
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-xs font-medium text-slate-800 truncate">
                    {rn.service_name}
                    <span className="font-mono text-[10px] text-muted-foreground ml-1">@ {rn.tag}</span>
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      'text-[10px] rounded-full border px-1.5 py-0.5 font-medium',
                      STATUS_COLORS[rn.status] ?? 'bg-slate-100 text-slate-600',
                    )}>
                      {rn.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{rn.item_count} item{rn.item_count !== 1 ? 's' : ''}</span>
                    {rn.branch && (
                      <span className="text-[10px] text-muted-foreground font-mono">/{rn.branch}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t px-3 py-1.5">
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-slate-600"
              onClick={() => setOpen(false)}
            >
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
