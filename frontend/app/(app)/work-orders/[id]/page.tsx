"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { MarkdownRenderer } from '@/components/common/markdown-renderer';
import { RiskChip } from '@/components/common/risk-chip';
import { StatusChip } from '@/components/common/status-chip';
import { LexicalMarkdownEditor } from '@/components/editor/lexical-markdown-editor';
import { ServicesTouchedGrid, type ServiceTouchedItem } from '@/components/work-orders/services-touched-grid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

type WorkOrderOut = {
  wo_id: string;
  path: string;
  sha?: string | null;
  raw_markdown: string;
  parsed: {
    title: string;
    type?: string | null;
    status?: string | null;
    owner?: string | null;
    requested_by?: string | null;
    tenants_impacted?: string[];
    risk?: string | null;
    target_envs?: string[];
    postman_testing_ref?: string | null;
    services_touched: ServiceTouchedItem[];
    body_markdown: string;
  };
  pr_url?: string | null;
  branch?: string | null;
};

function toInlineList(items: string[]) {
  const cleaned = (items || []).map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? `[${cleaned.join(', ')}]` : '[]';
}

function buildMarkdown(input: {
  wo_id?: string;
  title: string;
  type?: string | null;
  status?: string | null;
  owner?: string | null;
  requested_by?: string | null;
  tenants_impacted?: string[];
  risk?: string | null;
  target_envs?: string[];
  postman_testing_ref?: string | null;
  services: ServiceTouchedItem[];
  body: string;
}) {
  const lines: string[] = ['---'];
  if (input.wo_id) lines.push(`id: ${input.wo_id}`);
  lines.push(`title: ${input.title}`);
  if (input.type) lines.push(`type: ${input.type}`);
  if (input.status) lines.push(`status: ${input.status}`);
  if (input.owner) lines.push(`owner: ${input.owner}`);
  if (input.requested_by) lines.push(`requested_by: ${input.requested_by}`);
  if ((input.tenants_impacted || []).length) lines.push(`tenants_impacted: ${toInlineList(input.tenants_impacted || [])}`);
  if (input.risk) lines.push(`risk: ${input.risk}`);
  if ((input.target_envs || []).length) lines.push(`target_envs: ${toInlineList(input.target_envs || [])}`);
  if (input.postman_testing_ref) lines.push(`postman_testing_ref: ${input.postman_testing_ref}`);
  lines.push('');
  lines.push('services_touched:');
  if (input.services.length === 0) {
    lines[lines.length - 1] = 'services_touched: []';
  } else {
    input.services.forEach((item) => {
      lines.push(`  - service_id: ${item.service_id || ''}`);
      lines.push(`    repo: ${item.repo || ''}`);
      if (item.change_type) lines.push(`    change_type: ${item.change_type}`);
      lines.push(`    requires_deploy: ${item.requires_deploy ? 'true' : 'false'}`);
      lines.push(`    requires_db_migration: ${item.requires_db_migration ? 'true' : 'false'}`);
      lines.push(`    requires_config_change: ${item.requires_config_change ? 'true' : 'false'}`);
      const flags = (item.feature_flags || []).filter(Boolean);
      lines.push(`    feature_flags: ${flags.length ? `[${flags.join(', ')}]` : '[]'}`);
      lines.push(`    release_notes_ref: ${item.release_notes_ref || ''}`);
    });
  }
  lines.push('---');
  const trimmed = (input.body || '').trim();
  return trimmed ? `${lines.join('\n')}\n\n${trimmed}\n` : `${lines.join('\n')}\n`;
}

function splitFrontMatter(markdown: string): { frontMatter: string; body: string } {
  const text = markdown || '';
  if (!text.trim().startsWith('---')) return { frontMatter: '', body: text };
  const lines = text.split('\n');
  let second = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      second = i;
      break;
    }
  }
  if (second === -1) return { frontMatter: text, body: '' };
  return {
    frontMatter: lines.slice(0, second + 1).join('\n'),
    body: lines.slice(second + 1).join('\n').replace(/^\n+/, ''),
  };
}

function renderYamlLikeLine(line: string) {
  const trimmed = line.replace(/\t/g, '  ');
  if (!trimmed.trim()) return <span className='text-muted-foreground'>{line}</span>;
  if (trimmed.trim() === '---') return <span className='text-muted-foreground'>{trimmed}</span>;
  if (/^\s*-\s+/.test(trimmed)) {
    return (
      <>
        <span className='text-muted-foreground'>{trimmed.match(/^\s*-\s+/)?.[0] ?? ''}</span>
        <span className='text-foreground'>{trimmed.replace(/^\s*-\s+/, '')}</span>
      </>
    );
  }
  const m = /^(\s*)([a-zA-Z0-9_]+)(\s*:\s*)(.*)$/.exec(trimmed);
  if (!m) return <span className='text-foreground'>{trimmed}</span>;
  return (
    <>
      <span className='text-muted-foreground'>{m[1]}</span>
      <span className='text-sky-700'>{m[2]}</span>
      <span className='text-muted-foreground'>{m[3]}</span>
      <span className='text-foreground'>{m[4]}</span>
    </>
  );
}

