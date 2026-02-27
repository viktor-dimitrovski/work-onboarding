'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { tenantRoleOptions } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import type { UserRow } from '@/lib/types';

interface UserListResponse {
  items: UserRow[];
  meta: { page: number; page_size: number; total: number };
}

const createUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  password: z.string().min(8),
  tenant_role: z.string().min(1, 'Select a tenant role'),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export default function UsersPage() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      full_name: '',
      password: '',
      tenant_role: 'member',
    },
  });

  const loadUsers = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<UserListResponse>('/users?page=1&page_size=100', accessToken);
      setUsers(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [accessToken]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.post('/users', values, accessToken);
      form.reset({
        email: '',
        full_name: '',
        password: '',
        tenant_role: 'member',
      });
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create user');
    }
  });

  if (loading) return <LoadingState label='Loading users...' />;

  return (
    <div className='space-y-6'>
      <h2 className='text-2xl font-semibold'>Users</h2>

      <Card>
        <CardHeader>
          <CardTitle>Create user</CardTitle>
          <CardDescription>Add a user and assign a tenant role.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className='grid gap-4 md:grid-cols-2' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label>Email</Label>
              <Input type='email' {...form.register('email')} />
              {form.formState.errors.email && (
                <p className='text-xs text-destructive'>{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className='space-y-2'>
              <Label>Full name</Label>
              <Input {...form.register('full_name')} />
              {form.formState.errors.full_name && (
                <p className='text-xs text-destructive'>{form.formState.errors.full_name.message}</p>
              )}
            </div>

            <div className='space-y-2'>
              <Label>Password</Label>
              <Input type='password' {...form.register('password')} />
              {form.formState.errors.password && (
                <p className='text-xs text-destructive'>{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className='space-y-2'>
              <Label>Tenant role</Label>
              <select
                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                {...form.register('tenant_role')}
              >
                {tenantRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role.replace('_', ' ')}
                  </option>
                ))}
              </select>
              {form.formState.errors.tenant_role && (
                <p className='text-xs text-destructive'>{form.formState.errors.tenant_role.message}</p>
              )}
            </div>

            {error && <p className='text-sm text-destructive md:col-span-2'>{error}</p>}

            <div className='flex flex-col gap-3 md:col-span-2 md:flex-row md:items-center md:justify-end'>
              <Button className='w-full md:w-auto' type='submit' disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating...' : 'Create user'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User directory</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <EmptyState title='No users found' description='Create your first user account.' />
          ) : (
            <div className='space-y-2'>
              {users.map((user) => (
                <div key={user.id} className='flex flex-wrap items-center justify-between rounded-md border p-3'>
                  <div>
                    <p className='font-medium'>{user.full_name}</p>
                    <p className='text-xs text-muted-foreground'>{user.email}</p>
                  </div>
                  <div className='flex flex-wrap gap-1'>
                    <StatusChip status={(user.tenant_role || 'member').replace('_', ' ')} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
