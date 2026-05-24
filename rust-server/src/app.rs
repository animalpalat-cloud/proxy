use std::time::Duration;

use axum::{
    body::Body,
    extract::State,
    http::{HeaderValue, Response, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use serde_json::json;
use tower_http::{catch_panic::CatchPanicLayer, timeout::TimeoutLayer, trace::TraceLayer};

use crate::bare;
use crate::config::Config;
use crate::error::AppResult;
use crate::proxy::client::build_http_client;
use crate::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    proxy_configured: bool,
    transport: &'static str,
    proxy_host: String,
    proxy_socks_port: u16,
    proxy_user: String,
    tls_insecure: bool,
    alpn_http1_only: bool,
    keep_alive: bool,
    retry_on_reset: bool,
    socks5_probe_ok: bool,
    socks5_probe_error: Option<String>,
    socks5_egress_ip: Option<String>,
}

pub fn build_app(config: Config) -> AppResult<(Router, AppState)> {
    let http_client = build_http_client(&config.proxy)?;
    let state = AppState::new(config.clone(), http_client);

    let request_timeout = config.proxy.request_timeout;

    // Layer order (outer -> inner): CatchPanic, Trace, Timeout. Any panic anywhere
    // becomes a logged 500 with bare-compatible headers instead of an empty hangup.
    let router = Router::new()
        .route("/health", get(health))
        // Accept both /bare and /bare/ as the manifest. Without this, /bare (no
        // trailing slash) returns 404 from .nest("/bare", ...), which has caused
        // confusing 500s when the Next middleware re-wraps the 404.
        .route("/bare", get(bare::manifest::manifest))
        .nest("/bare", bare::router(&state))
        .layer(CatchPanicLayer::custom(handle_panic))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::new(request_timeout + Duration::from_secs(5)))
        .with_state(state.clone());

    Ok((router, state))
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let p = &state.config.proxy;
    let probe = state.socks5_probe();
    Json(HealthResponse {
        ok: true,
        proxy_configured: state.config.proxy_configured(),
        transport: "socks5h",
        proxy_host: p.host.clone(),
        proxy_socks_port: p.socks_port,
        proxy_user: p.username.clone(),
        tls_insecure: p.tls_insecure,
        alpn_http1_only: p.alpn_http1_only,
        keep_alive: p.keep_alive,
        retry_on_reset: p.retry_on_reset,
        socks5_probe_ok: probe.as_ref().map(|p| p.ok).unwrap_or(false),
        socks5_probe_error: probe.as_ref().and_then(|p| p.error.clone()),
        socks5_egress_ip: probe.as_ref().and_then(|p| p.egress_ip.clone()),
    })
}

/// Turn any panic from a handler / middleware into a structured 500 with the
/// `x-bare-*` headers so bare-mux / bare-client can parse it instead of throwing
/// on `Cannot read properties of undefined` for the missing manifest fields.
fn handle_panic(err: Box<dyn std::any::Any + Send + 'static>) -> Response<Body> {
    let detail = if let Some(s) = err.downcast_ref::<&'static str>() {
        s.to_string()
    } else if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    };

    tracing::error!(panic = %detail, "axum handler panicked");

    let body = json!({
        "code": "PANIC",
        "message": detail,
    });

    let mut resp = (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response();
    let headers = resp.headers_mut();
    headers.insert("x-bare-status", HeaderValue::from_static("500"));
    headers.insert("x-bare-status-text", HeaderValue::from_static("Panic"));
    headers.insert("x-bare-headers", HeaderValue::from_static("{}"));
    resp
}
