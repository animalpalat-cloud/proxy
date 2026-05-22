# OpenRelay API Server

Express backend for the web proxy / unblocker. Runs separately from the Next.js app in `../my-app`.

## Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env — add IPRoyal credentials (never commit .env)
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
| `API_PUBLIC_URL` | Full base URL browsers use to open the proxied tab (default `http://localhost:PORT`) |
| `IPROYAL_HOST`, `IPROYAL_PORT`, `IPROYAL_USERNAME`, `IPROYAL_PASSWORD` | IPRoyal Web Unblocker endpoint |
| `IPROYAL_SCHEME` | Usually `http` for the proxy URI to IPRoyal (default `http`) |
| `IPROYAL_APPEND_COUNTRY` | `"true"` to append `_country-xx` to username for geo (maps `uk` → `gb`) |

If `API_PUBLIC_URL` does not match where users load the API (e.g. tunneled host), the “open in new tab” link will be wrong — set it to the public origin of this server.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| POST | `/api/unblock` | Validate URL, probe target **via IPRoyal**, create session, return `viewerUrl` |
| GET | `/api/proxy/view?session=<id>` | Stream the target page HTML/body through IPRoyal (browser opens this URL) |

### POST `/api/unblock`

**Body**

```json
{
  "url": "https://example.com",
  "region": "us"
}
```

**Success (200)** — strict shape for the Next.js client:

```json
{
  "success": true,
  "data": {
    "targetUrl": "https://example.com/",
    "viewerUrl": "http://localhost:8000/api/proxy/stream-or-view?session=..."
  }
}
```

Open `viewerUrl` in a new tab to stream the page through IPRoyal (`GET /api/proxy/stream-or-view?session=…`; legacy alias: `/api/proxy/view`).

**Errors**

- **400** — invalid or missing URL.
- **502** — probe through IPRoyal failed (blocked site, bad credentials, timeout).
- **503** — IPRoyal env variables not set.

## Limitations

- The viewer streams the **top-level document** only. Relative CSS/JS/images may still load from the original origins unless you add HTML/asset rewriting or a full MITM proxy in a later phase.
- Do **not** disable TLS verification globally in production. Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0` unless a vendor explicitly requires it for debugging.

## Security

- Store IPRoyal secrets only in `.env` on the server; rotate credentials if they were exposed.
- Sessions expire after one hour (see `src/lib/sessions.js`).
