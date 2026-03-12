# Systemd units for SolveBox Hub

These service files expect a dedicated user **`solvebox`** (and group **`solvebox`**) on the VPS.  
If you used a different name (e.g. `solvebox-hub`) in your units, create that user instead.

## Fix: status=217/USER (user does not exist)

If the service fails with **`status=217/USER`**, systemd cannot find the user specified in `User=`.

### 1. Check which user your service uses

```bash
grep -E '^User=|^Group=' /etc/systemd/system/solvebox-hub-frontend.service
```

Example output: `User=solvebox` and `Group=solvebox` (or `solvebox-hub`).

### 2. Create that user and group on the VPS

If the service uses **`solvebox`** (recommended, matches deploy scripts):

```bash
sudo groupadd --system solvebox
sudo useradd --system --no-create-home --gid solvebox --shell /usr/sbin/nologin solvebox
```

If the service uses **`solvebox-hub`**:

```bash
sudo groupadd --system solvebox-hub
sudo useradd --system --no-create-home --gid solvebox-hub --shell /usr/sbin/nologin solvebox-hub
```

### 3. Fix ownership and permissions

Replace `solvebox` with your run user if different:

```bash
APP_USER=solvebox
APP_DIR=/opt/apps/solvebox-hub

# App directory: owned by the run user
sudo chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"

# Env files: readable by the run user (group = run user)
sudo chown root:${APP_USER} /etc/solvebox-hub/backend.env
sudo chown root:${APP_USER} /etc/solvebox-hub/frontend.env
sudo chmod 640 /etc/solvebox-hub/backend.env
sudo chmod 640 /etc/solvebox-hub/frontend.env
```

### 4. Reload and start

```bash
sudo systemctl daemon-reload
sudo systemctl restart solvebox-hub-backend solvebox-hub-frontend
sudo systemctl status solvebox-hub-backend solvebox-hub-frontend
```

Both should show **Active: active (running)**. Then check listeners:

```bash
ss -tlnp | grep -E '3001|8001'
```