type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string };

function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map<number, number>();
  v.set(1, 0);
  const traces: Map<number, number>[] = [];

  const getV = (k: number) => v.get(k) ?? -Infinity;

  for (let d = 0; d <= max; d += 1) {
    const vNext = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && getV(k - 1) < getV(k + 1))) {
        x = getV(k + 1);
      } else {
        x = getV(k - 1) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      vNext.set(k, x);
      if (x >= n && y >= m) {
        traces.push(vNext);
        // backtrack
        const ops: DiffOp[] = [];
        let x2 = n;
        let y2 = m;
        for (let d2 = traces.length - 1; d2 >= 0; d2 -= 1) {
          const vv = traces[d2];
          const k2 = x2 - y2;
          const prevK =
            k2 === -d2 || (k2 !== d2 && (vv.get(k2 - 1) ?? -Infinity) < (vv.get(k2 + 1) ?? -Infinity))
              ? k2 + 1
              : k2 - 1;
          const prevX = vv.get(prevK) ?? 0;
          const prevY = prevX - prevK;
          while (x2 > prevX && y2 > prevY) {
            ops.push({ type: 'equal', line: a[x2 - 1] });
            x2 -= 1;
            y2 -= 1;
          }
          if (d2 === 0) break;
          if (x2 === prevX) {
            ops.push({ type: 'insert', line: b[y2 - 1] });
            y2 -= 1;
          } else {
            ops.push({ type: 'delete', line: a[x2 - 1] });
            x2 -= 1;
          }
        }
        return ops.reverse();
      }
    }
    traces.push(vNext);
    v.clear();
    vNext.forEach((val, key) => v.set(key, val));
  }
  return a.map((line) => ({ type: 'equal', line }));
}

function buildOverviewYaml(input: {
  wo_id: string;
  title: string;
  type: string;
  status: string;
  risk: string;
  owner: string;
  requested_by: string;
  tenants_impacted: string[];
  target_envs: string[];
  postman_testing_ref: string;
}) {
  const lines: string[] = [];
  lines.push(`id: ${input.wo_id}`);
  lines.push(`title: ${input.title}`);
  lines.push(`type: ${input.type}`);
  lines.push(`status: ${input.status}`);
  lines.push(`risk: ${input.risk}`);
  lines.push(`owner: ${input.owner}`);
  lines.push(`requested_by: ${input.requested_by}`);
  lines.push(`tenants_impacted: ${toInlineList(input.tenants_impacted || [])}`);
  lines.push(`target_envs: ${toInlineList(input.target_envs || [])}`);
  lines.push(`postman_testing_ref: ${input.postman_testing_ref || ''}`);
  return `${lines.join('\n')}\n`;
}

function parseInlineList(value: string): string[] {
  const raw = (value || '').trim();
  if (!raw || raw === '[]') return [];
  const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
  return cleaned
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseOverviewYaml(text: string): Partial<{
  wo_id: string;
  title: string;
  type: string;
  status: string;
  risk: string;
  owner: string;
  requested_by: string;
  tenants_impacted: string[];
  target_envs: string[];
  postman_testing_ref: string;
}> {
  const out: Record<string, string> = {};
  (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
      if (!m?.[1]) return;
      out[m[1]] = m[2] ?? '';
    });
  return {
    wo_id: out.id?.trim(),
    title: out.title?.trim(),
    type: out.type?.trim(),
    status: out.status?.trim(),
    risk: out.risk?.trim(),
    owner: out.owner?.trim(),
    requested_by: out.requested_by?.trim(),
    tenants_impacted: parseInlineList(out.tenants_impacted || ''),
    target_envs: parseInlineList(out.target_envs || ''),
    postman_testing_ref: out.postman_testing_ref?.trim(),
  };
}

function buildServicesYaml(items: ServiceTouchedItem[]) {
  const lines: string[] = ['services_touched:'];
  if (!items || items.length === 0) {
    return 'services_touched: []\n';
  }
  items.forEach((item) => {
    lines.push(`  - service_id: ${item.service_id || ''}`);
    lines.push(`    repo: ${item.repo || ''}`);
    if (item.change_type) lines.push(`    change_type: ${item.change_type}`);
    lines.push(`    requires_deploy: ${item.requires_deploy ? 'true' : 'false'}`);
    lines.push(`    requires_db_migration: ${item.requires_db_migration ? 'true' : 'false'}`);
    lines.push(`    requires_config_change: ${item.requires_config_change ? 'true' : 'false'}`);
    const flags = (item.feature_flags || []).filter(Boolean);
    lines.push(`    feature_flags: ${flags.length ? `[${flags.join(', ')}]` : '[]'}`);
    lines.push(`    release_notes_ref: ${item.release_notes_ref || ''}`);
  });
  return `${lines.join('\n')}\n`;
}

