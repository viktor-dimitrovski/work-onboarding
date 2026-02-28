'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { BillingInvoice, BillingOverview, BillingUsageResponse } from '@/lib/types';

export default function BillingPage() {
  const { accessToken } = useAuth();
  const { hasModule, hasPermission } = useTenant();

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null);
  const [loading, setLoading] = useState(true);

  const canRead = useMemo(() => hasModule('billing') && hasPermission('billing:read'), [hasModule, hasPermission]);
  const canManage = useMemo(
    () => hasModule('billing') && hasPermission('billing:manage'),
    [hasModule, hasPermission],
  );

  const loadData = useCallback(async () => {
    if (!accessToken || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [overviewResponse, usageResponse, invoiceResponse] = await Promise.all([
        api.get<BillingOverview>('/billing/overview', accessToken),
        api.get<BillingUsageResponse>('/billing/usage', accessToken),
        api.get<BillingInvoice[]>('/billing/invoices', accessToken),
      ]);
      setOverview(overviewResponse);
      setUsage(usageResponse);
      setInvoices(invoiceResponse);
    } finally {
      setLoading(false);
    }
  }, [accessToken, canRead]);

  const handleManageBilling = useCallback(async () => {
    if (!accessToken) return;
    const response = await api.post<{ url: string }>('/billing/portal-session', {}, accessToken);
    if (response.url) {
      window.open(response.url, '_blank', 'noopener');
    }
  }, [accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return <LoadingState label='Loading billing...' />;
  }

  if (!canRead) {
    return <EmptyState title='Billing disabled' description='This module is not enabled for your tenant.' />;
  }

  const currency = overview?.currency || overview?.next_invoice?.currency || 'usd';
  const planName = overview?.plan?.name || 'No plan';
  const subscriptionStatus = overview?.subscription?.status || 'inactive';
  const periodStart = overview?.period_start ? formatDate(overview.period_start) : 'N/A';
  const periodEnd = overview?.period_end ? formatDate(overview.period_end) : 'N/A';

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-semibold'>Billing</h2>
          <p className='text-sm text-muted-foreground'>Usage, subscriptions, and invoices for your tenant.</p>
        </div>
        <Button onClick={handleManageBilling} disabled={!accessToken}>
          Manage billing
        </Button>
      </div>

      <section className='grid gap-4 md:grid-cols-3'>
        <MetricCard title='Current plan' value={planName} subtitle={`Status: ${subscriptionStatus}`} />
        <MetricCard
          title='Current period spend'
          value={formatCurrency(overview?.current_period_spend || 0, currency)}
          subtitle={`${periodStart} → ${periodEnd}`}
        />
        <MetricCard
          title='Next invoice'
          value={
            overview?.next_invoice
              ? formatCurrency(overview.next_invoice.total_amount || 0, overview.next_invoice.currency)
              : 'No invoices'
          }
          subtitle={overview?.next_invoice?.due_at ? `Due ${formatDate(overview.next_invoice.due_at)}` : '—'}
        />
      </section>

      <section className='space-y-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-lg font-semibold'>This month’s usage</h3>
        </div>
        {usage?.items && usage.items.length > 0 ? (
          <div className='grid gap-3 md:grid-cols-3'>
            {usage.items.map((item) => (
              <MetricCard
                key={item.event_key}
                title={item.meter_name}
                value={formatNumber(item.units)}
                subtitle={formatCurrency(item.amount, item.currency)}
              />
            ))}
          </div>
        ) : (
          <EmptyState title='No usage yet' description='Usage will appear once activity is recorded.' />
        )}
      </section>

      <section className='space-y-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-lg font-semibold'>Invoices</h3>
          {canManage && (
            <Button variant='outline' onClick={handleManageBilling} disabled={!accessToken}>
              Open portal
            </Button>
          )}
        </div>
        {invoices && invoices.length > 0 ? (
          <div className='space-y-3'>
            {invoices.map((invoice) => (
              <Card key={invoice.id}>
                <CardHeader className='flex flex-row items-center justify-between'>
                  <div>
                    <CardTitle className='text-base'>{formatCurrency(invoice.total_amount, invoice.currency)}</CardTitle>
                    <CardDescription>
                      Status: {invoice.status} • {invoice.issued_at ? formatDate(invoice.issued_at) : 'Draft'}
                    </CardDescription>
                  </div>
                  <div className='text-sm text-muted-foreground'>
                    {invoice.period_start && invoice.period_end
                      ? `${formatDate(invoice.period_start)} → ${formatDate(invoice.period_end)}`
                      : '—'}
                  </div>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {invoice.lines.length > 0 ? (
                    invoice.lines.map((line) => (
                      <div key={line.id} className='flex items-center justify-between text-sm'>
                        <span>{line.description}</span>
                        <span>{formatCurrency(line.total_amount, line.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <p className='text-sm text-muted-foreground'>No line items yet.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title='No invoices yet' description='Invoices will appear after your first billing cycle.' />
        )}
      </section>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl'>{value}</CardTitle>
        {subtitle ? <p className='text-xs text-muted-foreground'>{subtitle}</p> : null}
      </CardHeader>
    </Card>
  );
}

function formatCurrency(amount: number | string, currency: string) {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(numeric)) {
    return `${amount}`;
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(numeric);
  } catch {
    return `${numeric}`;
  }
}

function formatNumber(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return `${value}`;
  }
  return new Intl.NumberFormat('en-US').format(numeric);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
