use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::error::{AppError, AppResult};
use crate::proxy::socks::connect_websocket;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct WsConnectMessage {
    #[serde(rename = "type")]
    msg_type: String,
    remote: String,
    #[serde(default)]
    protocols: Vec<String>,
    #[serde(default)]
    headers: std::collections::HashMap<String, String>,
    #[serde(default, rename = "forwardHeaders")]
    forward_headers: Vec<String>,
}

pub async fn ws_tunnel_v3(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> AppResult<Response> {
    if !state.config.proxy_configured() {
        return Err(AppError::ProxyNotConfigured);
    }

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(err) = run_v3_tunnel(state, socket).await {
            tracing::warn!("bare v3 websocket: {err}");
        }
    }))
}

async fn run_v3_tunnel(state: AppState, mut client: WebSocket) -> AppResult<()> {
    let first = client
        .next()
        .await
        .ok_or_else(|| AppError::bad_request("expected connect frame"))?
        .map_err(|e| AppError::bad_request(e.to_string()))?;

    let text = match first {
        Message::Text(t) => t,
        _ => return Err(AppError::bad_request("connect must be text frame")),
    };

    let connect: WsConnectMessage = serde_json::from_str(&text.to_string())
        .map_err(|e| AppError::bad_request(format!("invalid connect json: {e}")))?;

    if connect.msg_type != "connect" {
        return Err(AppError::bad_request("type must be connect"));
    }

    let remote = url::Url::parse(&connect.remote)
        .map_err(|e| AppError::bad_request(format!("invalid remote url: {e}")))?;

    let scheme = remote.scheme();
    let use_tls = scheme == "wss";
    let host = remote
        .host_str()
        .ok_or_else(|| AppError::bad_request("remote missing host"))?
        .to_string();
    let port = remote.port_or_known_default().unwrap_or(if use_tls { 443 } else { 80 });
    let path = format!(
        "{}{}",
        remote.path(),
        remote
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default()
    );

    let mut extra: Vec<(String, String)> = connect
        .headers
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    for name in &connect.forward_headers {
        // forward from bare client not available here — headers already in connect.headers
        let _ = name;
    }

    let proxy = state.config.proxy.clone();
    let (mut upstream, _response) =
        connect_websocket(&proxy, &host, port, &path, use_tls, &extra).await?;

    let open = json!({
        "type": "open",
        "protocol": connect.protocols.first().cloned().unwrap_or_default(),
        "setCookies": []
    });
    client
        .send(Message::Text(open.to_string().into()))
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;

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
                    Some(Err(e)) => return Err(AppError::Upstream(e.to_string())),
                }
            }
        }
    }

    Ok(())
}
