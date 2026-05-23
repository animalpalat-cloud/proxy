# Proxy architecture (ProxySeller + UV-level server rewrite)

## Research synthesis

| Approach | Transport | Rewriting | CSP / framing |
|----------|-----------|-----------|---------------|
| **Ultraviolet** | Bare/Wisp in browser | Service worker + Parse5/Acorn client-side | Stripped in SW |
| **node-unblocker** | Node `request` | `sub_filter` on HTML + header strip | Stripped on response |
| **This stack** | **ProxySeller** (axios/tunnel) | Server `htmlRewrite` + runtime script | `responseSanitizer.js` |

All upstream HTTP(S) traffic goes through ProxySeller. The browser only talks to Next.js (`/api/proxy/*` → Express `:8000`).

## Request flow

1. `POST /api/unblock` — probe target via ProxySeller, create session + cookie jar.
2. Viewer opens `GET /api/proxy/site/<session>/` — HTML rewritten, runtime + optional SW.
3. Root-relative assets (e.g. `/s/player/...`): `GET /api/proxy/site/<session>/s/player/...`.
4. Cross-origin absolutes: `GET /api/proxy/resource?session=<id>&url=<encoded URL>`.

## ProxySeller transport and TLS

`lib/proxySeller.js` uses a **connection ladder** (when `PROXYSELLER_TRANSPORT=auto`):

1. `tunnel` + HTTP/1.1 ALPN (if `PROXYSELLER_ALPN_HTTP1_ONLY=true`)
2. `tunnel` + default ALPN
3. `https-proxy-agent` (HPA) + HTTP/1.1 ALPN
4. HPA + default ALPN

Env knobs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PROXYSELLER_TRANSPORT` | `auto` | `tunnel`, `hpa`, or `auto` ladder |
| `PROXYSELLER_ALPN_HTTP1_ONLY` | `true` | Force `ALPNProtocols: ['http/1.1']` on destination TLS |
| `PROXYSELLER_KEEP_ALIVE` | `true` | Keep-alive to ProxySeller HTTP proxy |
| `PROXY_DEBUG` | `false` | Log each TRY/FAIL with transport, phase, code |
| `PROXYSELLER_TLS_INSECURE` | `true` | `rejectUnauthorized: false` for destination TLS |

Diagnostics: `lib/proxyDiagnostics.js` classifies failures as `proxy_connect`, `tls_handshake`, or `timeout`.

### Troubleshooting "socket disconnected before secure TLS connection"

1. **Whitelist your public IP** in the ProxySeller dashboard (must match your real IP; `PROXYSELLER_AUTH_IP` is reference only).
2. Use **HTTP port** `PROXYSELLER_HTTP_PORT` (41093), not SOCKS, unless SOCKS support is added.
3. Set `PROXY_DEBUG=true`, restart server, retry unblock — terminal shows which transport/ALPN failed.
4. If only `alpn=default` works: `PROXYSELLER_ALPN_HTTP1_ONLY=false`.
5. If only `transport=tunnel` works: `PROXYSELLER_TRANSPORT=tunnel`.
6. Manual test from your machine:

```powershell
curl -v -x http://USER:PASS@PROXYSELLER_HOST:41093 https://www.youtube.com/ -o NUL
```

If curl fails at TLS after `CONNECT`, the issue is ProxySeller/network, not OpenRelay rewrite logic.

## Core modules

- `lib/proxySeller.js` — upstream fetch, connection ladder, retries, cache clear on retry.
- `lib/proxyDiagnostics.js` — structured TLS/CONNECT error logging.
- `lib/proxyPaths.js` — UV-style `/api/proxy/site/:session/...` path mapping.
- `lib/proxyServiceWorker.js` — optional SW for stray root paths (`/s/`, `/sw.js`).
- `lib/proxyGateway.js` — stream vs rewrite vs redirect; pipes binary with `pipeline`.
- `lib/rewriteEngine.js` — classifies HTML/CSS/JS/JSON/HLS/YouTube bodies.
- `lib/htmlRewrite.js` — URL resolver, `srcset`, CSS `url()`, meta CSP strip, integrity strip.
- `lib/responseSanitizer.js` — removes CSP, XFO, COOP, HSTS, etc. from upstream responses.
- `middleware/youtubeResourceProxy.js` — googlevideo headers + dedicated video pipe.

## After URL rewrite fix

Restart the server and start a **new** unblock session. Resource URLs must look like:

`/api/proxy/resource?session=<hex>&url=https%3A%2F%2F...`

Never `/api/proxy/<hex>/api/proxy/resource?...` or `session=http://localhost:3000`.
