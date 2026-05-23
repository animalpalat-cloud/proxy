mod fetch;
mod websocket;

use axum::{
    extract::{Query, Request, State, WebSocketUpgrade},
    http::{HeaderMap, Method},
    response::Response,
    routing::any,
    Router,
};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use self::fetch::{bare_v3_fetch, CacheQuery};
use self::websocket::ws_tunnel_v3;

pub fn router() -> Router<AppState> {
    Router::new().route("/", any(v3_any))
}

async fn v3_any(
    State(state): State<AppState>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<CacheQuery>,
    req: Request<axum::body::Body>,
) -> AppResult<Response> {
    if method == Method::GET && is_websocket_upgrade(&headers) {
        let upgrade = WebSocketUpgrade::from_request(req, &state)
            .await
            .map_err(|e| AppError::Internal(format!("websocket upgrade: {e}")))?;
        return ws_tunnel_v3(upgrade, State(state)).await;
    }

    bare_v3_fetch(State(state), method, headers, Query(query), req).await
}

fn is_websocket_upgrade(headers: &HeaderMap) -> bool {
    headers
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
}
