# Водич за deployment — по ред (македонски)

Едноставен, еден клик deployment: **build локално → качи → рестарт**. Нема git на сервер, нема лозинки за база на серверот.

---

## 1. Три скрипти — тоа е сè

| Скрипта (двоен клик или cmd) | Кога се користи |
|-----------------------------|-----------------|
| **run-deploy-backend.bat** | Кога менуваш backend (Python) код. |
| **run-deploy-frontend.bat** | Кога менуваш frontend (Next.js) код. |
| **run-migrate.bat** | Кога има **нови миграции** по нов backend deploy. |
| **run-db-sync.bat** | Еднаш, за прва копија на базата. По ова не е потребно. |

**Редослед кога deployuvaš нова верзија:**

```
1. run-deploy-backend.bat
2. run-migrate.bat          ← само ако има нови миграции
3. run-deploy-frontend.bat
```

---

## 2. Подготовка (еднократно, само на твојот компјутер)

### 2.1 Конфиг: `ops/ops.env`

```text
copy ops\ops.env.example ops\ops.env
```

Отвори `ops\ops.env` и пополни:

| Променлива | Пример | За што |
|------------|--------|--------|
| `OPS_SSH_HOST` | `46.62.200.124` | IP на VPS |
| `OPS_SSH_USER` | `deploy` | SSH корисник |
| `OPS_SSH_PORT` | `22` | SSH порт |
| `OPS_SSH_KEYFILE` | `C:\Users\viktor\.ssh\key.ppk` | Патека до .ppk клуч |
| `OPS_REMOTE_APP_DIR` | `/opt/apps/solvebox-hub` | Каде е апликацијата на серверот |
| `OPS_BACKEND_SERVICE` | `solvebox-hub-backend` | Ime на systemd сервис за backend |
| `OPS_FRONTEND_SERVICE` | `solvebox-hub-frontend` | Ime на systemd сервис за frontend |
| `OPS_APP_USER` | `solvebox-hub` | Linux корисник под кој работи апп |
| `OPS_REMOTE_BACKEND_ENV` | `/etc/solvebox-hub/backend.env` | Патека до backend.env на серверот |
| `OPS_LOCAL_DATABASE_URL` | `postgresql://user:pass@127.0.0.1:5432/db` | Локална база (за db-sync) |
| `OPS_REMOTE_BACKUP_DIR` | `/var/backups/solvebox-hub/db` | Каде се ставаат dump-овите |

Овој фајл **останува само на твојот компјутер**. Не го копираш на сервер.

### 2.2 Без повторни лозинки — Pageant

Ако `.ppk` клучот има лозинка:

1. Стартувај **Pageant** (`C:\Program Files\PuTTY\pageant.exe`).
2. Десен клик на иконата во system tray → **Add Key** → избери `.ppk` → внеси лозинка еднаш.
3. Остави го отворен. Скриптите нема да бараат лозинка повеќе.

---

## 3. Како работат скриптите

### run-deploy-backend.bat

1. `tar` — пакира `backend/` локално (без `__pycache__`, `.venv`, `.env`).
2. `pscp` — качува архивата на `/tmp/` на серверот.
3. SSH: extract → `pip install -r requirements.txt` → `systemctl restart <backend-service>`.

### run-deploy-frontend.bat

1. `npm run build` — билд на Next.js **standalone** (локално, на твојот компјутер).
2. Копира `.next/static` и `public/` во standalone директориумот.
3. `pscp` — качува компактна архива (без `node_modules`).
4. SSH: extract → `systemctl restart <frontend-service>`.

### run-migrate.bat

1. SSH на серверот.
2. `alembic upgrade head` во `backend/`.
3. Готово.

### run-db-sync.bat

1. `pg_dump` — прави dump локално.
2. `pscp` — качува dump на `OPS_REMOTE_BACKUP_DIR`.
3. SSH: пушта `ops/vps/restore-db.sh` кој ја препишува базата.

---

## 4. Прв пат — еднократна постава на серверот

Ова се прави **само еднаш**. По ова само ги користиш трите .bat скрипти.

### 4.1 Влез на серверот

