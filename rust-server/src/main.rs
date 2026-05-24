mod app;
mod bare;
mod config;
mod error;
mod proxy;
mod state;

use std::net::SocketAddr;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let _ = rustls::crypto::ring::default_provider().install_default();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("info,openrelay_bare=debug")
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = config::Config::from_env();
    let addr: SocketAddr = format!("{}:{}", config.bind_host, config.port)
        .parse()
        .expect("invalid BIND_HOST or PORT");

    let p = &config.proxy;

    tracing::info!(
        "openrelay-bare is internal-only — bound to {}:{}, public traffic comes through Next.js",
        config.bind_host,
        config.port,
    );

    if config.proxy_configured() {
        tracing::info!(
            "ProxySeller SOCKS5 socks5h://{}:{} (user={}) http_port={} auth_ips={} tls_insecure={} alpn_http1_only={} keep_alive={} retry_on_reset={} timeout={}s",
            p.host,
            p.socks_port,
            p.username,
            p.http_port,
            if p.auth_ips.is_empty() {
                "(not set)"
            } else {
                &p.auth_ips
            },
            p.tls_insecure,
            p.alpn_http1_only,
            p.keep_alive,
            p.retry_on_reset,
            p.request_timeout.as_secs(),
        );
    } else {
        tracing::warn!(
            "ProxySeller not fully configured — set PROXYSELLER_HOST, PROXYSELLER_USERNAME, PROXYSELLER_PASSWORD in rust-server/.env"
        );
    }

    let (app, state) = match app::build_app(config.clone()) {
        Ok(parts) => parts,
        Err(err) => {
            tracing::error!("failed to build app: {err}");
            eprintln!("fatal: failed to build app: {err}");
            std::process::exit(1);
        }
    };

    // Fire a one-shot SOCKS5 probe so a misconfigured ProxySeller surfaces
    // immediately in `pm2 logs` instead of waiting for the first user request
    // to hit a 502. We don't fail startup on probe failure — the operator can
    // still see /health and may simply not have configured the proxy yet.
    if state.config.proxy_configured() {
        let probe_client = state.http_client.clone();
        let probe_state = state.clone();
        tokio::spawn(async move {
            let result = proxy::probe::run_socks5_probe(&probe_client).await;
            if result.ok {
                tracing::info!(
                    egress_ip = ?result.egress_ip,
                    latency_ms = result.latency_ms,
                    "SOCKS5 probe OK"
                );
            } else {
                tracing::error!(
                    error = ?result.error,
                    latency_ms = result.latency_ms,
                    "SOCKS5 probe FAILED — ProxySeller is unreachable, see /health for details"
                );
            }
            probe_state.set_socks5_probe(result);
        });
    } else {
        tracing::warn!("skipping SOCKS5 probe — proxy not configured");
    }

    tracing::info!(
        "openrelay-bare listening on http://{} (proxy configured: {})",
        addr,
        config.proxy_configured(),
    );

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind failed");

    if let Err(err) = axum::serve(listener, app).await {
        tracing::error!("server exited: {err}");
        std::process::exit(1);
    }
}
