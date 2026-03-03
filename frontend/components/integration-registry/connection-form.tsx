'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { api } from '@/lib/api';
import type {
  IrDictionary,
  IrDictionaryItem,
  IrEndpoint,
  IrInstance,
  IrRouteHop,
  IrServiceListItem,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SingleSelect, type SelectOption } from '@/components/inputs/single-select';

interface EndpointDraft {
  fqdn: string;
  ip: string;
  port: string;
  protocol: string;
  base_path: string;
  is_public: boolean;
  is_primary: boolean;
}

interface RouteDraft {
  direction: string;
  hop_order: string;
  label: string;
  proxy_chain: string;
  notes: string;
}

interface FormData {
  service_id: string;
  env: string;
  datacenter: string;
  network_zone: string;
  status: string;
  contact: string;
  vault_ref: string;
  notes: string;
  change_reason: string;
  auth_method: string;
  timeout_ms: string;
  retry_count: string;
  endpoints: EndpointDraft[];
  route_hops: RouteDraft[];
}

const EMPTY_ENDPOINT: EndpointDraft = {
  fqdn: '',
  ip: '',
  port: '',
  protocol: 'HTTPS',
  base_path: '',
  is_public: false,
  is_primary: false,
};

const EMPTY_HOP: RouteDraft = {
  direction: 'outbound',
  hop_order: '0',
  label: '',
  proxy_chain: '',
  notes: '',
};

function buildFormFromInstance(instance: IrInstance): FormData {
  const settings = instance.type_settings_json || {};
  return {
    service_id: instance.service_id,
    env: instance.env,
    datacenter: instance.datacenter || '',
    network_zone: instance.network_zone || '',
    status: instance.status,
    contact: instance.contact || '',
    vault_ref: instance.vault_ref || '',
    notes: instance.notes || '',
    change_reason: '',
    auth_method: (settings['auth_method'] as string) || '',
    timeout_ms: (settings['timeout_ms'] as string) || '',
    retry_count: (settings['retry_count'] as string) || '',
    endpoints: (instance.endpoints || []).map((ep) => ({
      fqdn: ep.fqdn || '',
      ip: ep.ip || '',
      port: ep.port?.toString() || '',
      protocol: ep.protocol || 'HTTPS',
      base_path: ep.base_path || '',
      is_public: ep.is_public,
      is_primary: ep.is_primary,
    })),
    route_hops: (instance.route_hops || []).map((rh) => ({
      direction: rh.direction,
      hop_order: rh.hop_order?.toString() || '0',
      label: rh.label || '',
      proxy_chain: rh.proxy_chain || '',
      notes: rh.notes || '',
    })),
  };
}

const EMPTY_FORM: FormData = {
  service_id: '',
  env: '',
  datacenter: '',
  network_zone: '',
  status: 'draft',
  contact: '',
  vault_ref: '',
  notes: '',
  change_reason: '',
  auth_method: '',
  timeout_ms: '',
  retry_count: '',
  endpoints: [{ ...EMPTY_ENDPOINT, is_primary: true }],
  route_hops: [],
};

