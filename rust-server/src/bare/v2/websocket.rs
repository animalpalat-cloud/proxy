use std::collections::HashMap;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::bare::headers::{parse_bare_request, BareRequest};
use crate::error::{AppError, AppResult};
use crate::proxy::socks::connect_websocket;
use crate::state::{AppState, WsMetaEntry};

#[derive(Debug, Deserialize)]
pub struct CacheQuery {
    pub cache: Option<String>,
}

pub async fn ws_new_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CacheQuery>,
) -> AppResult<Response> {
    if !state.config.proxy_configured() {
        return Err(AppError::ProxyNotConfigured);
    }

    let cache = query.cache.is_some();
    let bare = parse_bare_request(&headers, cache)?;
    let id = random_ws_id();

    state.store_ws_meta(
        id.clone(),
        WsMetaEntry {
            bare,
            created: std::time::Instant::now(),
            remote_status: 0,
            remote_status_text: String::new(),
            remote_headers_json: String::new(),
        },
    );

    Ok((StatusCode::OK, id).into_response())
}

pub async fn ws_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let id = headers
        .get("x-bare-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::bare("MISSING_BARE_HEADER", "missing x-bare-id"))?;

    let entry = state
        .take_ws_meta(id)
        .ok_or_else(|| AppError::bare("INVALID_BARE_HEADER", "unregistered or expired id"))?;

    if entry.remote_headers_json.is_empty() {
        return Err(AppError::bare("INVALID_BARE_HEADER", "meta not ready"));
    }

    let mut out = HeaderMap::new();
    out.insert(
        "x-bare-status",
        entry.remote_status.to_string().parse().unwrap(),
    );
    out.insert(
        "x-bare-status-text",
        entry.remote_status_text.parse().unwrap(),
    );
    out.insert(
        "x-bare-headers",
        entry.remote_headers_json.parse().unwrap(),
    );

    Ok((StatusCode::OK, out).into_response())
}

pub async fn ws_tunnel(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    if !state.config.proxy_configured() {
        return Err(AppError::ProxyNotConfigured);
    }

    let protocol = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .ok_or_else(|| AppError::bare("MISSING_BARE_HEADER", "missing sec-websocket-protocol"))?;

    let entry = state
        .get_ws_meta(&protocol)
        .ok_or_else(|| AppError::bare("INVALID_BARE_HEADER", "unregistered websocket id"))?;

    let bare = entry.bare.clone();
    let state_clone = state.clone();
    let id = protocol.clone();

    Ok(ws
        .protocols([std::borrow::Cow::Owned(protocol.clone())])
        .on_upgrade(move |socket| async move {
            if let Err(err) = run_ws_tunnel(state_clone, id, bare, socket).await {
                tracing::warn!("websocket tunnel ended: {err}");
            }
        }))
}

async fn run_ws_tunnel(
    state: AppState,
    id: String,
    bare: BareRequest,
    mut client: WebSocket,
) -> AppResult<()> {
    let use_tls = bare.protocol == "wss:";
    let host = bare.host.clone();
    let port = bare.port;
    let path = bare.path.clone();

    let mut extra: Vec<(String, String)> = Vec::new();
    for (k, v) in &bare.headers {
        extra.push((k.clone(), v.clone()));
    }

    let proxy = state.config.proxy.clone();
    let (upstream, response) = connect_websocket(&proxy, &host, port, &path, use_tls, &extra).await?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Switching Protocols")
        .to_string();

    let mut remote_header_map = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            remote_header_map.insert(name.as_str().to_string(), v.to_string());
        }
    }
    let remote_headers_json = serde_json::to_string(&remote_header_map).unwrap_or_else(|_| "{}".into());

    if let Some(mut entry) = state.ws_meta.get_mut(&id) {
        entry.remote_status = status;
        entry.remote_status_text = status_text;
        entry.remote_headers_json = remote_headers_json;
    }

    let (mut upstream_tx, mut upstream_rx) = upstream.split();

    loop {
        tokio::select! {
            from_client = client.recv() => {
                match from_client {
                    Some(Ok(Message::Binary(data))) => {
                        upstream_tx.send(WsMessage::Binary(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(Message::Text(text))) => {
                        upstream_tx.send(WsMessage::Text(text.to_string().into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        upstream_tx.send(WsMessage::Ping(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(Message::Pong(data))) => {
                        upstream_tx.send(WsMessage::Pong(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => return Err(AppError::Upstream(e.to_string())),
                }
            }
            from_upstream = upstream_rx.next() => {
                match from_upstream {
                    Some(Ok(WsMessage::Binary(data))) => {
                        client.send(Message::Binary(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(WsMessage::Text(text))) => {
                        client.send(Message::Text(text.to_string().into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(WsMessage::Ping(data))) => {
                        client.send(Message::Ping(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(WsMessage::Pong(data))) => {
                        client.send(Message::Pong(data.into())).await.map_err(|e| AppError::Upstream(e.to_string()))?;
                    }
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    Some(Ok(WsMessage::Frame(_))) => {}
                    Some(Err(e)) => return Err(AppError::Upstream(e.to_string())),
                }
            }
        }
    }

    Ok(())
}

fn random_ws_id() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}
