'use client';

import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { LoadingState } from '@/components/common/loading-state';
import { StatusChip } from '@/components/common/status-chip';
import { TenantRolesEditor } from '@/components/common/tenant-roles-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDateTime, roleDisplayName, tenantRoleGroups } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/tenant-context';
import type { UserRow } from '@/lib/types';

interface UserListResponse {
  items: UserRow[];
  meta: { page: number; page_size: number; total: number };
}

interface AuditLogOut {
  id: string;
  actor_user_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  status: string;
  details: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
}

interface AuditLogListResponse {
  items: AuditLogOut[];
  meta: { page: number; page_size: number; total: number };
}

const addUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().optional(),
  password: z.string().optional(),
  tenant_roles: z.array(z.string()).min(1, 'Select at least one tenant role'),
});

type AddUserValues = z.infer<typeof addUserSchema>;

function normalizeTenantRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return ['member'];
  const roles = value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(roles));
  return unique.length ? unique : ['member'];
}

function rolesEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const as = new Set(a);
  for (const item of b) if (!as.has(item)) return false;
  return true;
}


export default function UsersPage() {
  const { accessToken, user: authUser } = useAuth();
  const { context: tenantCtx } = useTenant();
  const enabledModules = tenantCtx?.modules;
  const callerRoles = tenantCtx?.roles;
  const isSuperAdmin = authUser?.roles?.includes('super_admin' as never);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [editedTenantRoles, setEditedTenantRoles] = useState<Record<string, string[]>>({});
  const [activityUser, setActivityUser] = useState<UserRow | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRows, setActivityRows] = useState<AuditLogOut[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');

  const form = useForm<AddUserValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      email: '',
      full_name: '',
      password: '',
      tenant_roles: ['member'],
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
      const fullName = (values.full_name || '').trim();
      const password = (values.password || '').trim();
      const payload = {
        email: values.email,
        tenant_roles: normalizeTenantRoles(values.tenant_roles),
        full_name: fullName || undefined,
        password: password || undefined,
      };
      await api.post('/users', payload, accessToken);
      form.reset({
        email: '',
        full_name: '',
        password: '',
        tenant_roles: ['member'],
      });
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to add user');
    }
  });

  const setMembershipStatus = async (user: UserRow, nextStatus: 'active' | 'disabled') => {
    if (!accessToken) return;
    setError(null);
    try {
      setRowSavingId(user.id);
      await api.put(`/users/${user.id}/membership`, { status: nextStatus }, accessToken);
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to update user status');
    } finally {
      setRowSavingId(null);
    }
  };

  const saveTenantRoles = async (user: UserRow, roles: string[]) => {
    if (!accessToken) return;
    setError(null);
    try {
      setRowSavingId(user.id);
      await api.put(`/users/${user.id}/membership`, { roles }, accessToken);
      await loadUsers();
      setEditedTenantRoles((prev) => {
        const copy = { ...prev };
        delete copy[user.id];
        return copy;
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to update tenant roles');
    } finally {
      setRowSavingId(null);
    }
  };

  const startEditUser = (user: UserRow) => {
    setEditingUserId(user.id);
    setEditUserName(user.full_name || '');
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUserName('');
  };

  const saveUserName = async () => {
    if (!accessToken || !editingUserId) return;
    const trimmed = editUserName.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setError(null);
    try {
      setRowSavingId(editingUserId);
      const updated = await api.put<UserRow>(`/users/${editingUserId}/membership`, { full_name: trimmed }, accessToken);
      setUsers((prev) => prev.map((u) => (u.id === editingUserId ? { ...u, full_name: updated.full_name } : u)));
      cancelEditUser();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to update user name');
    } finally {
      setRowSavingId(null);
    }
  };

  const removeFromTenant = async (user: UserRow) => {
    if (!accessToken) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Remove ${user.email} from this tenant?`);
    if (!ok) return;
    setError(null);
    try {
      setRowSavingId(user.id);
      await api.delete(`/users/${user.id}/membership`, accessToken);
      await loadUsers();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to remove user from tenant');
    } finally {
      setRowSavingId(null);
    }
  };

  const openActivity = async (user: UserRow) => {
    if (!accessToken) return;
    setActivityUser(user);
    setActivityLoading(true);
    setActivityError(null);
    setActivityRows([]);
    try {
      const response = await api.get<AuditLogListResponse>(`/users/${user.id}/activity?page=1&page_size=200`, accessToken);
      setActivityRows(response.items);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Failed to load activity history');
    } finally {
      setActivityLoading(false);
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
        <div>
          <h2 className='text-2xl font-semibold'>Users</h2>
          <p className='text-sm text-muted-foreground'>
            Manage tenant access (role + status). Global roles are shown for visibility.
          </p>
        </div>
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
          <CardTitle>User management</CardTitle>
          <CardDescription>Directory + access controls in one compact view.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='directory'>
            <TabsList>
              <TabsTrigger value='directory'>Directory</TabsTrigger>
              <TabsTrigger value='add'>Add user</TabsTrigger>
            </TabsList>

            <TabsContent value='directory'>
              <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search name/email...'
                    className='w-64'
                  />
                  <select
                    className='h-10 rounded-md border border-input bg-white px-3 text-sm'
                    value={roleFilter}
                    onChange={(event) => setRoleFilter(event.target.value)}
                  >
                    <option value=''>All tenant roles</option>
                    {tenantRoleGroups
                      .filter((g) => g.moduleKey === null || !enabledModules || enabledModules.includes(g.moduleKey))
                      .map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.roles.map((role) => (
                            <option key={role} value={role}>
                              {roleDisplayName(role)}
                            </option>
                          ))}
                        </optgroup>
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
                <div className='text-xs text-muted-foreground'>
                  Showing <span className='font-medium text-foreground'>{filteredUsers.length}</span> users
                </div>
              </div>

              {error && <p className='mb-3 text-sm text-destructive'>{error}</p>}

              {filteredUsers.length === 0 ? (
                <EmptyState title='No users found' description='Create your first user account.' />
              ) : (
                <div className='overflow-x-auto rounded-md border'>
                  <div className='max-h-[520px] overflow-auto'>
                    <table className='w-full min-w-[540px] text-sm'>
                      <thead className='sticky top-0 z-10 bg-muted/60 text-xs text-muted-foreground'>
                        <tr className='border-b'>
                          <th className='px-3 py-2 text-left font-medium'>User</th>
                          <th className='px-3 py-2 text-left font-medium'>Tenant roles</th>
                          <th className='px-3 py-2 text-left font-medium'>Status</th>
                          <th className='px-3 py-2 text-left font-medium'>Last login</th>
                          <th className='px-3 py-2 text-left font-medium'>Global roles</th>
                          <th className='px-3 py-2 text-right font-medium'>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((user) => {
                          const currentRoles = normalizeTenantRoles(
                            user.tenant_roles ?? (user.tenant_role ? [user.tenant_role] : []),
                          );
                          const selectedRoles = normalizeTenantRoles(
                            editedTenantRoles[user.id] ?? currentRoles,
                          );
                          const roleDirty = !rolesEqual(currentRoles, selectedRoles);
                          const saving = rowSavingId === user.id;
                          return (
                            <tr key={user.id} className='border-b last:border-b-0'>
                              <td className='px-3 py-2'>
                                {editingUserId === user.id ? (
                                  <div className='flex items-center gap-2'>
                                    <Input
                                      value={editUserName}
                                      onChange={(e) => setEditUserName(e.target.value)}
                                      placeholder='Full name'
                                      className='h-8 max-w-[180px]'
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveUserName();
                                        if (e.key === 'Escape') cancelEditUser();
                                      }}
                                    />
                                    <Button variant='ghost' size='sm' onClick={saveUserName} disabled={saving}>
                                      Save
                                    </Button>
                                    <Button variant='ghost' size='sm' onClick={cancelEditUser} disabled={saving}>
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <div className='flex items-center gap-2'>
                                    <div>
                                      <div className='font-medium leading-5'>{user.full_name || '—'}</div>
                                      <div className='text-xs text-muted-foreground'>{user.email}</div>
                                    </div>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
                                      onClick={() => startEditUser(user)}
                                      title='Edit name'
                                    >
                                      <Pencil className='h-3.5 w-3.5' />
                                    </Button>
                                  </div>
                                )}
                              </td>
                              <td className='px-3 py-2'>
                                <div className='flex flex-wrap items-center gap-2'>
                                  <div className='flex flex-wrap gap-1'>
                                    {(roleDirty ? selectedRoles : currentRoles).map((r) => (
                                      <StatusChip key={r} status={r} />
                                    ))}
                                  </div>
                                  <TenantRolesEditor
                                    disabled={saving}
                                    value={selectedRoles}
                                    enabledModules={enabledModules}
                                    callerRoles={isSuperAdmin ? undefined : callerRoles}
                                    title={user.email}
                                    onChange={(next) =>
                                      setEditedTenantRoles((prev) => ({ ...prev, [user.id]: next }))
                                    }
                                  />
                                  {roleDirty ? (
                                    <Button
                                      type='button'
                                      size='sm'
                                      disabled={saving}
                                      onClick={() => saveTenantRoles(user, selectedRoles)}
                                    >
                                      {saving ? 'Saving...' : 'Save'}
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                              <td className='px-3 py-2'>
                                <div className='flex items-center gap-2'>
                                  <StatusChip status={user.tenant_status || 'active'} />
                                </div>
                              </td>
                              <td className='px-3 py-2 text-xs text-muted-foreground'>
                                {formatDateTime(user.last_login_at)}
                              </td>
                              <td className='px-3 py-2'>
                                <div className='flex flex-wrap gap-1'>
                                  {(user.roles || []).length ? (
                                    user.roles.map((r) => <StatusChip key={r} status={r} />)
                                  ) : (
                                    <span className='text-xs text-muted-foreground'>—</span>
                                  )}
                                </div>
                              </td>
                              <td className='px-3 py-2'>
                                <div className='flex justify-end gap-2'>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='outline'
                                    disabled={saving}
                                    onClick={() => openActivity(user)}
                                  >
                                    Activity
                                  </Button>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='outline'
                                    disabled={saving}
                                    onClick={() =>
                                      setMembershipStatus(
                                        user,
                                        user.tenant_status === 'disabled' ? 'active' : 'disabled',
                                      )
                                    }
                                  >
                                    {user.tenant_status === 'disabled' ? 'Enable' : 'Disable'}
                                  </Button>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='outline'
                                    disabled={saving}
                                    onClick={() => removeFromTenant(user)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value='add'>
              <form className='grid gap-4 md:grid-cols-2' onSubmit={onSubmit}>
                <div className='space-y-2'>
                  <Label>Email</Label>
                  <Input type='email' {...form.register('email')} />
                  {form.formState.errors.email && (
                    <p className='text-xs text-destructive'>{form.formState.errors.email.message}</p>
                  )}
                  <p className='text-xs text-muted-foreground'>
                    If this email already exists globally, we will reuse the same user and only grant access in this
                    tenant.
                  </p>
                </div>

                <div className='space-y-2'>
                  <Label>Tenant roles</Label>
                  <div className='flex items-center gap-2'>
                    <TenantRolesEditor
                      value={normalizeTenantRoles(form.watch('tenant_roles'))}
                      enabledModules={enabledModules}
                      callerRoles={isSuperAdmin ? undefined : callerRoles}
                      onChange={(next) => form.setValue('tenant_roles', next, { shouldValidate: true })}
                    />
                    <div className='flex flex-wrap gap-1'>
                      {normalizeTenantRoles(form.watch('tenant_roles')).map((r) => (
                        <StatusChip key={r} status={r} />
                      ))}
                    </div>
                  </div>
                  {form.formState.errors.tenant_roles && (
                    <p className='text-xs text-destructive'>{form.formState.errors.tenant_roles.message}</p>
                  )}
                </div>

                <div className='space-y-2'>
                  <Label>Full name (required for new user)</Label>
                  <Input {...form.register('full_name')} placeholder='Only needed when creating a new user' />
                </div>

                <div className='space-y-2'>
                  <Label>Temp password (required for new user)</Label>
                  <Input type='password' {...form.register('password')} placeholder='Only needed when creating a new user' />
                </div>

                <div className='flex items-center justify-end md:col-span-2'>
                  <Button type='submit' disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Saving...' : 'Add user'}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!activityUser} onOpenChange={(open) => (!open ? setActivityUser(null) : undefined)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>User activity</SheetTitle>
            <SheetDescription>
              {activityUser ? `${activityUser.full_name} (${activityUser.email})` : '—'}
            </SheetDescription>
          </SheetHeader>

          <div className='mt-4'>
            {activityLoading ? (
              <p className='text-sm text-muted-foreground'>Loading activity…</p>
            ) : activityError ? (
              <p className='text-sm text-destructive'>{activityError}</p>
            ) : activityRows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No activity found in this tenant.</p>
            ) : (
              <ScrollArea className='h-[70vh] pr-3'>
                <div className='space-y-3'>
                  {activityRows.map((row) => (
                    <div key={row.id} className='rounded-md border bg-muted/20 px-3 py-2'>
                      <div className='flex flex-wrap items-center justify-between gap-2'>
                        <div className='text-sm font-medium'>
                          {row.action}{' '}
                          <span className='text-xs text-muted-foreground'>
                            · {row.entity_type}
                          </span>
                        </div>
                        <div className='text-xs text-muted-foreground'>{formatDateTime(row.created_at)}</div>
                      </div>
                      <div className='mt-1 text-xs text-muted-foreground'>
                        Actor: {row.actor_name || row.actor_email || '—'} · Status: {row.status}
                      </div>
                      {row.details && Object.keys(row.details).length ? (
                        <pre className='mt-2 overflow-auto rounded bg-white p-2 text-[11px] leading-4'>
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