interface ConnectionFormProps {
  accessToken: string;
  instance?: IrInstance | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function ConnectionForm({ accessToken, instance, onSaved, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<FormData>(
    instance ? buildFormFromInstance(instance) : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookup data
  const [services, setServices] = useState<IrServiceListItem[]>([]);
  const [dictItems, setDictItems] = useState<Record<string, IrDictionaryItem[]>>({});
  const [dictMeta, setDictMeta] = useState<Record<string, IrDictionary>>({});

  const loadDictItems = useCallback(
    async (key: string) => {
      if (dictItems[key]) return;
      try {
        const items = await api.get<IrDictionaryItem[]>(
          `/integration-registry/dictionaries/${key}/items`,
          accessToken,
        );
        setDictItems((prev) => ({ ...prev, [key]: items }));
      } catch {}
    },
    [accessToken, dictItems],
  );

  useEffect(() => {
    // Load services + dictionaries needed for the form
    api
      .get<IrServiceListItem[]>('/integration-registry/services', accessToken)
      .then(setServices)
      .catch(() => {});

    api
      .get<IrDictionary[]>('/integration-registry/dictionaries', accessToken)
      .then((dicts) => {
        const meta: Record<string, IrDictionary> = {};
        dicts.forEach((d) => { meta[d.key] = d; });
        setDictMeta(meta);
      })
      .catch(() => {});

    // Pre-load commonly used dicts
    ['environment', 'datacenter', 'network_zone', 'auth_method'].forEach((k) => loadDictItems(k));
  }, [accessToken, loadDictItems]);

  const dictOptions = (key: string): SelectOption[] =>
    (dictItems[key] || [])
      .filter((i) => i.is_active)
      .map((i) => ({ value: i.code, label: i.label }));

  const handleAddDictItem = async (key: string, label: string, onCreated: (code: string) => void) => {
    const code = label.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 30);
    try {
      const created = await api.post<IrDictionaryItem>(
        `/integration-registry/dictionaries/${key}/items`,
        { code, label },
        accessToken,
      );
      setDictItems((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), created],
      }));
      onCreated(created.code);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add item');
    }
  };

  const setField = (key: keyof FormData, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setEndpoint = (idx: number, key: keyof EndpointDraft, value: unknown) =>
    setForm((f) => {
      const endpoints = [...f.endpoints];
      endpoints[idx] = { ...endpoints[idx], [key]: value };
      return { ...f, endpoints };
    });

  const addEndpoint = () =>
    setForm((f) => ({ ...f, endpoints: [...f.endpoints, { ...EMPTY_ENDPOINT }] }));

  const removeEndpoint = (idx: number) =>
    setForm((f) => ({ ...f, endpoints: f.endpoints.filter((_, i) => i !== idx) }));

  const setHop = (idx: number, key: keyof RouteDraft, value: string) =>
    setForm((f) => {
      const route_hops = [...f.route_hops];
      route_hops[idx] = { ...route_hops[idx], [key]: value };
      return { ...f, route_hops };
    });

  const addHop = () =>
    setForm((f) => ({ ...f, route_hops: [...f.route_hops, { ...EMPTY_HOP }] }));

  const removeHop = (idx: number) =>
    setForm((f) => ({ ...f, route_hops: f.route_hops.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    setError(null);
    if (!form.change_reason.trim()) {
      setError('Change reason is required');
      return;
    }
    if (!form.service_id) {
      setError('Service is required');
      return;
    }
    if (!form.env) {
      setError('Environment is required');
      return;
    }

    setSaving(true);
    try {
      const endpoints = form.endpoints
        .filter((ep) => ep.fqdn || ep.ip)
        .map((ep, i) => ({
          fqdn: ep.fqdn || null,
          ip: ep.ip || null,
          port: ep.port ? parseInt(ep.port) : null,
          protocol: ep.protocol,
          base_path: ep.base_path || null,
          is_public: ep.is_public,
          is_primary: ep.is_primary,
          sort_order: i,
        }));

      const route_hops = form.route_hops.map((rh, i) => ({
        direction: rh.direction,
        hop_order: i,
        label: rh.label || null,
        proxy_chain: rh.proxy_chain || null,
        notes: rh.notes || null,
      }));

      const type_settings_json: Record<string, unknown> = {};
      if (form.auth_method) type_settings_json['auth_method'] = form.auth_method;
      if (form.timeout_ms) type_settings_json['timeout_ms'] = parseInt(form.timeout_ms);
      if (form.retry_count) type_settings_json['retry_count'] = parseInt(form.retry_count);

      const payload = {
        service_id: form.service_id,
        env: form.env,
        datacenter: form.datacenter || null,
        network_zone: form.network_zone || null,
        status: form.status,
        contact: form.contact || null,
        vault_ref: form.vault_ref || null,
        notes: form.notes || null,
        change_reason: form.change_reason,
        type_settings_json,
        tags: [],
        endpoints,
        route_hops,
      };

      if (instance) {
        await api.put(`/integration-registry/instances/${instance.id}`, payload, accessToken);
      } else {
        await api.post('/integration-registry/instances', payload, accessToken);
      }

      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const serviceOptions: SelectOption[] = services.map((s) => ({
    value: s.id,
    label: `${s.name}${s.service_type ? ` (${s.service_type})` : ''}`,
  }));

  const envOptions: SelectOption[] = [
    { value: 'UAT', label: 'UAT' },
    { value: 'PROD', label: 'PROD' },
  ];

  const statusOptions: SelectOption[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'active', label: 'Active' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'deprecated', label: 'Deprecated' },
  ];

  const protocolOptions: SelectOption[] = [
    { value: 'HTTPS', label: 'HTTPS' },
    { value: 'HTTP', label: 'HTTP' },
    { value: 'TCP', label: 'TCP' },
    { value: 'JDBC', label: 'JDBC' },
    { value: 'AMQP', label: 'AMQP' },
    { value: 'GRPC', label: 'gRPC' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Basic */}
      <Section title="Basic">
        <Field label="Service *">
          <SingleSelect
            value={form.service_id}
            onChange={(v) => setField('service_id', v)}
            options={serviceOptions}
            placeholder="Select service…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Environment *">
            <SingleSelect
              value={form.env}
              onChange={(v) => setField('env', v)}
              options={envOptions}
              placeholder="Select env…"
            />
          </Field>
          <Field label="Status">
            <SingleSelect
              value={form.status}
              onChange={(v) => setField('status', v)}
              options={statusOptions}
              placeholder="Status…"
            />
          </Field>
        </div>
      </Section>

      {/* Environment & Location */}
      <Section title="Environment & Location">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datacenter">
            <SingleSelect
              value={form.datacenter}
              onChange={(v) => setField('datacenter', v)}
              options={dictOptions('datacenter')}
              placeholder="Select DC…"
              creatable={
                dictMeta['datacenter']?.is_addable
                  ? {
                      enabled: true,
                      onCreate: (label) =>
                        handleAddDictItem('datacenter', label, (code) =>
                          setField('datacenter', code),
                        ),
                    }
                  : undefined
              }
            />
          </Field>
          <Field label="Network Zone">
            <SingleSelect
              value={form.network_zone}
              onChange={(v) => setField('network_zone', v)}
              options={dictOptions('network_zone')}
              placeholder="Select zone…"
            />
          </Field>
        </div>
        <Field label="Contact / Owner">
          <Input
            value={form.contact}
            onChange={(e) => setField('contact', e.target.value)}
            placeholder="team@example.com or Slack handle"
          />
        </Field>
      </Section>

      {/* Endpoints */}
      <Section
        title="Endpoints"
        action={
          <button
            type="button"
            onClick={addEndpoint}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        }
      >
        {form.endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">No endpoints defined.</p>
        ) : (
          form.endpoints.map((ep, i) => (
            <div key={i} className="rounded-md border border-border/60 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Endpoint #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeEndpoint(i)}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="FQDN">
                  <Input
                    value={ep.fqdn}
                    onChange={(e) => setEndpoint(i, 'fqdn', e.target.value)}
                    placeholder="sxs-uat.client.local"
                    className="text-xs font-mono"
                  />
                </Field>
                <Field label="IP">
                  <Input
                    value={ep.ip}
                    onChange={(e) => setEndpoint(i, 'ip', e.target.value)}
                    placeholder="10.0.0.1"
                    className="text-xs font-mono"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Port">
                  <Input
                    value={ep.port}
                    onChange={(e) => setEndpoint(i, 'port', e.target.value)}
                    placeholder="443"
                    className="text-xs font-mono"
                  />
                </Field>
                <Field label="Protocol">
                  <SingleSelect
                    value={ep.protocol}
                    onChange={(v) => setEndpoint(i, 'protocol', v)}
                    options={protocolOptions}
                    placeholder="Protocol"
                  />
                </Field>
                <Field label="Base Path">
                  <Input
                    value={ep.base_path}
                    onChange={(e) => setEndpoint(i, 'base_path', e.target.value)}
                    placeholder="/api/v1"
                  />
                </Field>
              </div>
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ep.is_primary}
                    onChange={(e) => setEndpoint(i, 'is_primary', e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Primary
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ep.is_public}
                    onChange={(e) => setEndpoint(i, 'is_public', e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Public
                </label>
              </div>
            </div>
          ))
        )}
      </Section>

      {/* Type-specific Settings */}
      <Section title="Connection Settings">
        <Field label="Auth Method">
          <SingleSelect
            value={form.auth_method}
            onChange={(v) => setField('auth_method', v)}
            options={dictOptions('auth_method')}
            placeholder="Select auth…"
            creatable={
              dictMeta['auth_method']?.is_addable
                ? {
                    enabled: true,
                    onCreate: (label) =>
                      handleAddDictItem('auth_method', label, (code) =>
                        setField('auth_method', code),
                      ),
                  }
                : undefined
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeout (ms)">
            <Input
              value={form.timeout_ms}
              onChange={(e) => setField('timeout_ms', e.target.value)}
              placeholder="30000"
              type="number"
            />
          </Field>
          <Field label="Retry Count">
            <Input
              value={form.retry_count}
              onChange={(e) => setField('retry_count', e.target.value)}
              placeholder="3"
              type="number"
            />
          </Field>
        </div>
      </Section>

      {/* Vault Reference */}
      <Section title="Vault Reference">
        <Field label="Secret Reference">
          <Input
            value={form.vault_ref}
            onChange={(e) => setField('vault_ref', e.target.value)}
            placeholder="vault://kv/clients/capital/uat/sxs"
            className="font-mono text-xs"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Only store the path reference — never the secret value itself.
        </p>
      </Section>

      {/* Proxy Routes */}
      <Section
        title="Proxy Routes"
        action={
          <button
            type="button"
            onClick={addHop}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Add Hop
          </button>
        }
      >
        {form.route_hops.length === 0 ? (
          <p className="text-xs text-muted-foreground">No proxy hops defined.</p>
        ) : (
          form.route_hops.map((hop, i) => (
            <div key={i} className="rounded-md border border-border/60 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Hop #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeHop(i)}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Direction">
                  <SingleSelect
                    value={hop.direction}
                    onChange={(v) => setHop(i, 'direction', v)}
                    options={[
                      { value: 'inbound', label: 'Inbound' },
                      { value: 'outbound', label: 'Outbound' },
                    ]}
                    placeholder="Direction"
                  />
                </Field>
                <Field label="Label">
                  <Input
                    value={hop.label}
                    onChange={(e) => setHop(i, 'label', e.target.value)}
                    placeholder="HAProxy MK"
                  />
                </Field>
              </div>
              <Field label="Proxy Chain">
                <Input
                  value={hop.proxy_chain}
                  onChange={(e) => setHop(i, 'proxy_chain', e.target.value)}
                  placeholder="RO -> HAProxy MK -> SXS MK"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Notes">
                <Input
                  value={hop.notes}
                  onChange={(e) => setHop(i, 'notes', e.target.value)}
                  placeholder="Additional notes"
                />
              </Field>
            </div>
          ))
        )}
      </Section>

      {/* Governance */}
      <Section title="Governance">
        <Field label="Notes">
          <Textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Additional notes, links, or context"
            rows={3}
          />
        </Field>
      </Section>

      {/* Change Reason */}
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 flex flex-col gap-1.5">
        <Label htmlFor="change-reason" className="text-xs font-semibold text-amber-800">
          Change Reason <span className="text-red-500">*</span>
        </Label>
        <Input
          id="change-reason"
          value={form.change_reason}
          onChange={(e) => setField('change_reason', e.target.value)}
          placeholder="Why are you making this change?"
          className="bg-white"
        />
        <p className="text-xs text-amber-700">Required for all creates and updates.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end border-t pt-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : instance ? 'Save Changes' : 'Create Connection'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
