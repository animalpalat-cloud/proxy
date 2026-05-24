pub mod headers;
pub mod manifest;
pub mod v2;
pub mod v3;

use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::state::AppState;

pub fn router(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/", get(manifest::manifest))
        .nest("/v2", v2::router())
        .nest("/v3", v3::router())
        .layer(build_cors())
}

/// CORS is intentionally permissive: this server is bound to 127.0.0.1 and
/// reached only via Next.js middleware, so no browser ever talks to it
/// directly. The CORS layer exists purely so that bare-mux's preflight
/// machinery sees the headers it expects when those requests get proxied
/// through Next. `allow_credentials(true)` + `Any` would violate the CORS
/// spec, so we use `Any` without credentials — Next.js forwards cookies in
/// the request body / `x-bare-headers`, not via the browser cookie jar.
fn build_cors() -> CorsLayer {
    use axum::http::{header, HeaderName, Method};
    use tower_http::cors::{AllowHeaders, ExposeHeaders};

    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::HEAD,
            Method::OPTIONS,
        ])
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
        ]))
}
