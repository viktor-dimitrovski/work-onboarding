# VPS — Каде се наоѓа што

Краток референтен водич за локациите на сите важни фајлови и директориуми на серверот.

---

## Апликација (код)

| Што | Патека |
|-----|--------|
| Целото repo | `/opt/apps/solvebox-hub/` |
| SolveBox Hub backend (FastAPI) | `/opt/apps/solvebox-hub/backend/` |
| SolveBox Hub frontend (Next.js) | `/opt/apps/solvebox-hub/frontend/` |
| VPS deploy скрипти | `/opt/apps/solvebox-hub/ops/vps/` |

---

## Config / Env фајлови

| Што | Патека |
|-----|--------|
| Backend env | `/etc/solvebox-hub/backend.env` |
| Frontend env | `/etc/solvebox-hub/frontend.env` |
| Deploy config (DB, корисници итн.) | `/opt/apps/solvebox-hub/deploy/ubuntu/deploy.env` |

---

## Nginx

| Што | Патека |
|-----|--------|
| Config фајл | `/etc/nginx/sites-available/solvebox.org.conf` |
| Symlink (активен) | `/etc/nginx/sites-enabled/solvebox.org.conf` |
| Landing page (статичен HTML) | `/var/www/landing/` |
| Hive Planner frontend (React) | `/srv/apps/hive-planner/hive-planner-ui/current/` |
| Access лог — Hub | `/var/log/nginx/solvebox-hub-access.log` |
| Error лог — Hub | `/var/log/nginx/solvebox-hub-error.log` |
| Access лог — Planner | `/var/log/nginx/solvebox-planner-access.log` |
| Error лог — Planner | `/var/log/nginx/solvebox-planner-error.log` |
| Access лог — Landing | `/var/log/nginx/solvebox-landing-access.log` |

---

## Systemd сервиси

| Сервис | Опис | Порта |
|--------|------|-------|
| `solvebox-hub-backend` | FastAPI backend | `:8001` |
| `solvebox-hub-frontend` | Next.js frontend | `:3001` |
| `hive-planner-api` | Hive Planner .NET Kestrel | `:5000` |

Корисни команди:

```bash
sudo systemctl status solvebox-hub-backend solvebox-hub-frontend
sudo systemctl restart solvebox-hub-backend
sudo journalctl -u solvebox-hub-backend -f
```

---

## SSL сертификати

| Фајл | Патека |
|------|--------|
| Cloudflare wildcard cert | `/etc/ssl/cloudflare/solvebox.org-wildcard.crt` |
| Cloudflare wildcard key | `/etc/ssl/cloudflare/solvebox.org-wildcard.key` |

Покрива: `solvebox.org` и `*.solvebox.org`

---

## DB бекапи

| Што | Патека |
|-----|--------|
| Upload директориум (dump фајлови) | `/var/backups/solvebox-hub/db/` |

---

## Domain → Сервис мапирање

| Domain | Сервис |
|--------|--------|
| `solvebox.org` | Static HTML — `/var/www/landing/` |
| `planner.solvebox.org` | React SPA + .NET `:5000` |
| `<tenant>.solvebox.org` | Next.js `:3001` + FastAPI `:8001` |

---

## Deployment — скрипти и постапка

> Целосниот водич е во [`docs/deployment/DEPLOYMENT-MK.md`](./DEPLOYMENT-MK.md).  
> Подолу е кратко резиме за секојдневна употреба.

### Скрипти (двоен клик или cmd)

| Скрипта | Кога се користи |
|---------|-----------------|
| `ops\local\run-deploy-backend.bat` | Промени во Python (backend) код |
| `ops\local\run-deploy-frontend.bat` | Промени во Next.js (frontend) код |
| `ops\local\run-migrate.bat` | По backend deploy ако има нови Alembic миграции |
| `ops\local\run-db-sync.bat --force` | Само еднаш — прва копија на базата на сервер |

**Редослед при секој deploy:**

```
1. run-deploy-backend.bat
2. run-migrate.bat          ← само ако има нови миграции
3. run-deploy-frontend.bat
```

### Што прави секоја скрипта

| Скрипта | Чекори |
|---------|--------|
| `run-deploy-backend.bat` | `tar` пакира `backend/` → `pscp` качува на `/tmp/` → SSH: extract + `pip install` + `systemctl restart` |
| `run-deploy-frontend.bat` | `npm run build` (standalone) локално → `pscp` качува архива → SSH: extract + `systemctl restart` |
| `run-migrate.bat` | SSH → `alembic upgrade head` во `backend/` |
| `run-db-sync.bat` | `pg_dump` локално → `pscp` качува dump → SSH: `restore-db.sh` (drop + recreate + restore) |

---

## Пред прв deploy — пре-конфигурација

Ова се прави **само еднаш** при прво поставување на серверот.

### 1. `ops/ops.env` на твојот компјутер

```bash
copy ops\ops.env.example ops\ops.env
```

Пополни го фајлот:

