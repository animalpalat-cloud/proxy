# Recovery notes (ProxySeller + YouTube stack)

This restore replaces the reverted codebase with the full **ProxySeller** proxy engine (not Ultraviolet).

## Restored server files

| File | Purpose |
|------|---------|
| `src/lib/proxySeller.js` | Thailand auto-rotate, 3× ECONNRESET retry, keepAlive off, googlevideo stream detection |
| `src/lib/upstreamHeaders.js` | CORS allowlist, YouTube headers, CSP strip on proxy responses |
| `src/lib/youtubeProxy.js` | googlevideo streaming headers, IP header strip |
| `src/lib/htmlRewrite.js` | URL rewrite, `<base>` strip, YouTube/JSON/JS rewrites, runtime `gw()` |
| `src/lib/cookieJar.js` | Session cookie isolation |
| `src/lib/sessions.js` | Sessions + cookie integration |
| `src/middleware/youtubeResourceProxy.js` | Stream pipe, buffered rewrite, sendBuffered |
| `src/routes/proxyView.js` | `/api/proxy/resource` + viewer |
| `src/routes/unblock.js` | Auto mode, probe retries, FRONTEND_URL viewer |
| `src/app.js` | Fixed CORS (`CORS_ALLOW_HEADERS`) |

## Restored frontend

- `ProxyInputBar.tsx` — no US/UK/DE picker; **All Regions (auto)**
- `FaqSection.tsx`, `HowItWorksSection.tsx`, `HeroSection.tsx`
- `next.config.ts` + `app/api/proxy/[...path]/route.ts` — long-timeout proxy to Express

## Run

```powershell
cd server
npm install
npm run dev

cd ..\my-app
npm run dev
```

## `.env` checklist

- `PROXYSELLER_AUTH_IP=116.71.185.232` (whitelist in ProxySeller dashboard)
- `PROXYSELLER_APPEND_COUNTRY=false`
- `FRONTEND_URL` + `API_PUBLIC_URL` = `http://localhost:3000`
- `my-app/.env.local`: `BACKEND_URL=http://127.0.0.1:8000`
