'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

type ControlStatus = {
  control_key: string;
  status_enum: string;
  score: number;
  notes?: string | null;
  owner_user_id?: string | null;
  last_reviewed_at?: string | null;
  na_reason?: string | null;
};

type EvidenceItem = {
  id: string;
  control_key: string;
  type: 'link' | 'text';
  title: string;
  url?: string | null;
  text?: string | null;
  tags?: string[];
  owner_user_id?: string | null;
  created_at: string;
  expires_at?: string | null;
};

type ControlDetail = {
  control: {
    control_key: string;
    code: string;
    title: string;
    description: string;
    domain_code: string;
    criticality: string;
    weight: number;
    evidence_expected: string;
    default_status: string;
    default_score: number;
  };
  status?: ControlStatus | null;
  evidence: EvidenceItem[];
  framework_refs: Array<{
    framework_key: string;
    framework_name: string;
    ref: string;
    note?: string | null;
  }>;
};

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'partial', label: 'Partial' },
  { value: 'mostly', label: 'Mostly' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'na', label: 'N/A' },
];

export function ControlDrawer({
  open,
  onOpenChange,
  controlKey,
  accessToken,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controlKey: string | null;
  accessToken: string | null;
  onUpdated?: () => void;
}) {
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('not_started');
  const [notes, setNotes] = useState('');
  const [naReason, setNaReason] = useState('');
  const [evType, setEvType] = useState<'link' | 'text'>('link');
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evText, setEvText] = useState('');
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  const statusLabel = useMemo(
    () => STATUS_OPTIONS.find((opt) => opt.value === status)?.label ?? status,
    [status],
  );

  useEffect(() => {
    if (!open || !controlKey || !accessToken) return;
    let isMounted = true;
    setLoading(true);
    setError(null);
    api
      .get<ControlDetail>(`/compliance/controls/${controlKey}`, accessToken)
      .then((data) => {
        if (!isMounted) return;
        setDetail(data);
        const statusEnum = data.status?.status_enum ?? data.control.default_status ?? 'not_started';
        setStatus(statusEnum);
        setNotes(data.status?.notes ?? '');
        setNaReason(data.status?.na_reason ?? '');
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load control details');
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [open, controlKey, accessToken]);

  const saveStatus = async () => {
    if (!accessToken || !controlKey) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        status_enum: status,
        notes: notes.trim() || null,
        na_reason: status === 'na' ? naReason.trim() || null : null,
      };
      const updated = await api.put<ControlStatus>(
        `/compliance/controls/${controlKey}/status`,
        payload,
        accessToken,
      );
      setDetail((prev) => (prev ? { ...prev, status: updated } : prev));
      onUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const addEvidence = async () => {
    if (!accessToken || !controlKey) return;
    setEvSaving(true);
    setEvError(null);
    try {
      const payload = {
        type: evType,
        title: evTitle.trim(),
        url: evType === 'link' ? evUrl.trim() || null : null,
        text: evType === 'text' ? evText.trim() || null : null,
        tags: [],
      };
      const created = await api.post<EvidenceItem>(`/compliance/controls/${controlKey}/evidence`, payload, accessToken);
      setDetail((prev) => (prev ? { ...prev, evidence: [created, ...prev.evidence] } : prev));
      setEvTitle('');
      setEvUrl('');
      setEvText('');
      onUpdated?.();
    } catch (err) {
      setEvError(err instanceof Error ? err.message : 'Failed to add evidence');
    } finally {
      setEvSaving(false);
    }
  };

  const deleteEvidence = async (id: string) => {
    if (!accessToken) return;
    setEvError(null);
    try {
      await api.delete(`/compliance/evidence/${id}`, accessToken);
      setDetail((prev) => (prev ? { ...prev, evidence: prev.evidence.filter((item) => item.id !== id) } : prev));
      onUpdated?.();
    } catch (err) {
      setEvError(err instanceof Error ? err.message : 'Failed to delete evidence');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='flex h-full w-full max-w-2xl flex-col'>
        <SheetHeader>
          <SheetTitle>{detail?.control.title ?? 'Control details'}</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className='mt-6 text-sm text-muted-foreground'>Loading control details...</div>
        ) : error ? (
          <div className='mt-6 text-sm text-red-600'>{error}</div>
        ) : detail ? (
          <div className='mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6'>
            <div className='space-y-2'>
              <div className='text-xs text-muted-foreground'>Code</div>
              <div className='text-sm font-medium'>{detail.control.code}</div>
              <p className='text-sm text-muted-foreground'>{detail.control.description}</p>
            </div>

            <div className='space-y-3 rounded-lg border bg-muted/20 p-4'>
              <div>
                <div className='text-xs text-muted-foreground'>Status</div>
                <div className='text-sm font-medium'>{statusLabel}</div>
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>Status</Label>
                  <select
                    className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {status === 'na' && (
                  <div className='space-y-2'>
                    <Label>NA reason</Label>
                    <Input value={naReason} onChange={(e) => setNaReason(e.target.value)} placeholder='Reason' />
                  </div>
                )}
              </div>
              <div className='space-y-2'>
                <Label>Notes</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button type='button' onClick={saveStatus} disabled={saving}>
                {saving ? 'Saving...' : 'Save status'}
              </Button>
            </div>

            <div className='space-y-3'>
              <div className='text-sm font-semibold'>Evidence</div>
              {detail.evidence.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No evidence added yet.</p>
              ) : (
                <div className='space-y-3'>
                  {detail.evidence.map((item) => (
                    <div key={item.id} className='rounded-lg border p-3'>
                      <div className='flex items-center justify-between gap-2'>
                        <div>
                          <p className='text-sm font-medium'>{item.title}</p>
                          <p className='text-xs text-muted-foreground capitalize'>{item.type}</p>
                        </div>
                        <Button type='button' variant='outline' size='sm' onClick={() => deleteEvidence(item.id)}>
                          Delete
                        </Button>
                      </div>
                      {item.type === 'link' && item.url ? (
                        <a
                          className='mt-2 block truncate text-sm text-primary underline'
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {item.url}
                        </a>
                      ) : null}
                      {item.type === 'text' && item.text ? (
                        <p className='mt-2 text-sm text-muted-foreground'>{item.text}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {evError ? <p className='text-sm text-red-600'>{evError}</p> : null}
              <div className='rounded-lg border bg-muted/10 p-4'>
                <div className='grid gap-3'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='space-y-2'>
                      <Label>Type</Label>
                      <select
                        className='h-10 w-full rounded-md border border-input bg-white px-3 text-sm'
                        value={evType}
                        onChange={(e) => setEvType(e.target.value as 'link' | 'text')}
                      >
                        <option value='link'>Link</option>
                        <option value='text'>Text</option>
                      </select>
                    </div>
                    <div className='space-y-2'>
                      <Label>Title</Label>
                      <Input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
                    </div>
                  </div>
                  {evType === 'link' ? (
                    <div className='space-y-2'>
                      <Label>URL</Label>
                      <Input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder='https://...' />
                    </div>
                  ) : (
                    <div className='space-y-2'>
                      <Label>Text</Label>
                      <Textarea rows={3} value={evText} onChange={(e) => setEvText(e.target.value)} />
                    </div>
                  )}
                  <Button type='button' variant='outline' onClick={addEvidence} disabled={evSaving || !evTitle.trim()}>
                    {evSaving ? 'Adding...' : 'Add evidence'}
                  </Button>
                </div>
              </div>
            </div>

            <div className='space-y-2 rounded-lg border bg-muted/10 p-4'>
              <div className='text-sm font-semibold'>Evidence expectations</div>
              <p className='text-sm text-muted-foreground'>{detail.control.evidence_expected}</p>
            </div>

            {detail.framework_refs.length > 0 ? (
              <div className='space-y-2'>
                <div className='text-sm font-semibold'>Framework references</div>
                <ul className='space-y-2 text-sm text-muted-foreground'>
                  {detail.framework_refs.map((ref) => (
                    <li key={`${ref.framework_key}-${ref.ref}`}>
                      <span className='font-medium text-foreground'>{ref.framework_name}</span>: {ref.ref}
                      {ref.note ? ` — ${ref.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className='mt-6 text-sm text-muted-foreground'>Select a control to view details.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
