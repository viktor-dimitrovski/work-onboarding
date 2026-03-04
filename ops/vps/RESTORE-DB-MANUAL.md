# Manual DB restore on the VPS (step-by-step)

Use this when you have the dump on the server and want to restore it by hand (e.g. after fixing config or to see errors clearly).

---

## What you need

- SSH access to the VPS as `deploy` (or your `OPS_SSH_USER`).
- The dump file on the server, e.g.  
  `/var/backups/solvebox-hub/db/solvebox-hub-20260304_022542.dump`
- DB config on the server (see Step 0).

---

## Step 0: Make sure DB config exists on the server

The restore script needs the database name, user, and password. It looks in two places (in order):

1. **`/opt/apps/solvebox-hub/deploy/ubuntu/deploy.env`**  
   Must contain:
   - `DB_NAME=...` (e.g. `solvebox-hub`)
   - `DB_USER=...` (e.g. `solvebox_hub_app`)
   - `DB_PASSWORD=...`

2. **Or** `/etc/solvebox/backend.env`  
   Must contain:
   - `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE_NAME`

If neither file exists or is incomplete, create one. Example for `deploy.env`:

```bash
# On the server, create the file (adjust values to match your real DB):
sudo mkdir -p /opt/apps/solvebox-hub/deploy/ubuntu
sudo nano /opt/apps/solvebox-hub/deploy/ubuntu/deploy.env
```

Put something like (change to your real DB name/user/password):

```
DB_NAME=solvebox-hub
DB_USER=solvebox_hub_app
DB_PASSWORD=your_actual_db_password
POSTGRES_OS_USER=postgres
```

Save and exit (in nano: Ctrl+O, Enter, Ctrl+X).

---

## Step 1: Connect to the VPS

From your **Windows PC** (cmd or PowerShell), or from Git Bash:

```bash
plink -i "C:\Users\viktor\.ssh\hetzner_deploy.ppk" deploy@46.62.200.124
```

(Replace the key path and IP/host if yours are different. Use your real VPS address.)

You should see a shell prompt like:

```
deploy@ubuntu-1:~$
```

---

## Step 2: Go to the app directory

```bash
cd /opt/apps/solvebox-hub
```

Check that the restore script is there:

```bash
ls -la ops/vps/restore-db.sh
```

You should see the file listed.

---

## Step 3: Check the dump file exists

```bash
ls -la /var/backups/solvebox-hub/db/solvebox-hub-20260304_022542.dump
```

If you see "No such file or directory", the path or filename is wrong. List the backup dir:

```bash
ls -la /var/backups/solvebox-hub/db/
```

Use the exact filename you see (e.g. `solvebox-hub-upload-20260304_022542.dump` if that’s what’s there).

---

## Step 4: Run the restore script

**Important:** Run from the app root (`/opt/apps/solvebox-hub`), and use the **full path** to the dump.

```bash
cd /opt/apps/solvebox-hub
sudo bash ops/vps/restore-db.sh --dump /var/backups/solvebox-hub/db/solvebox-hub-20260304_022542.dump --force
```

If your dump has a different name (from the `ls` in Step 3), use that name instead of `solvebox-hub-20260304_022542.dump`.

---

## Step 5: Watch the output

You should see lines like:

- Loading config from ...
- Creating safety backup of current DB ...
- Stopping services ...
- Terminating connections ...
- Dropping database ...
- Creating database ...
- Restoring dump ...
- Restore completed.

If you see **FATAL ERROR** or **DB config not resolved**, go back to Step 0 and fix the config file, then run Step 4 again.

---

## Step 6: (Optional) Check the database

```bash
sudo -u postgres psql -d solvebox-hub -c "\dt"
```

(Use your real `DB_NAME` instead of `solvebox-hub` if different.) You should see a list of tables.

---

## Quick copy-paste (all in one)

After you’re logged in as `deploy` on the VPS:

```bash
cd /opt/apps/solvebox-hub
sudo bash ops/vps/restore-db.sh --dump /var/backups/solvebox-hub/db/solvebox-hub-20260304_022542.dump --force
```

If the dump filename is different, change the `--dump` path to match what you see in `/var/backups/solvebox-hub/db/`.
