# Integration Registry — Module Documentation

## Overview

The Integration Registry is a multitenant module for cataloging, managing, and auditing integration connection metadata across clients and environments. It stores **no sensitive values** — only vault/secret path references — and enforces strict audit history on every change.

---

## Architecture

```
integration_registry DB schema
├── ir_dictionary           — global & tenant code lists (drives all dropdowns)
├── ir_dictionary_item      — entries per dictionary
├── ir_service              — logical service catalog (tenant-scoped, RLS)
├── ir_instance             — deployed instance per service+env+DC (tenant-scoped, RLS)
├── ir_endpoint             — 1..N FQDN/IP/port per instance (tenant-scoped, RLS)
├── ir_route_hop            — proxy chain hops per instance (tenant-scoped, RLS)
├── ir_audit_log            — immutable snapshot on every write (tenant-scoped, RLS)
└── ir_user_grid_prefs      — column picker preferences per user+tenant+grid_key
```

All tenant-scoped tables use PostgreSQL **Row Level Security** (RLS) via `app.tenant_id` session variable — identical to the compliance module pattern.

---

## RBAC Roles

| Tenant Role    | Permissions                             | Can do                                     |
|----------------|-----------------------------------------|--------------------------------------------|
| `ir_viewer`    | `ir:read`                               | Read-only access to all IR pages           |
| `ir_editor`    | `ir:read`, `ir:write`                   | Create/update UAT instances and services   |
| `ir_approver`  | `ir:read`, `ir:write`, `ir:approve`     | Also create/update PROD instances, clone   |
| `ir_admin`     | `ir:read`, `ir:write`, `ir:approve`, `ir:admin` | Also manage dictionaries           |

> `tenant_admin` users automatically receive all `ir:*` permissions.

Assign roles via the Users page (tenant admin only).

---

## UI Pages

### 1. Overview (`/integration-registry/overview`)
Dashboard with KPI tiles (Total / UAT / PROD / Active / Draft / Services) and a recently-changed list linking to each connection.

### 2. Connections (`/integration-registry/connections`)
The main data grid.

- **Filters**: Env, Datacenter, Status, free-text search (service/datacenter/network only)
- **Column Picker**: click "Columns" to choose visible columns. Preferences are saved per user via the API and restored on next visit.
- **Row actions**: View (opens drawer), History (opens drawer on History tab)
- **Drawer tabs**: Overview | Endpoints | Routes | Settings | History
- **Edit**: opens an inline form within the drawer (requires `ir:write`)
- **Clone to PROD**: copies a UAT instance to PROD with status `draft` (requires `ir:approve`)

### 3. Services (`/integration-registry/services`)
Manage the **logical service catalog** — one row per named integration service (SXS, BC Connectors, IBANK Directory, etc.).

- Create and edit services
- View instance count per service
- Every save requires a `change_reason`

### 4. Dictionaries (`/integration-registry/dictionaries`)
Edit the code lists that drive all dropdowns in the module. Requires `ir:admin` permission.

- Left panel: list of dictionaries
- Right panel: items table with Add / Edit / Enable / Disable
- **Addable** dictionaries allow users to create new entries directly from any dropdown in the module
- **Non-addable** dictionaries (environment, service_type, network_zone) are system-controlled

### 5. Audit / History (`/integration-registry/audit`)
Full immutable change log. Every create and update writes a version snapshot.

- Filter by entity type
- Expand rows to view the full JSON snapshot at that version

### 6. Settings (`/integration-registry/settings`)
Encryption key management for tenant admins.

- Initialize / unlock the per-tenant key
- Lock the module after use
- Reinitialize crypto metadata if required (dangerous — old data becomes unreadable)

---

## Vault Reference Convention

The `vault_ref` field stores **only the path** to a secret — never the secret value itself.

Format: `vault://kv/clients/<client>/<env>/<service>`

Examples:
```
vault://kv/clients/capital/uat/sxs
vault://kv/clients/erste/prod/bc-connectors
vault://kv/aws/secretsmanager/prod/ibank-dir
```

The UI masks the vault reference by truncating to the first 4 path segments and appending `***`.

---

## Encryption at Rest

Integration Registry encrypts selected fields **before** writing to the database. Encryption is **per-tenant** and uses a key entered by a tenant admin in Integration Registry → Settings.

**Encrypted fields (stored as ciphertext):**

- `integration_registry.ir_endpoint`: `fqdn`, `ip`, `base_path`
- `integration_registry.ir_instance`: `vault_ref`, `contact`, `notes`
- `integration_registry.ir_route_hop`: `label`, `proxy_chain`, `notes`

**Search impact:** IP/FQDN substring search is disabled because ciphertext is not searchable. Only non-encrypted fields (service name, env/status, datacenter, network zone) are used for search filters.

---

## Key Management

- The **key is never stored**. It exists **only in backend memory**.
- After a backend restart, the module becomes **locked** until the admin re-enters the key.
- The key is **never displayed again** after submission.
- A **per-tenant salt** and key fingerprint are stored to validate the key on unlock.

### Reinitialize (dangerous)

If the crypto metadata is missing/corrupted, an admin can **reinitialize** it. This generates a new salt and fingerprint.
**Important:** if a different key is used, previously encrypted data becomes unreadable.

---

## Recovery (Decrypt Locally)

