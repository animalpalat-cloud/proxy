# OpenRelay — Ubuntu VPS deployment guide

Deploy the **Express API** (port `8000`) and **Next.js** (port `3000`) behind **Nginx**, managed by **PM2**. All public URLs come from environment variables — no hardcoded domains in code.

## Architecture

```text
Internet → Nginx (:80/:443)
            ├─ /        → Next.js (127.0.0.1:3000)
            └─ /api/    → Express (127.0.0.1:8000)
```

Optional: API on `api.yourdomain.com` instead of `/api` on the main host.

---

## 1. Server prerequisites (Ubuntu 22.04+)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx ufw build-essential
```

### Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
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
cd server && npm ci --omit=dev
cd ../my-app && npm ci && npm run build
cd ..
```

---

## 3. Backend environment (`server/.env`)

```bash
cp server/.env.example server/.env
nano server/.env
```

**Production template** (replace placeholders):

```env
NODE_ENV=production
PORT=8000
BIND_HOST=127.0.0.1

# Public URL users open in the browser for proxied pages
API_PUBLIC_URL=https://YOUR_DOMAIN

# Next.js origin(s) for CORS (comma-separated if multiple)
FRONTEND_URL=https://YOUR_DOMAIN

IPROYAL_HOST=unblocker.iproyal.com
IPROYAL_PORT=12323
IPROYAL_USERNAME=your_iproyal_username
IPROYAL_PASSWORD=your_iproyal_password
IPROYAL_SCHEME=http
IPROYAL_TLS_INSECURE=true
IPROYAL_MAX_RETRIES=3
IPROYAL_REQUEST_TIMEOUT_MS=90000
```

**Rules**

| Variable | Value |
|----------|--------|
| `API_PUBLIC_URL` | `https://YOUR_DOMAIN` if Nginx serves `/api` on the same host, or `https://api.YOUR_DOMAIN` if API is on a subdomain |
| `FRONTEND_URL` | `https://YOUR_DOMAIN` (must match the browser origin of the Next app) |
| `IPROYAL_HOST` | `unblocker.iproyal.com` only (no `http://`) |
| `IPROYAL_PORT` | `12323` for Web Unblocker |

Proxy connection string (for reference):

```text
http://IPROYAL_USERNAME:IPROYAL_PASSWORD@unblocker.iproyal.com:12323
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

```bash
sudo cp deploy/nginx/openrelay.conf.example /etc/nginx/sites-available/openrelay
sudo nano /etc/nginx/sites-available/openrelay
# Replace YOUR_DOMAIN with your real domain

sudo ln -sf /etc/nginx/sites-available/openrelay /etc/nginx/sites-enabled/
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
curl -sS "https://YOUR_DOMAIN/api/health"
# {"success":true,"status":"ok"}

curl -sS -X POST "https://YOUR_DOMAIN/api/unblock" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","region":"us"}'
```

Open the site in a browser, submit a URL, and confirm the new tab loads `/api/proxy/stream-or-view?session=...`.

---

## 8. IPRoyal proxy client (Phase 1 summary)

- **Removed undici** — all proxy traffic uses **axios + `tunnel`** (keep-alive agents, desktop User-Agent, MITM TLS off).
- **Fallback:** `https-proxy-agent` if `tunnel` fails.
- **Retries:** `IPROYAL_MAX_RETRIES` for `ECONNRESET` on protected sites.

---

## 9. Troubleshooting

| Symptom | Check |
|---------|--------|
| `API_PUBLIC_URL is not set` | Set in `server/.env`, restart `openrelay-api` |
| CORS errors | `FRONTEND_URL` must exactly match the Next.js origin |
| 404 on `/api/unblock` | Nginx `location /api/` → port `8000`, PM2 `openrelay-api` running |
| `ECONNRESET` | Increase `IPROYAL_REQUEST_TIMEOUT_MS`, confirm `IPROYAL_TLS_INSECURE=true` |
| `next build` fails | Set `BACKEND_URL` in `.env.production` |

---

## 10. Updating the app

```bash
cd /var/www/openrelay
git pull
cd server && npm ci --omit=dev
cd ../my-app && npm ci && npm run build
pm2 restart all
```
