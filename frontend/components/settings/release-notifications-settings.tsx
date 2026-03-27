'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type NotificationSettings = {
  blocked_item_recipients: string[];
  notify_release_owner: boolean;
  notify_run_starter: boolean;
};

export function ReleaseNotificationsSettings() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings>({
    blocked_item_recipients: [],
    notify_release_owner: true,
    notify_run_starter: true,
  });
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api.get<{ settings_json?: { release_notifications?: NotificationSettings } }>('/settings', accessToken)
      .then((res) => {
        const ns = res.settings_json?.release_notifications;
        if (ns) setSettings(ns);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  const save = async (updated: NotificationSettings) => {
    if (!accessToken) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/settings', { release_notifications: updated }, accessToken);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || settings.blocked_item_recipients.includes(email)) { setNewEmail(''); return; }
    const updated = { ...settings, blocked_item_recipients: [...settings.blocked_item_recipients, email] };
    setSettings(updated);
    setNewEmail('');
    void save(updated);
  };

  const removeEmail = (email: string) => {
    const updated = { ...settings, blocked_item_recipients: settings.blocked_item_recipients.filter((e) => e !== email) };
    setSettings(updated);
    void save(updated);
  };

  const toggleFlag = (field: 'notify_release_owner' | 'notify_run_starter') => {
    const updated = { ...settings, [field]: !settings[field] };
    setSettings(updated);
    void save(updated);
  };

  if (loading) return <p className="text-xs text-muted-foreground">Loading notification settings…</p>;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-slate-800 mb-1">Blocked Deployment Email Recipients</p>
        <p className="text-xs text-muted-foreground mb-3">
          When a deployment run item is marked &ldquo;Blocked&rdquo;, an email will be sent to the addresses below.
        </p>

        {/* Email chip list */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {settings.blocked_item_recipients.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
            >
              {email}
              <button onClick={() => removeEmail(email)} className="text-slate-400 hover:text-slate-600">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {settings.blocked_item_recipients.length === 0 && (
            <span className="text-xs text-muted-foreground italic">No additional recipients configured</span>
          )}
        </div>

        {/* Add email */}
        <div className="flex items-center gap-2">
          <Input
            type="email"
            placeholder="email@company.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            className="h-8 text-xs max-w-xs"
          />
          <Button size="sm" variant="outline" onClick={addEmail} className="h-8 text-xs" disabled={!newEmail.trim()}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">Also notify</p>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.notify_release_owner}
            onChange={() => toggleFlag('notify_release_owner')}
            className="rounded border-slate-300"
          />
          Release owner (created_by)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.notify_run_starter}
            onChange={() => toggleFlag('notify_run_starter')}
            className="rounded border-slate-300"
          />
          Deployment run starter (started_by)
        </label>
      </div>

      {(saving || saved) && (
        <p className={`text-xs ${saved ? 'text-emerald-600' : 'text-muted-foreground'}`}>
          {saving ? 'Saving…' : '✓ Saved'}
        </p>
      )}
    </div>
  );
}
