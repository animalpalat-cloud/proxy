use std::time::Duration;

use axum::{routing::get, Json, Router};
use serde::Serialize;
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};

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
    tls_insecure: bool,
    alpn_http1_only: bool,
    keep_alive: bool,
    retry_on_reset: bool,
}

pub fn build_app(config: Config) -> AppResult<Router> {
    let http_client = build_http_client(&config.proxy)?;
    let state = AppState::new(config.clone(), http_client);

    let request_timeout = config.proxy.request_timeout;

    let app = Router::new()
        .route("/health", get(health))
        .nest("/bare", bare::router(&state))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            request_timeout + Duration::from_secs(5),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    Ok(app)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let p = &state.config.proxy;
    Json(HealthResponse {
        ok: true,
        proxy_configured: state.config.proxy_configured(),
        transport: "socks5h",
        tls_insecure: p.tls_insecure,
        alpn_http1_only: p.alpn_http1_only,
        keep_alive: p.keep_alive,
        retry_on_reset: p.retry_on_reset,
    })
}

use axum::extract::State;
