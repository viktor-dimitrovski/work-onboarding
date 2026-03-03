import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SecretKeyEntry({
  label = 'Encryption key',
  confirmLabel = 'Confirm key',
  submitLabel = 'Unlock',
  allowReinitialize = false,
  onSubmit,
  disabled,
}: {
  label?: string;
  confirmLabel?: string;
  submitLabel?: string;
  allowReinitialize?: boolean;
  disabled?: boolean;
  onSubmit: (passphrase: string, reinitialize: boolean) => void | Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reinitialize, setReinitialize] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!passphrase.trim()) {
      setError('Key is required.');
      return;
    }
    if (passphrase !== confirm) {
      setError('Keys do not match.');
      return;
    }
    await onSubmit(passphrase, reinitialize);
    setPassphrase('');
    setConfirm('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>{label}</Label>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Enter key"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{confirmLabel}</Label>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter key"
          />
        </div>
      </div>

      {allowReinitialize && (
        <label className="text-xs text-muted-foreground flex items-center gap-2">
          <input
            type="checkbox"
            checked={reinitialize}
            onChange={(e) => setReinitialize(e.target.checked)}
          />
          Reinitialize crypto metadata (dangerous; old encrypted data becomes unreadable).
        </label>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={handleSubmit} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
