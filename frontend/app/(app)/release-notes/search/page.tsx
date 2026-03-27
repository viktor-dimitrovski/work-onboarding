'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, FileText, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

type DCDeploymentStatus = {
  data_center_id: string;
  data_center_name: string;
  data_center_slug: string;
  status: string;
  deployed_at: string | null;
  platform_release_name: string | null;
};

type FunctionalitySearchResult = {
  item_id: string;
  item_title: string;
  item_type: string;
  description: string | null;
  release_note_id: string;
  release_note_status: string;
  is_draft: boolean;
  service_name: string;
  repo: string;
  tag: string;
  component_type: string;
  dc_deployments: DCDeploymentStatus[];
};

type DataCenter = { id: string; name: string; slug: string };

const ITEM_TYPE_LABELS: Record<string, string> = {
  feature: 'Feature', bug_fix: 'Bug Fix', security: 'Security',
  api_change: 'API Change', breaking_change: 'Breaking', config_change: 'Config',
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  feature: 'bg-blue-100 text-blue-700 border-blue-200',
  bug_fix: 'bg-orange-100 text-orange-700 border-orange-200',
  security: 'bg-red-100 text-red-700 border-red-200',
  api_change: 'bg-purple-100 text-purple-700 border-purple-200',
  breaking_change: 'bg-rose-100 text-rose-700 border-rose-200',
  config_change: 'bg-slate-100 text-slate-700 border-slate-200',
};

function DCStatusCell({ status }: { status: DCDeploymentStatus }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (status.status === 'deployed') {
    return (
      <div
        className="relative flex items-center justify-center"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="text-emerald-600 text-base">✅</span>
        {showTooltip && status.deployed_at && (
          <div className="absolute z-10 bottom-full mb-1 left-1/2 -translate-x-1/2 rounded-md border bg-white shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap">
            <p className="font-medium text-slate-800">{status.platform_release_name ?? 'Unknown release'}</p>
            <p className="text-muted-foreground">{new Date(status.deployed_at).toLocaleDateString()}</p>
          </div>
        )}
      </div>
    );
  }
  if (status.status === 'blocked') {
    return <span className="text-red-500 text-base">⚠️</span>;
  }
  return <span className="text-slate-300 text-base">⏳</span>;
}

export default function FunctionalitySearchPage() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FunctionalitySearchResult[]>([]);
  const [dataCenters, setDataCenters] = useState<DataCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [includeDraft, setIncludeDraft] = useState(true);
  const [componentTypeFilter, setComponentTypeFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get<{ items: DataCenter[] }>('/data-centers', accessToken)
      .then((res) => setDataCenters(res.items ?? []))
      .catch(() => setDataCenters([]));
  }, [accessToken]);

  const doSearch = useCallback(async (q: string) => {
    if (!accessToken || q.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q, include_draft: String(includeDraft) });
      if (componentTypeFilter) params.set('component_type', componentTypeFilter);
      const data = await api.get<FunctionalitySearchResult[]>(`/release-notes/items/search?${params}`, accessToken);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, includeDraft, componentTypeFilter]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void doSearch(value); }, 350);
  };

  // Derive unique DCs from results for dynamic columns (fallback to tenant DCs)
  const displayDCs = dataCenters.length > 0 ? dataCenters : [];

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Functionality Search</h1>
        <p className="text-sm text-muted-foreground">
          Search for features, bug fixes, or security items across all Release Notes and see their deployment status per Data Center.
        </p>
      </div>

      {/* Search & filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by feature title or description… (min 2 characters)"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          <div className="flex items-center gap-1.5">
            {['', 'service', 'config'].map((ct) => (
              <button
                key={ct}
                onClick={() => { setComponentTypeFilter(ct); if (query.length >= 2) { if (debounceRef.current) clearTimeout(debounceRef.current); void doSearch(query); } }}
                className={cn(
                  'text-xs rounded-md border px-2.5 py-1 transition-colors',
                  componentTypeFilter === ct ? 'border-slate-700 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-300 text-slate-600',
                )}
              >
                {ct === '' ? 'All types' : ct === 'service' ? 'Services' : 'Configs'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={includeDraft}
              onChange={(e) => { setIncludeDraft(e.target.checked); if (query.length >= 2) { if (debounceRef.current) clearTimeout(debounceRef.current); void doSearch(query); } }}
              className="rounded border-slate-300"
            />
            Include draft Release Notes
          </label>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-center py-8 text-sm text-muted-foreground">Searching…</div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No results found for <strong>&ldquo;{query}&rdquo;</strong>. Try a different search term.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="w-6 px-3 py-2.5"></th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600 text-xs uppercase tracking-wide">Feature / Fix</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs uppercase tracking-wide">Type</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs uppercase tracking-wide">Service @ Tag</th>
                {displayDCs.map((dc) => (
                  <th key={dc.id} className="text-center px-3 py-2.5 font-medium text-slate-600 text-xs uppercase tracking-wide">
                    {dc.slug ?? dc.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {results.map((item) => {
                const dcMap = Object.fromEntries(item.dc_deployments.map((d) => [d.data_center_id, d]));
                return (
                  <tr key={item.item_id} className={cn('hover:bg-slate-50/50 transition-colors', item.is_draft ? 'opacity-70' : '')}>
                    {/* Draft indicator */}
                    <td className="px-3 py-3 text-center">
                      {item.is_draft && (
                        <div className="relative group inline-block">
                          <FileText className="h-3.5 w-3.5 text-amber-500" />
                          <div className="absolute z-10 left-full ml-1.5 top-1/2 -translate-y-1/2 rounded-md border bg-white shadow-lg px-2 py-1 text-[10px] text-slate-700 whitespace-nowrap hidden group-hover:block">
                            From draft Release Note — content may be incomplete
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <Link
                          href={`/release-notes/${item.release_note_id}`}
                          className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                        >
                          {item.item_title}
                        </Link>
                        {item.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-xs">{item.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        'inline-block text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5',
                        ITEM_TYPE_COLORS[item.item_type] ?? 'bg-slate-100 text-slate-600',
                      )}>
                        {ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-slate-700">{item.service_name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{item.tag}</p>
                      </div>
                    </td>
                    {displayDCs.map((dc) => {
                      const dcStatus = dcMap[dc.id];
                      return (
                        <td key={dc.id} className="px-3 py-3 text-center">
                          {dcStatus ? (
                            <DCStatusCell status={dcStatus} />
                          ) : (
                            <span className="text-slate-200 text-base">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t bg-slate-50 px-4 py-2 text-xs text-muted-foreground">
            {results.length} result{results.length !== 1 ? 's' : ''} found
            {results.some((r) => r.is_draft) && (
              <span className="ml-3 inline-flex items-center gap-1 text-amber-600">
                <FileText className="h-3 w-3" />
                Some results are from draft Release Notes
              </span>
            )}
          </div>
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <Search className="h-8 w-8 mx-auto text-slate-300" />
          <p className="text-sm">Type at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
}
