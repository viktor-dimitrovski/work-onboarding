# Database Isolation (RLS)

PostgreSQL Row Level Security (RLS) is used to enforce tenant isolation at the data layer.

## Tenant column convention

Every tenant-scoped table includes a `tenant_id` column. Models and migrations must follow this convention.

## Request-scoped tenant ID

The API sets the tenant ID at the start of each request:

```
SET LOCAL app.tenant_id = '<tenant_id>'
```

RLS policies read this value via:

```
current_setting('app.tenant_id', true)
```

## RLS policy pattern

Use a simple equality check in policies:

```
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

## Admin bypass

The superadmin product app should use a separate connection role or a controlled bypass policy. Avoid disabling RLS globally.

## Migration checklist

- Add `tenant_id` column
- Backfill for existing rows
- Add index on `tenant_id`
- Create RLS policies
- Enable RLS on the table