| Променлива | Пример | За што |
|------------|--------|--------|
| `OPS_SSH_HOST` | `46.62.200.124` | IP на VPS |
| `OPS_SSH_USER` | `deploy` | SSH корисник |
| `OPS_SSH_PORT` | `22` | SSH порт |
| `OPS_SSH_KEYFILE` | `C:\Users\viktor\.ssh\key.ppk` | Патека до `.ppk` клуч |
| `OPS_REMOTE_APP_DIR` | `/opt/apps/solvebox-hub` | Каде е апликацијата на серверот |
| `OPS_BACKEND_SERVICE` | `solvebox-hub-backend` | Ime на systemd сервис за backend |
| `OPS_FRONTEND_SERVICE` | `solvebox-hub-frontend` | Ime на systemd сервис за frontend |
| `OPS_APP_USER` | `solvebox` | Linux корисник под кој работи апп |
| `OPS_REMOTE_BACKEND_ENV` | `/etc/solvebox-hub/backend.env` | Патека до backend.env на серверот |
| `OPS_LOCAL_DATABASE_URL` | `postgresql://user:pass@127.0.0.1:5432/db` | Локална база (само за db-sync) |
| `OPS_REMOTE_BACKUP_DIR` | `/var/backups/solvebox-hub/db` | Каде се ставаат dump-овите на серверот |

> Овој фајл **не се commit-ува** и **не се копира на сервер**.

### 2. Pageant (избегни повторни лозинки)

Ако `.ppk` клучот има лозинка:

1. Стартувај **Pageant** (`C:\Program Files\PuTTY\pageant.exe`)
2. Десен клик на иконата → **Add Key** → избери `.ppk` → внеси лозинка **еднаш**
3. Остави го отворен — скриптите нема да бараат лозинка

### 3. На серверот (SSH)

```bash
# Папки
sudo mkdir -p /opt/apps/solvebox-hub
sudo mkdir -p /var/backups/solvebox-hub/db
sudo mkdir -p /etc/solvebox-hub

# Корисник за апликацијата
sudo groupadd --system solvebox
sudo useradd --system --no-create-home --gid solvebox --shell /usr/sbin/nologin solvebox
sudo chown -R solvebox:solvebox /opt/apps/solvebox-hub

# Python venv
sudo bash -c 'cd /opt/apps/solvebox-hub && python3 -m venv .venv'
sudo chown -R solvebox:solvebox /opt/apps/solvebox-hub/.venv
```

### 4. `/etc/solvebox-hub/backend.env` на серверот

```bash
sudo nano /etc/solvebox-hub/backend.env
```

```env
DATABASE_URL=postgresql+psycopg://user:ЛОЗИНКА@127.0.0.1:5432/solvebox-hub
JWT_SECRET_KEY=некоја-долга-тајна-низа-32-chars
JWT_REFRESH_SECRET_KEY=друга-долга-тајна-низа-32-chars
APP_ENV=production
CORS_ORIGINS=https://твој-домен.com
BASE_DOMAINS=solvebox.org
RESERVED_SUBDOMAINS=admin,billing,docs,status,api,hub
TRUST_PROXY_HEADERS=true
FIRST_ADMIN_EMAIL=admin@example.com
FIRST_ADMIN_PASSWORD=СилнаЛозинка123!
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
BILLING_PROVIDER=stripe
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
POSTMARK_SERVER_TOKEN=your-postmark-server-token
NOTIFICATIONS_FROM_EMAIL=notifications@solvebox.org
```

```bash
sudo chown root:solvebox /etc/solvebox-hub/backend.env
sudo chmod 640 /etc/solvebox-hub/backend.env
```

### 5. `/etc/solvebox-hub/frontend.env` на серверот

```bash
sudo nano /etc/solvebox-hub/frontend.env
```

```env
NEXT_PUBLIC_API_BASE_URL=/api/v1
BACKEND_API_URL=http://127.0.0.1:8001
PORT=3001
```

```bash
sudo chown root:solvebox /etc/solvebox-hub/frontend.env
sudo chmod 640 /etc/solvebox-hub/frontend.env
```

### 6. Systemd сервиси на серверот

Создај `/etc/systemd/system/solvebox-hub-backend.service`:

```ini
[Unit]
Description=SolveBox Hub Backend (FastAPI)
After=network.target postgresql.service

[Service]
Type=simple
User=solvebox
Group=solvebox
WorkingDirectory=/opt/apps/solvebox-hub/backend
EnvironmentFile=/etc/solvebox-hub/backend.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/apps/solvebox-hub/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 3
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Создај `/etc/systemd/system/solvebox-hub-frontend.service`:

```ini
[Unit]
Description=SolveBox Hub Frontend (Next.js)
After=network.target solvebox-hub-backend.service

[Service]
Type=simple
User=solvebox
Group=solvebox
WorkingDirectory=/opt/apps/solvebox-hub/frontend
EnvironmentFile=/etc/solvebox-hub/frontend.env
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node /opt/apps/solvebox-hub/frontend/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now solvebox-hub-backend solvebox-hub-frontend
```

### 7. Прв deploy (по пре-конфигурацијата)

```bash
# Од твојот компјутер — прва база
ops\local\run-db-sync.bat --force

# Потоа прв код deploy
ops\local\run-deploy-backend.bat
ops\local\run-deploy-frontend.bat
```

---

## Чеклист — прв пат

- [ ] `ops/ops.env` пополнет на твојот компјутер
- [ ] Pageant стартуван и `.ppk` клучот додаден
- [ ] На серверот: папки и `solvebox` корисник создадени
- [ ] На серверот: `.venv` создаден
- [ ] На серверот: `/etc/solvebox-hub/backend.env` и `frontend.env` создадени
- [ ] Systemd сервисите создадени и активирани (`systemctl enable --now`)
- [ ] Nginx конфигуриран и reload-иран
- [ ] `run-db-sync.bat --force` извршен (прва база)
- [ ] `run-deploy-backend.bat` + `run-deploy-frontend.bat` извршени
