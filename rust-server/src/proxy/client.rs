use reqwest::Client;

use crate::config::ProxySellerConfig;
use crate::error::{AppError, AppResult};
use crate::proxy::tls::build_destination_tls_config;

/// Build reqwest client: SOCKS5h auth from env + shared destination TLS (ALPN / verify) settings.
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

    let proxy_url = format!(
        "socks5h://{}:{}@{}:{}",
        urlencoding::encode(&proxy.username),
        urlencoding::encode(&proxy.password),
        proxy.host,
        proxy.socks_port
    );

    let upstream_proxy = reqwest::Proxy::all(&proxy_url)
        .map_err(|e| AppError::Internal(format!("invalid SOCKS5 proxy URL: {e}")))?;

    let tls = build_destination_tls_config(proxy);

    let mut builder = Client::builder()
        .use_preconfigured_tls(tls)
        .proxy(upstream_proxy)
        .timeout(proxy.request_timeout)
        .connect_timeout(proxy.connect_timeout)
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        );

    if proxy.keep_alive {
        builder = builder
            .pool_max_idle_per_host(16)
            .tcp_keepalive(Some(std::time::Duration::from_secs(60)));
    } else {
        builder = builder.pool_max_idle_per_host(0);
    }

    builder
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest client: {e}")))
}

pub fn retry_delay(proxy: &ProxySellerConfig) -> std::time::Duration {
    proxy.retry_delay
}
