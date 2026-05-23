# openrelay-bare

TompHTTP Bare v2 server (Axum) that forwards traffic through ProxySeller SOCKS5 (`socks5h://`).

## Build

```bash
cd rust-server
cp .env.example .env
# Edit .env with ProxySeller credentials
cargo build --release
```

## Run

```bash
cargo run --release
# or ./target/release/openrelay-bare
```

## Endpoints

| Path | Description |
|------|-------------|
| `GET /health` | Liveness + proxy configured flag |
| `GET /bare/` | Bare manifest |
| `*` `/bare/v2/` | Bare v2 HTTP fetch |
| `GET /bare/v2/ws-new-meta` | Allocate WebSocket tunnel ID |
| `GET /bare/v2/ws-meta` | WebSocket remote metadata |
| `GET /bare/v2/` (Upgrade) | WebSocket byte tunnel |

## Test

```bash
curl -sS http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:8000/bare/
```

Ultraviolet frontend expects same-origin `/bare/` (via Next rewrite or Nginx).
