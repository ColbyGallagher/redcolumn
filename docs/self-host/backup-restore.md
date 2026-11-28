# Backup, restore, and upgrades

## How backups work

`redcolumn-admin backup` writes a self-contained directory containing:

- `database.dump` — a PostgreSQL custom-format dump (`pg_dump -Fc`), taken **first**.
- `blobs/` — a copy of every file under `BLOB_DIR` (for example `projects/<project-id>/<sha256>`), copied **after** the database dump. Because blobs are immutable and content-addressed, every blob referenced by the dump is guaranteed to be present.
- `manifest.json` — timestamp, applied schema migrations, and SHA-256 checksums + byte sizes for `database.dump` and every blob.

Store backups off-host (for example on a separate NAS or encrypted object storage). If your environment requires encryption at rest, encrypt the backup directory with your organisation's backup tool before shipping it off-host.

---

## Taking a backup

From `services/server/deploy/`, run the helper script with a fresh output path:

```bash
./backup.sh /srv/backups/redcolumn-$(date +%F-%H%M)
```

Or invoke `redcolumn-admin` directly inside the `server` container:

```bash
docker compose exec -T server redcolumn-admin backup --out /tmp/backup-out
```

---

## Verifying a live server

Run `redcolumn-admin verify` periodically (and after every restore or upgrade):

```bash
docker compose exec server redcolumn-admin verify
```

`verify` checks:

1. Database connectivity.
2. Migration status (no pending, modified, or unknown migrations).
3. Every asset row in `assets` has a matching file in `BLOB_DIR` with the exact byte size and SHA-256 hash.
4. Row counts across core tables.
5. Event stream sequence monotonicity (`seq` strictly increasing per stream and consistent with `streams.seq`).

It exits `0` when all checks pass and non-zero if any problem is found.

---

## Restoring from a backup

> **Warning:** Restoring replaces the current database contents and copies backup blobs into `BLOB_DIR`. Stop incoming traffic first so clients cannot write during the restore.

1. Stop Caddy so no clients can connect while the restore runs:
   ```bash
   docker compose stop caddy
   ```
2. Run the restore script with `--yes` to confirm:
   ```bash
   ./restore.sh /srv/backups/redcolumn-2026-11-28-0200 --yes
   ```
   `redcolumn-admin restore` validates `manifest.json` and every SHA-256 checksum before touching the database, runs `pg_restore --clean --if-exists`, restores the blobs into `BLOB_DIR`, and automatically runs `verify` at the end.
3. Start Caddy again:
   ```bash
   docker compose start caddy
   ```

---

## Upgrading the server

1. **Take a backup first:**
   ```bash
   ./backup.sh /srv/backups/pre-upgrade-$(date +%F-%H%M)
   ```
2. **Pull or check out the new release** and rebuild/pull the server image:
   ```bash
   git fetch --tags
   git checkout <new-tag>
   cd services/server/deploy
   docker compose up -d --build
   ```
   (If you use a prebuilt image via `REDCOLUMN_SERVER_IMAGE`, update the tag in `.env` and run `docker compose pull && docker compose up -d`.)
3. **Check migrations and integrity:**
   ```bash
   docker compose exec server redcolumn-admin migrate --check
   docker compose exec server redcolumn-admin verify
   ```

> **Note on downgrades:** Migrations are forward-only. If you attempt to start an older server build against a database migrated by a newer build, startup and `migrate --check` refuse to proceed with an unknown-migration error. To roll back, restore the pre-upgrade backup taken in step 1.
