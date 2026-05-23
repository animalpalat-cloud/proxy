pub mod headers;
mod manifest;
pub mod v2;
pub mod v3;

use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::state::AppState;

pub fn router(state: &AppState) -> Router<AppState> {
    let cors = build_cors(&state.config.frontend_origins);

    Router::new()
        .route("/", get(manifest::manifest))
        .nest("/v2", v2::router())
        .nest("/v3", v3::router())
        .layer(cors)
}

fn build_cors(origins: &[String]) -> CorsLayer {
    use axum::http::{header, HeaderName, Method};

    let mut layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::HEAD,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            header::ACCEPT_LANGUAGE,
            header::ACCEPT_ENCODING,
            HeaderName::from_static("x-bare-url"),
            HeaderName::from_static("x-bare-host"),
            HeaderName::from_static("x-bare-port"),
            HeaderName::from_static("x-bare-protocol"),
            HeaderName::from_static("x-bare-path"),
            HeaderName::from_static("x-bare-headers"),
            HeaderName::from_static("x-bare-forward-headers"),
            HeaderName::from_static("x-bare-pass-headers"),
            HeaderName::from_static("x-bare-pass-status"),
            HeaderName::from_static("x-bare-id"),
            HeaderName::from_static("sec-websocket-protocol"),
        ])
        .expose_headers([
            HeaderName::from_static("x-bare-status"),
            HeaderName::from_static("x-bare-status-text"),
            HeaderName::from_static("x-bare-headers"),
            header::CONTENT_ENCODING,
            header::CONTENT_LENGTH,
        ]);

    if origins.is_empty() {
        layer = layer.allow_origin(Any);
    } else {
        use tower_http::cors::AllowOrigin;
        let parsed: Vec<_> = origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        layer = layer.allow_origin(AllowOrigin::list(parsed));
    }

    layer.allow_credentials(true)
}
