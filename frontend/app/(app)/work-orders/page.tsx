"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';

type WorkOrderSummary = {
  wo_id: string;
  title?: string | null;
  path: string;
  year: string;
  services_count: number;
  deploy_count: number;
};

type WorkOrderListResponse = {
  items: WorkOrderSummary[];
};

export default function WorkOrdersPage() {
  const { accessToken } = useAuth();
  const { hasPermission, hasModule } = useTenant();
  const [items, setItems] = useState<WorkOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const canWrite = hasModule('releases') && hasPermission('releases:write');

  const load = async (q?: string) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const response = await api.get<WorkOrderListResponse>(`/work-orders${qs}`, accessToken);
      setItems(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  if (loading) return <LoadingState label='Loading work orders...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-semibold'>Work Orders</h2>
          <p className='text-sm text-muted-foreground'>Track development scope, touched services, and release readiness.</p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href='/work-orders/new'>New WO</Link>
          </Button>
        )}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search WO id, title, or service...'
          className='max-w-sm'
        />
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            void load(query.trim());
          }}
        >
          Search
        </Button>
        <Button
          type='button'
          variant='ghost'
          onClick={() => {
            setQuery('');
            void load();
          }}
        >
          Reset
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title='No work orders' description='Create the first WO to start tracking delivery scope.' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recent Work Orders</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {items.map((item) => (
              <Link
                key={item.wo_id}
                href={`/work-orders/${item.wo_id}`}
                className='flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition hover:border-primary/40'
              >
                <div className='min-w-0'>
                  <p className='font-medium'>{item.wo_id}</p>
                  <p className='text-xs text-muted-foreground line-clamp-1'>{item.title || 'Untitled work order'}</p>
                </div>
                <div className='flex items-center gap-4 text-xs text-muted-foreground tabular-nums'>
                  <span>Services: {item.services_count}</span>
                  <span>Deploys: {item.deploy_count}</span>
                  <span>{item.year}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
