use std::sync::Arc;

use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_socks::tcp::Socks5Stream;
use tokio_tungstenite::{client_async, tungstenite::protocol::WebSocketConfig};

use crate::config::ProxySellerConfig;
use crate::error::{AppError, AppResult};
use crate::proxy::tls::build_destination_tls_config;

pub struct UpstreamStream {
    inner: UpstreamStreamInner,
}

enum UpstreamStreamInner {
    Plain(Socks5Stream<TcpStream>),
    Tls(tokio_rustls::client::TlsStream<Socks5Stream<TcpStream>>),
}

impl AsyncRead for UpstreamStream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut self.inner {
            UpstreamStreamInner::Plain(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            UpstreamStreamInner::Tls(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for UpstreamStream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<Result<usize, std::io::Error>> {
        match &mut self.inner {
            UpstreamStreamInner::Plain(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            UpstreamStreamInner::Tls(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        match &mut self.inner {
            UpstreamStreamInner::Plain(s) => std::pin::Pin::new(s).poll_flush(cx),
            UpstreamStreamInner::Tls(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        match &mut self.inner {
            UpstreamStreamInner::Plain(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            UpstreamStreamInner::Tls(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

/// SOCKS5 with username/password from `PROXYSELLER_USERNAME` / `PROXYSELLER_PASSWORD`.
pub async fn connect_tcp(
    proxy: &ProxySellerConfig,
    host: &str,
    port: u16,
) -> AppResult<UpstreamStream> {
    if proxy.username.is_empty() || proxy.password.is_empty() {
        return Err(AppError::ProxyNotConfigured);
    }

    let stream = Socks5Stream::connect_with_password(
        (proxy.host.as_str(), proxy.socks_port),
        (host, port),
        &proxy.username,
        &proxy.password,
    )
    .await
    .map_err(|e| AppError::Upstream(format!("SOCKS5 connect failed: {e}")))?;

    Ok(UpstreamStream {
        inner: UpstreamStreamInner::Plain(stream),
    })
}

pub async fn connect_tls(
    proxy: &ProxySellerConfig,
    host: &str,
    port: u16,
) -> AppResult<UpstreamStream> {
    let UpstreamStreamInner::Plain(stream) = connect_tcp(proxy, host, port).await?.inner else {
        return Err(AppError::Internal("expected plain stream".into()));
    };

    let tls_config = build_destination_tls_config(proxy);
    let connector = TlsConnector::from(tls_config);
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e| AppError::Internal(format!("invalid SNI: {e}")))?;

    let tls = connector
        .connect(server_name, stream)
        .await
        .map_err(|e| AppError::Upstream(format!("TLS handshake failed: {e}")))?;

    Ok(UpstreamStream {
        inner: UpstreamStreamInner::Tls(tls),
    })
}

pub async fn connect_websocket(
    proxy: &ProxySellerConfig,
    host: &str,
    port: u16,
    path: &str,
    use_tls: bool,
    extra_headers: &[(String, String)],
) -> AppResult<(
    tokio_tungstenite::WebSocketStream<UpstreamStream>,
    http::Response<Option<Vec<u8>>>,
)> {
    let stream = if use_tls {
        connect_tls(proxy, host, port).await?
    } else {
        connect_tcp(proxy, host, port).await?
    };

    let scheme = if use_tls { "wss" } else { "ws" };
    let url = format!("{scheme}://{host}:{port}{path}");

    let mut request = http::Request::builder().uri(&url).body(()).map_err(|e| {
        AppError::Internal(format!("ws request build: {e}"))
    })?;

    {
        let headers = request.headers_mut();
        headers.insert("Host", host.parse().unwrap());
        for (k, v) in extra_headers {
            if let (Ok(name), Ok(value)) = (
                http::HeaderName::from_bytes(k.as_bytes()),
                http::HeaderValue::from_str(v),
            ) {
                headers.insert(name, value);
            }
        }
    }

    client_async(request, stream, Some(WebSocketConfig::default()))
        .await
        .map_err(|e| AppError::Upstream(format!("WebSocket handshake failed: {e}")))
}