```bash
# Од PuTTY или plink:
ssh deploy@46.62.200.124
```

### 4.2 Создај ги папките и конфигот

На серверот:

```bash
sudo mkdir -p /opt/apps/solvebox-hub
sudo mkdir -p /var/backups/solvebox-hub/db
sudo chown deploy:deploy /opt/apps/solvebox-hub
```

Создај конфиг за backend (ова е `/etc/solvebox-hub/backend.env` — постојан, серверски):

```bash
sudo mkdir -p /etc/solvebox-hub
sudo nano /etc/solvebox-hub/backend.env
```

Содржина на `backend.env` (прилагоди ги вредностите):

```env
DATABASE_URL=postgresql+psycopg://solvebox-hub_app:ЛОЗИНКА@127.0.0.1:5432/solvebox-hub
JWT_SECRET_KEY=некоја-долга-тајна-низа-32-chars
JWT_REFRESH_SECRET_KEY=друга-долга-тајна-низа-32-chars
APP_ENV=production
CORS_ORIGINS=https://твој-домен.com
FIRST_ADMIN_EMAIL=admin@example.com
FIRST_ADMIN_PASSWORD=СилнаЛозинка123!
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
```

Заштити го фајлот:

```bash
sudo chown root:solvebox-hub /etc/solvebox-hub/backend.env
sudo chmod 640 /etc/solvebox-hub/backend.env
```

Исто за frontend:

```bash
sudo nano /etc/solvebox-hub/frontend.env
```

```env
NEXT_PUBLIC_API_BASE_URL=/api/v1
BACKEND_API_URL=http://127.0.0.1:8001
PORT=3001
```

```bash
sudo chown root:solvebox-hub /etc/solvebox-hub/frontend.env
sudo chmod 640 /etc/solvebox-hub/frontend.env
```

### 4.3 Python venv

```bash
cd /opt/apps/solvebox-hub
python3 -m venv .venv
sudo chown -R solvebox-hub:solvebox-hub /opt/apps/solvebox-hub
```

### 4.4 Systemd сервиси

Создај `/etc/systemd/system/solvebox-hub-backend.service`:

```ini
[Unit]
Description=SolveBox Hub Backend (FastAPI)
After=network.target postgresql.service

[Service]
Type=simple
User=solvebox-hub
Group=solvebox-hub
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
User=solvebox-hub
Group=solvebox-hub
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

Активирај ги:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now solvebox-hub-backend solvebox-hub-frontend
```

### 4.5 Nginx

```bash
sudo nano /etc/nginx/sites-available/solvebox-hub.conf
```

```nginx
server {
    listen 80;
    server_name твој-домен.com _;

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/solvebox-hub.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4.6 Прва база (db-sync)

Од твојот компјутер:

```text
ops\local\run-db-sync.bat --force
```

По ова базата на серверот е идентична со локалната. **Нема потреба од миграции** — базата е веќе целосна.

---

## 5. При секој нов deployment

```text
ops\local\run-deploy-backend.bat      ← прво backend (ако има промени)
ops\local\run-migrate.bat             ← само ако има нови миграции
ops\local\run-deploy-frontend.bat     ← frontend (ако има промени)
```

---

## 6. Чеклист

**Еднократно (прв пат):**

- [ ] `ops/ops.env` пополнет на твојот компјутер.
- [ ] Pageant стартуван и `.ppk` клучот додаден.
- [ ] На серверот: `/etc/solvebox-hub/backend.env` и `frontend.env` создадени.
- [ ] На серверот: `.venv` создаден во `OPS_REMOTE_APP_DIR`.
- [ ] Systemd сервисите создадени и активирани.
- [ ] Nginx конфигуриран.
- [ ] `run-db-sync.bat --force` извршен за прва база.
- [ ] `run-deploy-backend.bat` + `run-deploy-frontend.bat` за прв код deploy.

**При секој нов deploy:**

- [ ] `run-deploy-backend.bat` (ако менуваш backend).
- [ ] `run-migrate.bat` (само ако има нови миграции).
- [ ] `run-deploy-frontend.bat` (ако менуваш frontend).
