pub mod headers;
pub mod manifest;
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
    use tower_http::cors::{AllowHeaders, ExposeHeaders};

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
        // Accept any header: bare-mux splits x-bare-headers into x-bare-headers-0..N
        // which can't be enumerated up front, and same-origin requests skip CORS anyway.
        .allow_headers(AllowHeaders::mirror_request())
        .expose_headers(ExposeHeaders::list([
            HeaderName::from_static("x-bare-status"),
            HeaderName::from_static("x-bare-status-text"),
            HeaderName::from_static("x-bare-headers"),
            header::CONTENT_ENCODING,
            header::CONTENT_LENGTH,
            header::CONTENT_TYPE,
            header::LOCATION,
            header::SET_COOKIE,
        ]));

    if origins.is_empty() {
        // No credentials with wildcard origin per CORS spec.
        layer = layer.allow_origin(Any);
    } else {
        use tower_http::cors::AllowOrigin;
        let parsed: Vec<_> = origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        layer = layer.allow_origin(AllowOrigin::list(parsed)).allow_credentials(true);
    }

    layer
}
