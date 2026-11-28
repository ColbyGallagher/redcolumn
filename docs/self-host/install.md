# Installing the self-hosted server

This guide installs the redcolumn server on a Linux host with Docker and Docker Compose. It runs three containers:

- **postgres** — PostgreSQL 17 for state, accounts, sessions, and the event log.
- **server** — the redcolumn server (`@nb/server`) and the built web app, running as a non-root user.
- **caddy** — TLS termination and reverse proxy for HTTPS and WebSockets (`wss://`).

All persistent data lives in four Docker named volumes: `pgdata`, `blobs`, `caddy_data`, and `caddy_config`.

## Prerequisites

- A Linux host with Docker Engine and Docker Compose v2 (`docker compose version`).
- A hostname that client machines can resolve to the server (for example `review.northbridge.example` or `review.lan.internal`).
- Ports `80` and `443` available on the host.
- A TLS setup for that hostname — see [TLS configuration](tls.md) before starting.

## 1. Prepare the deployment directory

Clone the repository (or check out a release tag) on the server host and move into the deploy directory:

```bash
git clone https://github.com/ColbyGallagher/redcolumn.git
cd redcolumn/services/server/deploy
```

Create `.env` from the template and restrict its permissions so other local users cannot read the database password:

```bash
cp .env.example .env
chmod 600 .env
```

Generate a strong database password (for example with `openssl rand -base64 32`) and edit `.env`:

```dotenv
REDCOLUMN_DOMAIN=review.northbridge.example
CADDY_MODE=org-ca

POSTGRES_DB=redcolumn
POSTGRES_USER=redcolumn
POSTGRES_PASSWORD=<generated-password>
DATABASE_URL=postgres://redcolumn:<generated-password>@postgres:5432/redcolumn

ALLOWED_ORIGINS=https://review.northbridge.example
COOKIE_SECURE=true
BLOB_DIR=/var/lib/redcolumn/blobs
```

Keep `COOKIE_SECURE=true` on any HTTPS deployment.

## 2. Configure TLS

Choose one of the three supported Caddy TLS modes and complete its setup in [TLS configuration](tls.md):

| `CADDY_MODE` | Best for |
|---|---|
| `org-ca` | Organisations with an internal CA whose root is already trusted by client devices |
| `dns01` | Private LANs using a real domain name and ACME DNS-01 (no inbound internet access required) |
| `internal-ca` | LAN trials using Caddy's built-in local CA (requires installing Caddy's root certificate on clients) |

## 3. Build and start the stack

```bash
docker compose up -d --build
```

Check that all three services are healthy:

```bash
docker compose ps
```

The server applies pending SQL migrations automatically on startup (`AUTO_MIGRATE=true`). Confirm the health and readiness endpoints respond inside the stack:

```bash
docker compose exec server node -e "fetch('http://127.0.0.1:3000/readyz').then(async r => console.log(r.status, await r.text()))"
```

Expected output:

```text
200 {"ok":true}
```

## 4. Create the initial admin account

Create the first administrator account with `redcolumn-admin`. Passwords are never accepted as a command-line flag; pipe the password over stdin (`--password-stdin`) or pass it via the `REDCOLUMN_ADMIN_PASSWORD` environment variable:

```bash
printf '%s\n' '<initial-admin-password>' | docker compose exec -T server \
  redcolumn-admin create-admin \
    --email ada@northbridge.example \
    --name "Ada Lovelace" \
    --password-stdin
```

## 5. Verify the installation

Run the built-in integrity check:

```bash
docker compose exec server redcolumn-admin verify
```

Confirm you can reach the server over HTTPS from a client machine:

```bash
curl -fsS https://review.northbridge.example/healthz
```

Expected output:

```json
{"ok":true}
```

If you are using `CADDY_MODE=internal-ca`, install Caddy's root certificate on the client first — see [TLS configuration](tls.md#mode-3-caddy-internal-ca-for-lan-trials).

## Routine administration

- **Check migration status:**
  ```bash
  docker compose exec server redcolumn-admin migrate --check
  ```
- **Reset a user's password** (updates the argon2id hash and revokes all active sessions for that user):
  ```bash
  printf '%s\n' '<new-password>' | docker compose exec -T server \
    redcolumn-admin reset-password \
      --email ada@northbridge.example \
      --password-stdin
  ```
- **View server logs:**
  ```bash
  docker compose logs -f server caddy
  ```
- **Back up, restore, and upgrade:** see [Backup, restore, and upgrades](backup-restore.md).