function parseServicesYaml(text: string): ServiceTouchedItem[] {
  const lines = (text || '').split('\n');
  const items: ServiceTouchedItem[] = [];
  let current: ServiceTouchedItem | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim()) continue;
    if (line.trim() === 'services_touched: []') return [];
    if (line.trim() === 'services_touched:') continue;

    const startMatch = /^\s*-\s*service_id\s*:\s*(.*)$/.exec(line);
    if (startMatch) {
      if (current) items.push(current);
      current = {
        service_id: (startMatch[1] || '').trim(),
        repo: '',
        change_type: '',
        requires_deploy: false,
        requires_db_migration: false,
        requires_config_change: false,
        feature_flags: [],
        release_notes_ref: '',
      };
      continue;
    }

    const kv = /^\s*([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
    if (!kv?.[1] || !current) continue;
    const key = kv[1];
    const value = (kv[2] ?? '').trim();
    if (key === 'repo') current.repo = value;
    if (key === 'change_type') current.change_type = value;
    if (key === 'requires_deploy') current.requires_deploy = value === 'true';
    if (key === 'requires_db_migration') current.requires_db_migration = value === 'true';
    if (key === 'requires_config_change') current.requires_config_change = value === 'true';
    if (key === 'feature_flags') current.feature_flags = parseInlineList(value);
    if (key === 'release_notes_ref') current.release_notes_ref = value;
  }
  if (current) items.push(current);
  return items;
}

function extractHeadings(markdown: string): string[] {
  const text = markdown || '';
  const headings: string[] = [];
  const lines = text.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = /^##\s+(.+)\s*$/.exec(line);
    if (match?.[1]) headings.push(match[1].trim());
  }
  return headings;
}

function upsertSection(markdown: string, heading: string, content: string): string {
  const lines = (markdown || '').split('\n');
  const headingLine = `## ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine.toLowerCase());
  if (startIndex === -1) {
    const trimmed = (markdown || '').trim();
    return trimmed ? `${headingLine}\n${content}\n\n${trimmed}\n` : `${headingLine}\n${content}\n`;
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      endIndex = i;
      break;
    }
  }

  const newLines = [
    ...lines.slice(0, startIndex + 1),
    content,
    '',
    ...lines.slice(endIndex),
  ];
  return newLines.join('\n');
}

function readSection(markdown: string, heading: string): string {
  const lines = (markdown || '').split('\n');
  const headingLine = `## ${heading}`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine);
  if (startIndex === -1) return '';
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      endIndex = i;
      break;
    }
  }
  const contentLines = lines.slice(startIndex + 1, endIndex);
  // trim leading/trailing empty lines
  while (contentLines.length && !contentLines[0].trim()) contentLines.shift();
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) contentLines.pop();
  return contentLines.join('\n');
}

function writeSection(markdown: string, heading: string, content: string): string {
  const normalized = content.trim() ? content : '- ';
  return upsertSection(markdown, heading, normalized);
}

function defaultWoId() {
  const year = new Date().getFullYear();
  const suffix = String(Date.now()).slice(-4);
  return `WO-${year}-${suffix}`;
}

const DEFAULT_BODY_TEMPLATE = `## Summary
- 

## Acceptance / checks
- 

## Versions used during testing

| Component | Version |
|---|---|
|  |  |

## Implementation notes
- 

## Dev log (history)
- ${new Date().toISOString().slice(0, 10)}: 

## Risks and mitigations
- Risk:
  - 
- Mitigation:
  - 

## Rollback considerations
- 
`;

const DEFAULT_SECTION_HEADINGS = extractHeadings(DEFAULT_BODY_TEMPLATE);

const typeOptions = ['project', 'cds', 'hotfix', 'maintenance'] as const;
const statusOptions = ['draft', 'in_progress', 'ready_for_release', 'released', 'cancelled'] as const;
const riskOptions = ['low', 'medium', 'high'] as const;

function ChipsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className='flex flex-wrap items-center gap-1 rounded-md border px-2 py-1'>
      {value.map((item) => (
        <span key={item} className='flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
          {item}
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground'
            onClick={() => onChange(value.filter((v) => v !== item))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className='h-6 flex-1 bg-transparent text-xs outline-none'
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.currentTarget.value.trim();
            if (input) {
              onChange([...value, input]);
              event.currentTarget.value = '';
            }
          } else if (event.key === 'Backspace' && event.currentTarget.value === '') {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

export default function WorkOrderEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const previewRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const [woId, setWoId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('project');
  const [status, setStatus] = useState<string>('draft');
  const [risk, setRisk] = useState<string>('medium');
  const [owner, setOwner] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [tenantsImpacted, setTenantsImpacted] = useState<string[]>([]);
  const [targetEnvs, setTargetEnvs] = useState<string[]>([]);
  const [postmanTestingRef, setPostmanTestingRef] = useState('');
  const [services, setServices] = useState<ServiceTouchedItem[]>([]);
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [sha, setSha] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState('');
  const [tab, setTab] = useState<'overview' | 'services' | 'content' | 'preview' | 'diff' | 'pr'>('overview');
  const [overviewView, setOverviewView] = useState<'form' | 'markdown'>('form');
  const [servicesView, setServicesView] = useState<'form' | 'markdown'>('form');
  const [contentView, setContentView] = useState<'form' | 'markdown'>('form');
  const [overviewDraft, setOverviewDraft] = useState('');
  const [servicesDraft, setServicesDraft] = useState('');

  const [localDraftStatus, setLocalDraftStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastLocalSavedAt, setLastLocalSavedAt] = useState<number | null>(null);
  const isNew = id === 'new';
  const localDraftKey = useMemo(() => `wo:draft:${isNew ? 'new' : id}`, [id, isNew]);

  useEffect(() => {
    if (!accessToken) return;
    if (isNew) {
      setWoId(defaultWoId());
      setTitle('');
      setServices([]);
      setType('project');
      setStatus('draft');
      setRisk('medium');
      setOwner('');
      setRequestedBy('');
      setTenantsImpacted([]);
      setTargetEnvs([]);
      setPostmanTestingRef('');
      setBodyMarkdown(DEFAULT_BODY_TEMPLATE);
      setLoading(false);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const response = await api.get<WorkOrderOut>(`/work-orders/${id}`, accessToken);
        setWoId(response.wo_id);
        setTitle(response.parsed.title);
        setType(response.parsed.type || 'project');
        setStatus(response.parsed.status || 'draft');
        setRisk(response.parsed.risk || 'medium');
        setOwner(response.parsed.owner || '');
        setRequestedBy(response.parsed.requested_by || '');
        setTenantsImpacted(response.parsed.tenants_impacted || []);
        setTargetEnvs(response.parsed.target_envs || []);
        setPostmanTestingRef(response.parsed.postman_testing_ref || '');
        setServices(response.parsed.services_touched);
        setBodyMarkdown(response.parsed.body_markdown);
        setSha(response.sha || null);
        setBranch(response.branch || null);
        setPrUrl(response.pr_url || null);
        setLastSavedMarkdown(response.raw_markdown);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [accessToken, id, isNew]);

  const previewMarkdown = useMemo(
    () =>
      buildMarkdown({
        wo_id: woId,
        title,
        type,
        status,
        owner,
        requested_by: requestedBy,
        tenants_impacted: tenantsImpacted,
        risk,
        target_envs: targetEnvs,
        postman_testing_ref: postmanTestingRef,
        services,
        body: bodyMarkdown,
      }),
    [woId, title, type, status, owner, requestedBy, tenantsImpacted, risk, targetEnvs, postmanTestingRef, services, bodyMarkdown],
  );

  const headings = useMemo(() => extractHeadings(bodyMarkdown), [bodyMarkdown]);
  const missingSections = useMemo(
    () => DEFAULT_SECTION_HEADINGS.filter((heading) => !headings.includes(heading)),
    [headings],
  );

  // Keep YAML views in sync with form state.
  const overviewGenerated = useMemo(
    () =>
      buildOverviewYaml({
        wo_id: woId,
        title,
        type,
        status,
        risk,
        owner,
        requested_by: requestedBy,
        tenants_impacted: tenantsImpacted,
        target_envs: targetEnvs,
        postman_testing_ref: postmanTestingRef,
      }),
    [owner, postmanTestingRef, requestedBy, risk, status, targetEnvs, tenantsImpacted, title, type, woId],
  );

  const servicesGenerated = useMemo(() => buildServicesYaml(services), [services]);

  useEffect(() => {
    if (overviewView !== 'markdown') return;
    setOverviewDraft(overviewGenerated);
  }, [overviewGenerated, overviewView]);

  useEffect(() => {
    if (servicesView !== 'markdown') return;
    setServicesDraft(servicesGenerated);
  }, [servicesGenerated, servicesView]);

  // Local draft: restore on load, autosave 5s after changes.
  useEffect(() => {
    if (loading) return;
    try {
      const raw = window.localStorage.getItem(localDraftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object') return;
      // Basic restore (best-effort)
      if (typeof parsed.woId === 'string') setWoId(parsed.woId);
      if (typeof parsed.title === 'string') setTitle(parsed.title);
      if (typeof parsed.type === 'string') setType(parsed.type);
      if (typeof parsed.status === 'string') setStatus(parsed.status);
      if (typeof parsed.risk === 'string') setRisk(parsed.risk);
      if (typeof parsed.owner === 'string') setOwner(parsed.owner);
      if (typeof parsed.requestedBy === 'string') setRequestedBy(parsed.requestedBy);
      if (Array.isArray(parsed.tenantsImpacted)) setTenantsImpacted(parsed.tenantsImpacted);
      if (Array.isArray(parsed.targetEnvs)) setTargetEnvs(parsed.targetEnvs);
      if (typeof parsed.postmanTestingRef === 'string') setPostmanTestingRef(parsed.postmanTestingRef);
      if (Array.isArray(parsed.services)) setServices(parsed.services);
      if (typeof parsed.bodyMarkdown === 'string') setBodyMarkdown(parsed.bodyMarkdown);
      if (typeof parsed.updatedAt === 'number') setLastLocalSavedAt(parsed.updatedAt);
      setLocalDraftStatus('saved');
    } catch {
      // ignore
    }
    // only once per key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDraftKey, loading]);

  useEffect(() => {
    if (loading) return;
    setLocalDraftStatus('saving');
    const handle = window.setTimeout(() => {
      try {
        const payload = {
          version: 1,
          updatedAt: Date.now(),
          woId,
          title,
          type,
          status,
          risk,
          owner,
          requestedBy,
          tenantsImpacted,
          targetEnvs,
          postmanTestingRef,
          services,
          bodyMarkdown,
        };
        window.localStorage.setItem(localDraftKey, JSON.stringify(payload));
        setLastLocalSavedAt(payload.updatedAt);
        setLocalDraftStatus('saved');
      } catch {
        setLocalDraftStatus('idle');
      }
    }, 5000);
    return () => window.clearTimeout(handle);
  }, [
    bodyMarkdown,
    loading,
    localDraftKey,
    owner,
    postmanTestingRef,
    requestedBy,
    risk,
    services,
    status,
    targetEnvs,
    tenantsImpacted,
    title,
    type,
    woId,
  ]);

  const applyOverviewDraftToForm = () => {
    const parsed = parseOverviewYaml(overviewDraft);
    if (parsed.wo_id && isNew) setWoId(parsed.wo_id);
    if (typeof parsed.title === 'string') setTitle(parsed.title);
    if (parsed.type) setType(parsed.type);
    if (parsed.status) setStatus(parsed.status);
    if (parsed.risk) setRisk(parsed.risk);
    if (typeof parsed.owner === 'string') setOwner(parsed.owner);
    if (typeof parsed.requested_by === 'string') setRequestedBy(parsed.requested_by);
    if (parsed.tenants_impacted) setTenantsImpacted(parsed.tenants_impacted);
    if (parsed.target_envs) setTargetEnvs(parsed.target_envs);
    if (typeof parsed.postman_testing_ref === 'string') setPostmanTestingRef(parsed.postman_testing_ref);
  };

  const applyServicesDraftToForm = () => {
    const parsed = parseServicesYaml(servicesDraft);
    setServices(parsed);
  };

  const applySummaryAssist = () => {
    setTab('content');
    setContentView('form');
    const serviceLines =
      services.length > 0
        ? services.map((service) => {
            const label = service.service_id || service.repo || 'service';
            const change = service.change_type ? ` (${service.change_type})` : '';
            return `- ${label}${change}`;
          })
        : ['- Summary pending'];
    const riskLine = risk ? `- Risk: ${risk}` : null;
    const summaryContent = [...serviceLines, riskLine].filter(Boolean).join('\n');
    setBodyMarkdown((prev) => upsertSection(prev, 'Summary', summaryContent));
  };

  const insertMissingSections = () => {
    setTab('content');
    setContentView('form');
    if (missingSections.length === 0) return;
    setBodyMarkdown((prev) => {
      const trimmed = prev.trim();
      const additions = missingSections.map((section) => `## ${section}\n- `).join('\n\n');
      return trimmed ? `${trimmed}\n\n${additions}\n` : `${additions}\n`;
    });
  };

  const jumpToHeadingInPreview = (headingText: string) => {
    setTab('preview');
    setTimeout(() => {
      const root = previewRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll('h2, h3'));
      const match = nodes.find((node) => (node.textContent || '').trim() === headingText.trim());
      match?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const save = async (overrideSha?: string | null) => {
    if (!accessToken || !canWrite) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    const payload = {
      wo_id: woId,
      title,
      type,
      status,
      owner,
      requested_by: requestedBy,
      tenants_impacted: tenantsImpacted,
      risk,
      target_envs: targetEnvs,
      postman_testing_ref: postmanTestingRef,
      services_touched: services,
      body_markdown: bodyMarkdown,
      sha: overrideSha ?? sha ?? undefined,
      branch: branch || undefined,
    };
    try {
      const response = isNew
        ? await api.post<WorkOrderOut>('/work-orders', payload, accessToken)
        : await api.put<WorkOrderOut>(`/work-orders/${woId}`, payload, accessToken);
      setSha(response.sha || null);
      setBranch(response.branch || null);
      setPrUrl(response.pr_url || null);
      setLastSavedMarkdown(response.raw_markdown);
      if (isNew) {
        router.replace(`/work-orders/${response.wo_id}`);
      }
      try {
        window.localStorage.removeItem(localDraftKey);
      } catch {
        // ignore
      }
      setLocalDraftStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save work order';
      if (message.includes('409') || message.toLowerCase().includes('conflict')) {
        setConflict('This work order was updated remotely. Reload the latest version or force overwrite.');
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const reloadLatest = async () => {
    if (!accessToken || !woId) return;
    try {
      const response = await api.get<WorkOrderOut>(`/work-orders/${woId}?ref=${branch ?? ''}`, accessToken);
      setTitle(response.parsed.title);
      setServices(response.parsed.services_touched);
      setBodyMarkdown(response.parsed.body_markdown);
      setSha(response.sha || null);
      setLastSavedMarkdown(response.raw_markdown);
      setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload latest work order');
    }
  };

  const forceOverwrite = async () => {
    if (!accessToken || !woId) return;
    try {
      const response = await api.get<WorkOrderOut>(`/work-orders/${woId}?ref=${branch ?? ''}`, accessToken);
      const latestSha = response.sha || null;
      setSha(latestSha);
      await save(latestSha);
      setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to force overwrite');
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
      if (event.key === 'F6') {
        event.preventDefault();
        const targets = ['wo-title', 'wo-service-first', 'wo-editor-content', 'wo-preview-tab'];
        const activeId = (document.activeElement as HTMLElement | null)?.id;
        const idx = Math.max(0, targets.indexOf(activeId || ''));
        const nextId = targets[(idx + 1) % targets.length];
        const nextEl = document.getElementById(nextId);
        if (nextEl) nextEl.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  if (loading) return <LoadingState label='Loading work order...' />;
  if (!canWrite && isNew) {
    return <EmptyState title='Access denied' description='You do not have permission to create work orders.' />;
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]'>
      <div className='space-y-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-semibold'>{isNew ? 'New work order' : woId}</h2>
            <div className='mt-2 flex flex-wrap items-center gap-2'>
              <StatusChip status={status} />
              <span className='rounded-md border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground'>{type}</span>
              <RiskChip risk={risk} />
              <span className='text-xs text-muted-foreground'>Ctrl+S to save · / for sections</span>
            </div>
          </div>
          <div className='flex items-center gap-2'>
          <div className='hidden text-xs text-muted-foreground sm:block'>
            {localDraftStatus === 'saving'
              ? 'Saving locally…'
              : localDraftStatus === 'saved' && lastLocalSavedAt
                ? `Saved locally ${new Date(lastLocalSavedAt).toLocaleTimeString()}`
                : null}
          </div>
            {prUrl && (
              <Button variant='outline' asChild>
                <a href={prUrl} target='_blank' rel='noreferrer'>
                  Open PR
                </a>
              </Button>
            )}
            <Button onClick={save} disabled={saving || !canWrite}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {error && <p className='text-sm text-destructive'>{error}</p>}
        {conflict && (
          <Card className='border-amber-200 bg-amber-50/40'>
            <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-amber-900'>
              <span>{conflict}</span>
              <div className='flex gap-2'>
                <Button type='button' variant='outline' onClick={reloadLatest}>
                  Reload latest
                </Button>
                <Button type='button' variant='secondary' onClick={forceOverwrite}>
                  Force overwrite
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList className='grid w-full grid-cols-3 md:grid-cols-6'>
            <TabsTrigger value='overview' id='wo-overview-tab'>
              Overview
            </TabsTrigger>
            <TabsTrigger value='services'>Services</TabsTrigger>
            <TabsTrigger value='content'>Content</TabsTrigger>
            <TabsTrigger value='preview' id='wo-preview-tab'>
              Preview
            </TabsTrigger>
            <TabsTrigger value='diff'>Diff</TabsTrigger>
            <TabsTrigger value='pr'>PR</TabsTrigger>
          </TabsList>

          <TabsContent value='overview'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between gap-3'>
                <CardTitle className='text-base'>Overview</CardTitle>
                <div className='flex items-center gap-1 rounded-md border bg-white p-1'>
                  <Button
                    type='button'
                    size='sm'
                    variant={overviewView === 'form' ? 'secondary' : 'ghost'}
                    onClick={() => {
                      setOverviewView('form');
                    }}
                    className='h-8 px-2'
                  >
                    Form
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={overviewView === 'markdown' ? 'secondary' : 'ghost'}
                    onClick={() => setOverviewView('markdown')}
                    className='h-8 px-2'
                  >
                    Markdown
                  </Button>
                </div>
              </CardHeader>
              <CardContent className='grid gap-4 md:grid-cols-3'>
                {overviewView === 'form' ? (
                  <>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>WO ID</label>
                      <Input
                        id='wo-title'
                        value={woId}
                        disabled={!isNew}
                        onChange={(event) => setWoId(event.target.value)}
                      />
                    </div>
                    <div className='space-y-2 md:col-span-2'>
                      <label className='text-xs text-muted-foreground'>Title</label>
                      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder='Short WO title' />
                    </div>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>Type</label>
                      <select
                        className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                        value={type}
                        onChange={(event) => setType(event.target.value)}
                      >
                        {typeOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>Status</label>
                      <select
                        className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                      >
                        {statusOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>Risk</label>
                      <select
                        className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                        value={risk}
                        onChange={(event) => setRisk(event.target.value)}
                      >
                        {riskOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>Owner</label>
                      <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder='Team / unit' />
                    </div>
                    <div className='space-y-2'>
                      <label className='text-xs text-muted-foreground'>Requested by</label>
                      <Input
                        value={requestedBy}
                        onChange={(event) => setRequestedBy(event.target.value)}
                        placeholder='Client / internal'
                      />
                    </div>
                    <div className='space-y-2 md:col-span-3'>
                      <label className='text-xs text-muted-foreground'>Tenants impacted</label>
                      <ChipsInput value={tenantsImpacted} onChange={setTenantsImpacted} placeholder='mks, ro, ...' />
                    </div>
                    <div className='space-y-2 md:col-span-3'>
                      <label className='text-xs text-muted-foreground'>Target envs</label>
                      <ChipsInput value={targetEnvs} onChange={setTargetEnvs} placeholder='uat-ro, live-ro, ...' />
                    </div>
                    <div className='space-y-2 md:col-span-3'>
                      <label className='text-xs text-muted-foreground'>Postman testing ref</label>
                      <Input
                        value={postmanTestingRef}
                        onChange={(event) => setPostmanTestingRef(event.target.value)}
                        placeholder='https://...'
                      />
                    </div>
                  </>
                ) : (
                  <div className='space-y-2 md:col-span-3'>
                    <p className='text-xs text-muted-foreground'>YAML preview (generated from the current form).</p>
                    <Textarea
                      value={overviewDraft}
                      readOnly
                      rows={14}
                      className='font-mono text-xs'
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='services'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between gap-3'>
                <CardTitle className='text-base'>Services touched</CardTitle>
                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    size='icon'
                    variant='outline'
                    className='h-9 w-9'
                    onClick={() =>
                      setServices((prev) => [
                        ...prev,
                        {
                          service_id: '',
                          repo: '',
                          change_type: '',
                          requires_deploy: false,
                          requires_db_migration: false,
                          requires_config_change: false,
                          feature_flags: [],
                          release_notes_ref: '',
                        },
                      ])
                    }
                    aria-label='Add service row'
                    title='Add row'
                  >
                    <Plus className='h-4 w-4' />
                  </Button>
                  <div className='flex items-center gap-1 rounded-md border bg-white p-1'>
                    <Button
                      type='button'
                      size='sm'
                      variant={servicesView === 'form' ? 'secondary' : 'ghost'}
                      onClick={() => setServicesView('form')}
                      className='h-8 px-2'
                    >
                      Form
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant={servicesView === 'markdown' ? 'secondary' : 'ghost'}
                      onClick={() => setServicesView('markdown')}
                      className='h-8 px-2'
                    >
                      Markdown
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {servicesView === 'form' ? (
                  <div className='space-y-2'>
                    <ServicesTouchedGrid items={services} onChange={setServices} firstInputId='wo-service-first' hideHeader />
                  </div>
                ) : (
                  <div className='space-y-2'>
                    <p className='text-xs text-muted-foreground'>YAML preview (generated from the current grid).</p>
                    <Textarea
                      value={servicesDraft}
                      readOnly
                      rows={16}
                      className='font-mono text-xs'
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='content'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between gap-3'>
                <CardTitle className='text-base'>Work order content</CardTitle>
                <div className='flex items-center gap-1 rounded-md border bg-white p-1'>
                  <Button
                    type='button'
                    size='sm'
                    variant={contentView === 'form' ? 'secondary' : 'ghost'}
                    onClick={() => setContentView('form')}
                  >
                    Form
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant={contentView === 'markdown' ? 'secondary' : 'ghost'}
                    onClick={() => setContentView('markdown')}
                  >
                    Markdown
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {contentView === 'form' ? (
                  <div className='grid gap-4'>
                    {[
                      { heading: 'Summary', placeholder: '- ' },
                      { heading: 'Acceptance / checks', placeholder: '- ' },
                      { heading: 'Versions used during testing', placeholder: '| Component | Version |\n|---|---|\n|  |  |' },
                      { heading: 'Implementation notes', placeholder: '- ' },
                      { heading: 'Risks and mitigations', placeholder: '- Risk:\n  - \n- Mitigation:\n  - ' },
                      { heading: 'Rollback considerations', placeholder: '- ' },
                    ].map((section) => (
                      <div key={section.heading} className='space-y-2'>
                        <p className='text-sm font-medium'>{section.heading}</p>
                        <Textarea
                          value={readSection(bodyMarkdown, section.heading) || section.placeholder}
                          onChange={(e) =>
                            setBodyMarkdown((prev) => writeSection(prev, section.heading, e.target.value))
                          }
                          rows={section.heading === 'Versions used during testing' ? 6 : 4}
                          className='text-sm'
                        />
                      </div>
                    ))}
                    {missingSections.length > 0 ? (
                      <div className='rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground'>
                        Missing sections: {missingSections.slice(0, 6).join(', ')}
                        {missingSections.length > 6 ? '…' : ''}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <LexicalMarkdownEditor
                    value={bodyMarkdown}
                    onChange={setBodyMarkdown}
                    contentEditableId='wo-editor-content'
                    placeholder='Write the work order here… Use / to insert sections.'
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='preview'>
            <Card>
              <CardContent className='pt-4'>
                {(() => {
                  const { frontMatter, body } = splitFrontMatter(previewMarkdown);
                  return (
                    <div className='space-y-4'>
                      {frontMatter ? (
                        <div>
                          <p className='text-xs font-medium text-muted-foreground'>YAML</p>
                          <pre className='mt-2 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed'>
                            {frontMatter.split('\n').map((line, idx) => (
                              <div key={idx} className='whitespace-pre'>
                                {renderYamlLikeLine(line)}
                              </div>
                            ))}
                          </pre>
                        </div>
                      ) : null}
                      <div ref={previewRef}>
                        <MarkdownRenderer content={body || previewMarkdown} />
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='diff'>
            <Card>
              <CardContent className='pt-4'>
                <p className='text-xs text-muted-foreground'>Unified diff</p>
                <pre className='mt-2 max-h-[520px] overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed'>
                  {diffLines(lastSavedMarkdown || '', previewMarkdown || '').map((op, idx) => {
                    const prefix = op.type === 'insert' ? '+' : op.type === 'delete' ? '-' : ' ';
                    const rowClass =
                      op.type === 'insert'
                        ? 'bg-emerald-500/10'
                        : op.type === 'delete'
                          ? 'bg-red-500/10'
                          : '';
                    return (
                      <div key={idx} className={cn('whitespace-pre px-1', rowClass)}>
                        <span className='mr-2 inline-block w-4 text-muted-foreground'>{prefix}</span>
                        {renderYamlLikeLine(op.line)}
                      </div>
                    );
                  })}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='pr'>
            <Card>
              <CardContent className='pt-4 text-sm'>
                {prUrl ? (
                  <a className='text-primary underline' href={prUrl} target='_blank' rel='noreferrer'>
                    {prUrl}
                  </a>
                ) : (
                  <p className='text-muted-foreground'>No PR yet. Press Ctrl+S or Save to create one.</p>
                )}
                {branch && <p className='mt-2 text-xs text-muted-foreground'>Branch: {branch}</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <div className='hidden lg:block'>
        <div className='sticky top-20 space-y-3'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>AI assist (beta)</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-xs text-muted-foreground'>
              <p>Generate quick summaries and fill missing sections.</p>
              <Button type='button' size='sm' variant='outline' className='w-full' onClick={applySummaryAssist}>
                Draft summary from services
              </Button>
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='w-full'
                onClick={insertMissingSections}
                disabled={missingSections.length === 0}
              >
                Insert missing sections
              </Button>
              {missingSections.length > 0 ? (
                <p className='text-[11px] text-muted-foreground'>
                  Missing: {missingSections.slice(0, 3).join(', ')}
                  {missingSections.length > 3 ? '…' : ''}
                </p>
              ) : (
                <p className='text-[11px] text-muted-foreground'>No missing sections detected.</p>
              )}
            </CardContent>
          </Card>

          {headings.length > 0 && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>Sections</CardTitle>
              </CardHeader>
              <CardContent className='space-y-1'>
                {headings.slice(0, 12).map((heading) => (
                  <Button
                    key={heading}
                    type='button'
                    variant='ghost'
                    className='h-8 w-full justify-start truncate text-xs'
                    onClick={() => jumpToHeadingInPreview(heading)}
                  >
                    {heading}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
