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

const addExistingSchema = z.object({
  email: z.string().email(),
  tenant_role: z.string().min(1, 'Select a tenant role'),
});

type AddExistingValues = z.infer<typeof addExistingSchema>;

export default function UsersPage() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      full_name: '',
      password: '',
      tenant_role: 'member',
    },
  });

  const addExistingForm = useForm<AddExistingValues>({
    resolver: zodResolver(addExistingSchema),
    defaultValues: {
      email: '',
      tenant_role: 'member',
    },
  });

  const loadUsers = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('page_size', '100');
      params.set('include_disabled', showDisabled ? 'true' : 'false');
      if (roleFilter) {
        params.set('role', roleFilter);
      }
      const response = await api.get<UserListResponse>(`/users?${params.toString()}`, accessToken);
      setUsers(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [accessToken, showDisabled, roleFilter]);

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

  const onAddExisting = addExistingForm.handleSubmit(async (values) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.post('/users/add-existing', values, accessToken);
      addExistingForm.reset({ email: '', tenant_role: 'member' });
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to add existing user');
    }
  });

  const setMembershipStatus = async (user: UserRow, nextStatus: 'active' | 'disabled') => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.put(`/users/${user.id}/membership`, { status: nextStatus }, accessToken);
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to update user status');
    }
  };

  const removeFromTenant = async (user: UserRow) => {
    if (!accessToken) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Remove ${user.email} from this tenant?`);
    if (!ok) return;
    setError(null);
    try {
      await api.delete(`/users/${user.id}/membership`, accessToken);
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to remove user from tenant');
    }
  };

  const filteredUsers = users.filter((user) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      (user.full_name || '').toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
    );
  });

  if (loading) return <LoadingState label='Loading users...' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-2xl font-semibold'>Users</h2>
        <label className='flex items-center gap-2 text-sm text-muted-foreground'>
          <input
            type='checkbox'
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
          />
          Show disabled
        </label>
      </div>

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
          <CardTitle>Add existing user</CardTitle>
          <CardDescription>
            If the user already exists in the database (created by another tenant), add them to this tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className='grid gap-4 md:grid-cols-2' onSubmit={onAddExisting}>
            <div className='space-y-2'>
              <Label>Email</Label>
              <Input type='email' {...addExistingForm.register('email')} />
              {addExistingForm.formState.errors.email && (
                <p className='text-xs text-destructive'>{addExistingForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label>Tenant role</Label>
              <select
                className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                {...addExistingForm.register('tenant_role')}
              >
                {tenantRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role.replace('_', ' ')}
                  </option>
                ))}
              </select>
              {addExistingForm.formState.errors.tenant_role && (
                <p className='text-xs text-destructive'>{addExistingForm.formState.errors.tenant_role.message}</p>
              )}
            </div>

            {error && <p className='text-sm text-destructive md:col-span-2'>{error}</p>}

            <div className='flex flex-col gap-3 md:col-span-2 md:flex-row md:items-center md:justify-end'>
              <Button className='w-full md:w-auto' type='submit' disabled={addExistingForm.formState.isSubmitting}>
                {addExistingForm.formState.isSubmitting ? 'Adding...' : 'Add to tenant'}
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
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search by name or email...'
              className='max-w-sm'
            />
            <select
              className='h-10 rounded-md border border-input bg-white px-3 text-sm'
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value=''>All roles</option>
              {tenantRoleOptions.map((role) => (
                <option key={role} value={role}>
                  {role.replace('_', ' ')}
                </option>
              ))}
            </select>
            {(query || roleFilter) && (
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setQuery('');
                  setRoleFilter('');
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {filteredUsers.length === 0 ? (
            <EmptyState title='No users found' description='Create your first user account.' />
          ) : (
            <div className='space-y-2'>
              {filteredUsers.map((user) => (
                <div key={user.id} className='flex flex-wrap items-center justify-between rounded-md border p-3'>
                  <div>
                    <p className='font-medium'>{user.full_name}</p>
                    <p className='text-xs text-muted-foreground'>{user.email}</p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <StatusChip status={(user.tenant_role || 'member').replace('_', ' ')} />
                    {user.tenant_status && user.tenant_status !== 'active' && (
                      <StatusChip status={user.tenant_status} />
                    )}
                    <div className='flex items-center gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => setMembershipStatus(user, user.tenant_status === 'disabled' ? 'active' : 'disabled')}
                      >
                        {user.tenant_status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button type='button' size='sm' variant='outline' onClick={() => removeFromTenant(user)}>
                        Remove
                      </Button>
                    </div>
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
