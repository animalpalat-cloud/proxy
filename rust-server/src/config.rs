use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_host: String,
    pub port: u16,
    pub frontend_origins: Vec<String>,
    pub proxy: ProxySellerConfig,
}

#[derive(Clone, Debug)]
pub struct ProxySellerConfig {
    pub host: String,
    pub socks_port: u16,
    /// HTTP proxy port on the same host (reference only; outbound uses SOCKS5).
    pub http_port: u16,
    pub username: String,
    pub password: String,
    /// Comma-separated VPS IPs whitelisted on the ProxySeller dashboard (not sent on the wire).
    pub auth_ips: String,
    pub tls_insecure: bool,
    pub alpn_http1_only: bool,
    pub keep_alive: bool,
    pub request_timeout: Duration,
    pub connect_timeout: Duration,
    pub retry_on_reset: bool,
    pub retry_delay: Duration,
}

impl Config {
    pub fn from_env() -> Self {
        let bind_host = env_str("BIND_HOST", "127.0.0.1");
        let port = env_u16("PORT", 8000);
        let frontend_origins = env_str(
            "FRONTEND_ORIGINS",
            "http://localhost:3000,https://daddyproxy.com",
        )
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

        let proxy = ProxySellerConfig {
            host: sanitize_proxy_host(&env_str("PROXYSELLER_HOST", "")),
            socks_port: env_u16("PROXYSELLER_SOCKS_PORT", 51093),
            http_port: env_u16("PROXYSELLER_HTTP_PORT", 41093),
            username: env_str("PROXYSELLER_USERNAME", ""),
            password: env_str("PROXYSELLER_PASSWORD", ""),
            auth_ips: env_auth_ips(),
            tls_insecure: env_bool("PROXYSELLER_TLS_INSECURE", true),
            alpn_http1_only: env_bool("PROXYSELLER_ALPN_HTTP1_ONLY", true),
            keep_alive: env_bool("PROXYSELLER_KEEP_ALIVE", true),
            request_timeout: Duration::from_secs(env_u64("PROXY_REQUEST_TIMEOUT_SECS", 120)),
            connect_timeout: Duration::from_secs(env_u64("PROXY_CONNECT_TIMEOUT_SECS", 30)),
            retry_on_reset: env_bool("PROXY_RETRY_ON_RESET", true),
            retry_delay: Duration::from_millis(env_u64("PROXY_RETRY_DELAY_MS", 800)),
        };

        Self {
            bind_host,
            port,
            frontend_origins,
            proxy,
        }
    }

    pub fn proxy_configured(&self) -> bool {
        !self.proxy.host.is_empty()
            && !self.proxy.username.is_empty()
            && !self.proxy.password.is_empty()
    }
}

/// Strip accidental scheme/path/port suffixes from `PROXYSELLER_HOST`.
fn sanitize_proxy_host(raw: &str) -> String {
    let mut host = raw.trim();
    for prefix in ["socks5h://", "socks5://", "http://", "https://"] {
        host = host.strip_prefix(prefix).unwrap_or(host);
    }
    host.split('/').next().unwrap_or(host).trim().to_string()
}

fn env_str(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn env_u16(key: &str, default: u16) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// `PROXYSELLER_AUTH_IPS` (preferred) or legacy `PROXYSELLER_AUTH_IP`.
fn env_auth_ips() -> String {
    let ips = env_str("PROXYSELLER_AUTH_IPS", "");
    if ips.is_empty() {
        env_str("PROXYSELLER_AUTH_IP", "")
    } else {
        ips
    }
}

fn env_bool(key: &str, default: bool) -> bool {
    match std::env::var(key).ok().map(|v| v.to_lowercase()) {
        Some(v) if v == "true" || v == "1" || v == "yes" => true,
        Some(v) if v == "false" || v == "0" || v == "no" => false,
        Some(_) => default,
        None => default,
    }
}
