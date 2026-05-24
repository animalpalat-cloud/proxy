use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Deserialize;

/// Snapshot of the startup SOCKS5 connectivity probe. Surfaced on `/health`
/// so operators can see at a glance whether ProxySeller is reachable.
#[derive(Clone, Debug)]
pub struct Socks5ProbeResult {
    pub ok: bool,
    pub egress_ip: Option<String>,
    pub error: Option<String>,
    pub latency_ms: u128,
    pub checked_at: Instant,
}

#[derive(Deserialize)]
struct IpResponse {
    ip: String,
}

/// Issue a single `GET https://api.ipify.org?format=json` through the SOCKS5
/// client to confirm the ProxySeller credentials, port, and IP whitelist all
/// work BEFORE the first user request hits the server.
///
/// We deliberately keep this short (8 s) so a flaky proxy doesn't delay startup.
pub async fn run_socks5_probe(client: &Client) -> Socks5ProbeResult {
    let started = Instant::now();
    let outcome = tokio::time::timeout(
        Duration::from_secs(8),
        client
            .get("https://api.ipify.org?format=json")
            .send(),
    )
    .await;

    let elapsed = started.elapsed().as_millis();

    match outcome {
        Err(_) => Socks5ProbeResult {
            ok: false,
            egress_ip: None,
            error: Some("probe timed out after 8s (SOCKS5 unreachable or upstream too slow)".to_string()),
            latency_ms: elapsed,
            checked_at: Instant::now(),
        },
        Ok(Err(e)) => Socks5ProbeResult {
            ok: false,
            egress_ip: None,
            error: Some(format!(
                "{e} (is PROXYSELLER_HOST/PORT correct and VPS IP whitelisted?)"
            )),
            latency_ms: elapsed,
            checked_at: Instant::now(),
        },
        Ok(Ok(resp)) => {
            let status = resp.status();
            if !status.is_success() {
                return Socks5ProbeResult {
                    ok: false,
                    egress_ip: None,
                    error: Some(format!("ipify returned HTTP {status}")),
                    latency_ms: elapsed,
                    checked_at: Instant::now(),
                };
            }
            match resp.json::<IpResponse>().await {
                Ok(body) => Socks5ProbeResult {
                    ok: true,
                    egress_ip: Some(body.ip),
                    error: None,
                    latency_ms: elapsed,
                    checked_at: Instant::now(),
                },
                Err(e) => Socks5ProbeResult {
                    ok: false,
                    egress_ip: None,
                    error: Some(format!("probe body parse failed: {e}")),
                    latency_ms: elapsed,
                    checked_at: Instant::now(),
                },
            }
        }
    }
}
