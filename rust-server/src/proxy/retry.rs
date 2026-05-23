use std::error::Error;
use std::future::Future;
use std::time::Duration;

use tracing::warn;

pub fn is_connection_reset(err: &reqwest::Error) -> bool {
    if err.is_request() {
        if let Some(source) = err.source() {
            let msg = source.to_string();
            if msg.contains("ECONNRESET")
                || msg.contains("connection reset")
                || msg.contains("broken pipe")
                || msg.contains("unexpected eof")
                || msg.contains("connection aborted")
            {
                return true;
            }
        }
    }
    let msg = err.to_string();
    msg.contains("ECONNRESET")
        || msg.contains("connection reset")
        || msg.contains("socket hang up")
}

/// Retry once on transport failures when `PROXY_RETRY_ON_RESET=true`.
pub fn is_retryable_transport(err: &reqwest::Error) -> bool {
    is_connection_reset(err) || err.is_timeout() || err.is_connect()
}

pub async fn with_transport_retry<T, F, Fut>(
    retry_enabled: bool,
    delay: Duration,
    mut operation: F,
) -> Result<T, reqwest::Error>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, reqwest::Error>>,
{
    match operation().await {
        Ok(value) => Ok(value),
        Err(err) if retry_enabled && is_retryable_transport(&err) => {
            warn!(
                "upstream transport error ({}), retrying once after {:?}",
                err,
                delay
            );
            tokio::time::sleep(delay).await;
            operation().await
        }
        Err(err) => Err(err),
    }
}

/// Backwards-compatible alias used by Bare fetch handlers.
pub async fn with_reset_retry<T, F, Fut>(
    retry_enabled: bool,
    delay: Duration,
    operation: F,
) -> Result<T, reqwest::Error>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, reqwest::Error>>,
{
    with_transport_retry(retry_enabled, delay, operation).await
}
