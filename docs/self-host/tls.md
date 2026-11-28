# TLS configuration

The redcolumn web app and desktop app require a valid HTTPS connection (secure context) for WebCrypto, service workers, and `Secure` session cookies. Neither client provides an option to ignore certificate errors.

The Compose bundle includes three Caddy configurations under `services/server/deploy/caddy/`. Select one by setting `CADDY_MODE` in `.env`.

---

## Mode 1: Organisation CA (`CADDY_MODE=org-ca`)

Use this mode when your organisation operates an internal PKI (for example Active Directory Certificate Services) whose root CA is already distributed to staff computers.

1. Issue a server certificate for your `REDCOLUMN_DOMAIN` (including the hostname in the Subject Alternative Name extension).
2. Create `./certs/` inside `services/server/deploy/` and copy the full certificate chain and private key into it:
   ```bash
   mkdir -p certs
   cp /path/to/fullchain.pem certs/server.crt
   cp /path/to/privkey.pem certs/server.key
   chmod 600 certs/server.key
   ```
3. Set in `.env`:
   ```dotenv
   CADDY_MODE=org-ca
   REDCOLUMN_DOMAIN=review.northbridge.example
   TLS_CERTS_DIR=./certs
   TLS_CERT_FILE=/etc/caddy/certs/server.crt
   TLS_KEY_FILE=/etc/caddy/certs/server.key
   ```
4. Start or reload Caddy:
   ```bash
   docker compose up -d caddy
   ```

When renewing the certificate, replace `certs/server.crt` and `certs/server.key` and reload Caddy:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## Mode 2: ACME DNS-01 (`CADDY_MODE=dns01`)

Use this mode when you have a real domain name (for example `review.northbridge.example`) pointing to a private LAN IP address, so the server is **not** reachable from the public internet. Caddy proves domain ownership by creating a temporary DNS TXT record via your DNS provider's API and obtains a publicly trusted Let's Encrypt certificate.

1. Build a Caddy image that includes your DNS provider plugin using the provided `Dockerfile.caddy-dns01` (replace `cloudflare` with your provider module name under `github.com/caddy-dns/` if different):
   ```bash
   docker build \
     -f caddy/Dockerfile.caddy-dns01 \
     --build-arg CADDY_DNS_PLUGIN=cloudflare \
     -t redcolumn-caddy-dns01:local \
     caddy/
   ```
2. If you use a provider other than Cloudflare, update the `dns` line in `caddy/Caddyfile.dns01` to match that plugin's configuration.
3. Set in `.env`:
   ```dotenv
   CADDY_MODE=dns01
   CADDY_IMAGE=redcolumn-caddy-dns01:local
   REDCOLUMN_DOMAIN=review.northbridge.example
   ACME_EMAIL=it-ops@northbridge.example
   DNS_PROVIDER_API_TOKEN=<scoped-api-token>
   ```
4. Start Caddy:
   ```bash
   docker compose up -d caddy
   ```

Caddy stores the issued certificate in the `caddy_data` volume and renews it automatically.

---

## Mode 3: Caddy internal CA (`CADDY_MODE=internal-ca`)

Use this mode for LAN trials when you do not have an organisation CA or a public domain name. Caddy creates a local root CA inside `caddy_data` and issues certificates for `REDCOLUMN_DOMAIN`.

1. Set in `.env`:
   ```dotenv
   CADDY_MODE=internal-ca
   REDCOLUMN_DOMAIN=review.lan.internal
   ```
2. Start the stack so Caddy generates its local root CA:
   ```bash
   docker compose up -d
   ```
3. Export Caddy's root certificate:
   ```bash
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./redcolumn-root-ca.crt
   ```
4. Install `redcolumn-root-ca.crt` into the OS trust store on every client machine that will connect to the server:

### Windows

Run from an elevated PowerShell or Command Prompt (or distribute via Group Policy under *Computer Configuration › Policies › Windows Settings › Security Settings › Public Key Policies › Trusted Root Certification Authorities*):

```powershell
certutil -addstore -f "ROOT" .\redcolumn-root-ca.crt
```

### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./redcolumn-root-ca.crt
```

### Linux (Debian / Ubuntu)

```bash
sudo cp ./redcolumn-root-ca.crt /usr/local/share/ca-certificates/redcolumn-root-ca.crt
sudo update-ca-certificates
```

### Linux (RHEL / Fedora)

```bash
sudo cp ./redcolumn-root-ca.crt /etc/pki/ca-trust/source/anchors/redcolumn-root-ca.crt
sudo update-ca-trust
```

Restart open browsers (and the redcolumn desktop app) after installing the root certificate. If you use Firefox on Linux or Windows, enable enterprise root certificates (`security.enterprise_roots.enabled = true`) or import `redcolumn-root-ca.crt` under Firefox Settings › Privacy & Security › Certificates.