If you need to decrypt a ciphertext value manually:

1) Get the tenant crypto salt:
```sql
SELECT encode(kdf_salt, 'hex') AS salt_hex
FROM integration_registry.ir_tenant_crypto
WHERE tenant_id = '<tenant-uuid>';
```

2) Run the recovery script:
```bash
python backend/tools/integration_registry_decrypt.py \
  --tenant-id <tenant-uuid> \
  --passphrase "<your key>" \
  --salt-hex <salt_hex> \
  --table ir_endpoint \
  --column fqdn \
  --ciphertext "enc:v1:..."
```

---

## API Reference

All endpoints are under `/api/v1/integration-registry/` and require a valid JWT + tenant context.

### Overview
```
GET  /integration-registry/overview
```
Returns counts and recently changed instances.

### Services
```
GET  /integration-registry/services
POST /integration-registry/services                  (ir:write)
GET  /integration-registry/services/{id}
PUT  /integration-registry/services/{id}             (ir:write)
```

### Instances
```
GET  /integration-registry/instances                 ?env=&datacenter=&status=&search=&page=&page_size=
POST /integration-registry/instances                 (ir:write; ir:approve for PROD)
GET  /integration-registry/instances/{id}
PUT  /integration-registry/instances/{id}            (ir:write; ir:approve for PROD)
POST /integration-registry/instances/{id}/clone-to-prod?change_reason=… (ir:approve)
GET  /integration-registry/instances/{id}/history
```

### Encryption Settings (admin)
```
GET  /integration-registry/settings
POST /integration-registry/settings/unlock           (ir:admin)
POST /integration-registry/settings/lock             (ir:admin)
```

### Sub-resources (Endpoints & Route Hops)
```
POST   /integration-registry/instances/{id}/endpoints
PUT    /integration-registry/instances/{id}/endpoints/{ep_id}
DELETE /integration-registry/instances/{id}/endpoints/{ep_id}
POST   /integration-registry/instances/{id}/route-hops
PUT    /integration-registry/instances/{id}/route-hops/{hop_id}
DELETE /integration-registry/instances/{id}/route-hops/{hop_id}
```

### Audit Log
```
GET /integration-registry/audit-log       ?entity_type=&entity_id=&page=&page_size=
```

### Dictionaries
```
GET   /integration-registry/dictionaries
GET   /integration-registry/dictionaries/{key}/items          ?active_only=true
POST  /integration-registry/dictionaries/{key}/items          (ir:write; dictionary must be is_addable=true)
PATCH /integration-registry/dictionaries/{key}/items/{id}     (ir:write)
```

### Column Preferences
```
GET /integration-registry/grid-prefs/{grid_key}
PUT /integration-registry/grid-prefs/{grid_key}
```
`grid_key` is currently `connections`. Stores `visible_columns` as a JSON array.

---

## Dictionaries (Seed Data)

The migration seeds the following global dictionaries:

| Key                | Addable | Seed Items                                     |
|--------------------|---------|------------------------------------------------|
| `environment`      | No      | UAT, PROD                                      |
| `service_type`     | No      | HTTP API, Database, Message Broker, gRPC, SFTP |
| `network_zone`     | No      | Private, Public, Hybrid                        |
| `datacenter`       | Yes     | MK-DC1, RO-DC1, EU-WEST                        |
| `owner_team`       | Yes     | (empty — add your own)                         |
| `auth_method`      | Yes     | None, Basic Auth, Bearer, OAuth2, mTLS, API Key|
| `connection_status`| No      | draft, active, disabled, deprecated            |

---

## Running the Migration

```bash
cd backend
alembic upgrade 0028_integration_registry_schema
```

> **Note**: The migration attempts to enable `pg_trgm` and create a trigram GIN index on `ir_endpoint.fqdn` for fast substring search. If the DB user cannot create extensions (common in hosted Postgres), the migration will **skip** this index and continue.

---

## Enabling the Module for a Tenant

Integration Registry is **not** in the default module set. Enable it for a tenant via the admin console or directly:

```sql
INSERT INTO tenant_modules (id, tenant_id, module_key, is_active, created_at)
VALUES (gen_random_uuid(), '<tenant-id>', 'integration_registry', true, now());
```

Then assign the appropriate IR role to users via the Users page.

---

## Security Notes

- **No secrets stored**: `vault_ref` is a path reference only. Ensure your team understands this convention.
- **RLS enforced at DB level**: Even if application code has a bug, PostgreSQL prevents cross-tenant data access.
- **PROD writes require `ir:approve`**: Editors can only modify UAT. PROD changes require an Approver or Admin.
- **Every write is audited**: `change_reason` is required on all creates and updates. Audit records are immutable (no UPDATE/DELETE on `ir_audit_log`).

---

## Development Notes

- Module backend lives in: `backend/app/models/integration_registry.py`, `backend/app/schemas/integration_registry.py`, `backend/app/services/integration_registry_service.py`, `backend/app/api/v1/endpoints/integration_registry.py`
- Frontend pages: `frontend/app/(app)/integration-registry/`
- Frontend components: `frontend/components/integration-registry/`
- All dropdowns that are `is_addable=true` use the `SingleSelect` component with `creatable` prop, which POSTs to `/dictionaries/{key}/items` and auto-selects the new item.
