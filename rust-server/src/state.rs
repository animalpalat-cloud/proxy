use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use parking_lot::RwLock;
use reqwest::Client;

use crate::bare::headers::BareRequest;
use crate::config::Config;
use crate::proxy::probe::Socks5ProbeResult;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub http_client: Client,
    pub ws_meta: Arc<DashMap<String, WsMetaEntry>>,
    socks5_probe: Arc<RwLock<Option<Socks5ProbeResult>>>,
}

#[derive(Clone)]
pub struct WsMetaEntry {
    pub bare: BareRequest,
    pub created: Instant,
    pub remote_status: u16,
    pub remote_status_text: String,
    pub remote_headers_json: String,
}

impl WsMetaEntry {
    pub fn is_expired(&self) -> bool {
        self.created.elapsed() > Duration::from_secs(30)
    }
}

impl AppState {
    pub fn new(config: Config, http_client: Client) -> Self {
        Self {
            config,
            http_client,
            ws_meta: Arc::new(DashMap::new()),
            socks5_probe: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_socks5_probe(&self, probe: Socks5ProbeResult) {
        *self.socks5_probe.write() = Some(probe);
    }

    pub fn socks5_probe(&self) -> Option<Socks5ProbeResult> {
        self.socks5_probe.read().clone()
    }

    pub fn store_ws_meta(&self, id: String, entry: WsMetaEntry) {
        self.ws_meta.insert(id, entry);
        self.purge_expired_ws_meta();
    }

    pub fn take_ws_meta(&self, id: &str) -> Option<WsMetaEntry> {
        let entry = self.ws_meta.remove(id).map(|(_, v)| v)?;
        if entry.is_expired() {
            return None;
        }
        Some(entry)
    }

    pub fn get_ws_meta(&self, id: &str) -> Option<WsMetaEntry> {
        let entry = self.ws_meta.get(id)?;
        if entry.is_expired() {
            drop(entry);
            self.ws_meta.remove(id);
            return None;
        }
        Some(entry.clone())
    }

    fn purge_expired_ws_meta(&self) {
        self.ws_meta
            .retain(|_, entry| !entry.is_expired());
    }
}
