# OpenRelay — Ubuntu VPS deployment guide

Deploy the **Rust Bare server** (port `8000`) and **Next.js + Ultraviolet** (port `3000`) behind **Nginx**, managed by **PM2**.

## Architecture

```text
Internet → Nginx (:80/:443)
            ├─ /        → Next.js (127.0.0.1:3000) — UV static + UI
            └─ /bare/   → rust-server (127.0.0.1:8000) — TompHTTP Bare v3 + SOCKS5
```

The legacy `server/` Express app is **not used** in this stack.

---

## 1. Server prerequisites (Ubuntu 22.04+)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx ufw build-essential
```

### Install Node.js 20 LTS and Rust

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V
```

### Install PM2 globally

```bash
sudo npm install -g pm2
pm2 -v
```

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 2. Clone and install dependencies

```bash
cd /var/www
sudo mkdir -p openrelay && sudo chown "$USER:$USER" openrelay
cd openrelay
git clone YOUR_REPO_URL .
cd rust-server && cp .env.example .env && cargo build --release
cd ../my-app && npm ci && npm run build
cd ..
```

---

## 3. Rust Bare environment (`rust-server/.env`)

```bash
cp rust-server/.env.example rust-server/.env
nano rust-server/.env
```

**Production template** (replace placeholders):

```env
# Rust is internal-only — bound to loopback, reached via Next.js middleware.
BIND_HOST=127.0.0.1
PORT=8000
RUST_LOG=info,openrelay_bare=debug

PROXYSELLER_HOST=148.113.49.124
PROXYSELLER_SOCKS_PORT=51093
PROXYSELLER_USERNAME=your_proxy_login
PROXYSELLER_PASSWORD=your_proxy_password
PROXY_REQUEST_TIMEOUT_SECS=120
PROXY_CONNECT_TIMEOUT_SECS=30
PROXY_RETRY_ON_RESET=true
```

**Rules**

| Variable | Value |
|----------|--------|
| `API_PUBLIC_URL` | `https://YOUR_DOMAIN` if Nginx serves `/api` on the same host, or `https://api.YOUR_DOMAIN` if API is on a subdomain |
| `FRONTEND_URL` | `https://YOUR_DOMAIN` (must match the browser origin of the Next app) |
| `PROXYSELLER_HOST` | Proxy IP or hostname only (no `http://`) |
| `PROXYSELLER_HTTP_PORT` | HTTP proxy port (e.g. `41093`) |
| `PROXYSELLER_AUTH_IP` | Whitelist your VPS outbound IP in the ProxySeller dashboard |

Proxy connection string (for reference):

```text
http://PROXYSELLER_USERNAME:PROXYSELLER_PASSWORD@PROXYSELLER_HOST:PROXYSELLER_HTTP_PORT
```

---

## 4. Frontend environment (`my-app`)

### Production build on the VPS

```bash
cp my-app/.env.production.example my-app/.env.production
nano my-app/.env.production
```

**Same-domain deployment** (Nginx routes `/api` to Express):

```env
BACKEND_URL=http://127.0.0.1:8000
# NEXT_PUBLIC_API_URL unset — browser uses same origin + /api
```

**Subdomain API** (`api.YOUR_DOMAIN`):

```env
BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_URL=https://api.YOUR_DOMAIN
```

Then rebuild:

```bash
cd my-app && npm run build
```

### Local development (optional)

```bash
cp my-app/.env.local.example my-app/.env.local
```

```env
BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

And in `server/.env` for local dev:

```env
API_PUBLIC_URL=http://127.0.0.1:8000
FRONTEND_URL=http://127.0.0.1:3000
```

---

## 5. Start with PM2

From the repo root:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# run the command PM2 prints, then:
pm2 save
```

Useful commands:

```bash
pm2 status
pm2 logs openrelay-api
pm2 logs openrelay-web
pm2 restart all
```

---

## 6. Nginx reverse proxy

`/bare/` **must** reach Rust on port `8000`. If it goes to Next.js instead, you get `308` with `location: /bare` and bare-mux times out.

```bash
sudo cp deploy/nginx/daddyproxy.com.conf.example /etc/nginx/sites-available/daddyproxy
sudo nano /etc/nginx/sites-available/daddyproxy
# Set server_name to your domain

sudo ln -sf /etc/nginx/sites-available/daddyproxy /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### HTTPS with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

After HTTPS, set in `server/.env`:

```env
API_PUBLIC_URL=https://YOUR_DOMAIN
FRONTEND_URL=https://YOUR_DOMAIN
```

Restart API:

```bash
pm2 restart openrelay-api
```

---

## 7. Verify deployment

```bash
# Rust Bare (direct)
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/bare/
# expect 200

# Public Bare manifest — must be 200, NOT 308
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/bare/
# expect 200

curl -sS https://YOUR_DOMAIN/bare/ | head -c 120
# {"versions":["v2","v3"],...}

curl -sSI https://YOUR_DOMAIN/bare/ | grep -iE '^(HTTP|location):'
# HTTP/1.1 200 — if you see "location: /bare" the request hit Next without Nginx /bare/ routing
```

Open the site, submit a URL, and confirm the proxied tab loads under `/uv/service/...`.

---

## 8. ProxySeller proxy client

- All upstream traffic uses **axios + `tunnel`** (keep-alive agents, desktop User-Agent).
- **Fallback:** `https-proxy-agent` if `tunnel` fails.
- **Geo:** optional `{login}_c_{CC}` suffix on ProxySeller username (`PROXYSELLER_APPEND_COUNTRY`).
- **Assets:** HTML/CSS/JS/HLS/video via `/api/proxy/resource` with URL rewriting.

---

## 9. Troubleshooting

| Symptom | Check |
|---------|--------|
| `curl /bare` returns **502** with HTML body | Nginx has a stale `location /bare*` block proxying directly to Rust (bypassing Next). Remove those blocks — the catch-all `location /` is the only block needed; Next's `middleware.ts` proxies /bare → Rust internally. Reload nginx. |
| `bare-mux setTransport timed out` | Confirm `openrelay-bare` running (`pm2 logs openrelay-bare`); confirm `curl -i http://127.0.0.1:8000/bare/` returns 200. |
| CORS on Bare | Not applicable — Rust is internal-only; browser never reaches it directly. CORS is permissive (`Any`) by design. |
| `next build` fails | Set `RUST_BARE_URL=http://127.0.0.1:8000` in PM2 / `.env.production` |
| `BIND_HOST=... is not a loopback` warning at startup | Rust forces 127.0.0.1 anyway; set `BIND_HOST=127.0.0.1` in `rust-server/.env` to silence the warning. |

---

## 10. Updating the app

```bash
cd /home/devnigga/proxy   # or your clone path
git pull
cd rust-server && cargo build --release
cd ../my-app && npm ci && npm run build
pm2 restart all
sudo nginx -t && sudo systemctl reload nginx
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/bare/
```
