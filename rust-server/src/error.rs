use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("proxy not configured")]
    ProxyNotConfigured,
    #[error("upstream error: {0}")]
    Upstream(String),
    #[error("upstream timeout: {0}")]
    UpstreamTimeout(String),
    #[error("upstream connect failed: {0}")]
    UpstreamConnect(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn bare(code: &str, message: impl Into<String>) -> Self {
        Self::BadRequest(format!("{code}: {}", message.into()))
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::BadRequest(message.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            AppError::BadRequest(msg) => {
                if msg.starts_with("INVALID_BARE_HEADER") {
                    (
                        StatusCode::BAD_REQUEST,
                        json!({ "code": "INVALID_BARE_HEADER", "message": msg }),
                    )
                } else {
                    (
                        StatusCode::BAD_REQUEST,
                        json!({ "code": "BAD_REQUEST", "message": msg }),
                    )
                }
            }
            AppError::ProxyNotConfigured => (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "code": "PROXY_NOT_CONFIGURED", "message": self.to_string() }),
            ),
            AppError::Upstream(msg) => (
                StatusCode::BAD_GATEWAY,
                json!({ "code": "UPSTREAM_ERROR", "message": msg }),
            ),
            AppError::UpstreamTimeout(msg) => (
                StatusCode::GATEWAY_TIMEOUT,
                json!({ "code": "UPSTREAM_TIMEOUT", "message": msg }),
            ),
            AppError::UpstreamConnect(msg) => (
                StatusCode::BAD_GATEWAY,
                json!({ "code": "UPSTREAM_CONNECT_FAILED", "message": msg }),
            ),
            AppError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "code": "INTERNAL_ERROR", "message": msg }),
            ),
        };
        let mut resp = (status, Json(body)).into_response();
        // Always emit x-bare-* so bare-mux / bare-client treat this as a
        // structured response rather than throwing on missing manifest fields.
        let headers = resp.headers_mut();
        headers.insert(
            "x-bare-status",
            axum::http::HeaderValue::from_str(&status.as_u16().to_string()).unwrap(),
        );
        headers.insert(
            "x-bare-status-text",
            axum::http::HeaderValue::from_static("Upstream Error"),
        );
        headers.insert(
            "x-bare-headers",
            axum::http::HeaderValue::from_static("{}"),
        );
        resp
    }
}

pub type AppResult<T> = Result<T, AppError>;
