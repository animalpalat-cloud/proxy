# OpenRelay API Server

Express backend for the web proxy / unblocker. Runs separately from the Next.js app in `../my-app`.

## Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env — add ProxySeller credentials (never commit .env)
```

## Run

```bash
# Development (auto-restart on file changes, Node 18+)
npm run dev

# Production-style
npm start
```

Server: **http://localhost:8000**

## Environment

| Variable | Purpose |
|----------|---------|
| `FRONTEND_URL` | CORS: origin(s) of the Next.js app (e.g. `http://localhost:3000`) |
| `API_PUBLIC_URL` | Full base URL browsers use to open the proxied tab |
| `PROXYSELLER_HOST`, `PROXYSELLER_HTTP_PORT`, `PROXYSELLER_USERNAME`, `PROXYSELLER_PASSWORD` | ProxySeller HTTP proxy endpoint |
| `PROXYSELLER_SCHEME` | Usually `http` for the proxy URI (default `http`) |
| `PROXYSELLER_APPEND_COUNTRY` | When not `false`, login becomes `{user}_c_{CC}` for geo (maps `uk` → `GB`) |
| `PROXYSELLER_AUTH_IP` | Your VPS IP whitelisted in ProxySeller (reference; not sent in requests) |

If `API_PUBLIC_URL` does not match where users load the API, the “open in new tab” link will be wrong — set it to the public origin of this server.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| POST | `/api/unblock` | Validate URL, probe target **via ProxySeller**, create session, return `viewerUrl` |
| GET | `/api/proxy/view?session=<id>` | Stream the target page through ProxySeller (browser opens this URL) |
| GET | `/api/proxy/resource?session=<id>&url=<encoded>` | Proxied assets (CSS, JS, images, HLS, video segments) |

### POST `/api/unblock`

**Body**

```json
{
  "url": "https://example.com",
  "region": "us"
}
```

**Success (200)**

```json
{
  "success": true,
  "data": {
    "targetUrl": "https://example.com/",
    "viewerUrl": "http://localhost:8000/api/proxy/stream-or-view?session=..."
  }
}
```

Open `viewerUrl` in a new tab (`GET /api/proxy/stream-or-view?session=…`; legacy alias: `/api/proxy/view`).

**Errors**

- **400** — invalid or missing URL.
- **502** — probe through ProxySeller failed (blocked site, bad credentials, timeout).
- **503** — ProxySeller env variables not set.

## Security

- Store ProxySeller secrets only in `.env` on the server; rotate credentials if they were exposed.
- Whitelist your server’s outbound IP in the ProxySeller dashboard (`PROXYSELLER_AUTH_IP`).
- Sessions expire after one hour (see `src/lib/sessions.js`).
