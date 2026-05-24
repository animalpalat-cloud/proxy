use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, Method, Request, StatusCode},
    response::Response,
};
use futures_util::StreamExt;

use crate::bare::headers::{
    apply_bare_response_headers, build_upstream_headers, effective_response_status,
    parse_bare_request_v3,
};
use crate::error::{AppError, AppResult};
use crate::proxy::retry::{is_retryable_transport, with_reset_retry};
use crate::state::AppState;

#[derive(Debug, serde::Deserialize)]
pub struct CacheQuery {
    pub cache: Option<String>,
}

pub async fn bare_v3_fetch(
    State(state): State<AppState>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<CacheQuery>,
    body: Request<Body>,
) -> AppResult<Response> {
    if !state.config.proxy_configured() {
        return Err(AppError::ProxyNotConfigured);
    }

    let cache = query.cache.is_some();
    let bare = parse_bare_request_v3(&headers, cache)?;
    let target = bare.target_url()?;
    let upstream_headers = build_upstream_headers(&bare.inner, &headers);

    let body_bytes = if method == Method::GET || method == Method::HEAD {
        None
    } else {
        let collected = axum::body::to_bytes(body.into_body(), usize::MAX)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if collected.is_empty() {
            None
        } else {
            Some(collected)
        }
    };

    let client = state.http_client.clone();
    let proxy_cfg = state.config.proxy.clone();
    let retry = proxy_cfg.retry_on_reset;
    let delay = crate::proxy::client::retry_delay(&proxy_cfg);

    let upstream = with_reset_retry(retry, delay, || {
        let client = client.clone();
        let method = method.clone();
        let target = target.clone();
        let upstream_headers = upstream_headers.clone();
        let body_bytes = body_bytes.clone();
        async move {
            let mut req = client.request(method, &target).headers(upstream_headers);
            if let Some(bytes) = body_bytes {
                req = req.body(bytes);
            }
            req.send().await
        }
    })
    .await
    .map_err(|e| {
        if e.is_timeout() {
            AppError::UpstreamTimeout(format!("SOCKS5 / upstream timed out: {e}"))
        } else if e.is_connect() {
            AppError::UpstreamConnect(format!(
                "SOCKS5 connect to ProxySeller failed (check IP whitelist + creds): {e}"
            ))
        } else if is_retryable_transport(&e) {
            AppError::Upstream(format!("upstream transport reset: {e}"))
        } else {
            AppError::Upstream(e.to_string())
        }
    })?;

    let status = upstream.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("OK").to_string();
    let remote_headers = upstream.headers().clone();

    let response_status =
        StatusCode::from_u16(effective_response_status(&bare.inner, status_code))
            .unwrap_or(StatusCode::OK);

    let mut out_headers = HeaderMap::new();
    apply_bare_response_headers(
        &bare.inner,
        status_code,
        &status_text,
        &remote_headers,
        &mut out_headers,
    );

    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));

    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = response_status;
    response.headers_mut().extend(out_headers);
    Ok(response)
}
