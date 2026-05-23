use reqwest::Client;

use crate::config::ProxySellerConfig;
use crate::error::{AppError, AppResult};

/// Build reqwest client: SOCKS5h via ProxySeller + rustls TLS options from env.
pub fn build_http_client(proxy: &ProxySellerConfig) -> AppResult<Client> {
    if proxy.host.is_empty() {
        return Err(AppError::ProxyNotConfigured);
    }
    if proxy.username.is_empty() {
        return Err(AppError::Internal(
            "PROXYSELLER_USERNAME is missing in rust-server/.env".into(),
        ));
    }
    if proxy.password.is_empty() {
        return Err(AppError::Internal(
            "PROXYSELLER_PASSWORD is missing in rust-server/.env".into(),
        ));
    }

    let upstream_proxy = build_socks_proxy(proxy)?;

    let mut builder = Client::builder()
        .proxy(upstream_proxy)
        .timeout(proxy.request_timeout)
        .connect_timeout(proxy.connect_timeout)
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        );

    if proxy.tls_insecure {
        builder = builder.tls_danger_accept_invalid_certs(true);
    }

    if proxy.alpn_http1_only {
        builder = builder.http1_only();
    }

    if proxy.keep_alive {
        builder = builder
            .pool_max_idle_per_host(16)
            .tcp_keepalive(Some(std::time::Duration::from_secs(60)));
    } else {
        builder = builder.pool_max_idle_per_host(0);
    }

    builder.build().map_err(|e| {
        AppError::Internal(format!(
            "reqwest client build failed (socks5h://{}:{} user={}): {e}",
            proxy.host, proxy.socks_port, proxy.username
        ))
    })
}

/// Parse `socks5h://host:port` and attach SOCKS5 username/password (not embedded in the URL).
fn build_socks_proxy(proxy: &ProxySellerConfig) -> AppResult<reqwest::Proxy> {
    let proxy_url = format!("socks5h://{}:{}", proxy.host, proxy.socks_port);

    let parsed = url::Url::parse(&proxy_url).map_err(|e| {
        AppError::Internal(format!(
            "invalid SOCKS5 proxy URL {proxy_url:?} (check PROXYSELLER_HOST / PROXYSELLER_SOCKS_PORT): {e}"
        ))
    })?;

    if parsed.scheme() != "socks5h" {
        return Err(AppError::Internal(format!(
            "proxy URL must use socks5h scheme, got {:?}",
            parsed.scheme()
        )));
    }

    if parsed.host_str().is_none() {
        return Err(AppError::Internal(format!(
            "proxy URL missing host: {proxy_url:?}"
        )));
    }

    Ok(
        reqwest::Proxy::all(parsed.as_str()).map_err(|e| {
            AppError::Internal(format!(
                "reqwest rejected SOCKS5 proxy {proxy_url:?}: {e}"
            ))
        })?
        .basic_auth(&proxy.username, &proxy.password),
    )
}

pub fn retry_delay(proxy: &ProxySellerConfig) -> std::time::Duration {
    proxy.retry_delay
}
