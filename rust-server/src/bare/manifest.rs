use axum::{extract::State, Json};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
struct BareManifest {
    versions: Vec<&'static str>,
    language: &'static str,
    #[serde(rename = "memoryUsage")]
    memory_usage: f64,
    project: BareProject,
}

#[derive(Serialize)]
struct BareProject {
    name: &'static str,
    description: &'static str,
    version: &'static str,
}

pub async fn manifest(State(_state): State<AppState>) -> Json<BareManifest> {
    Json(BareManifest {
        versions: vec!["v2", "v3"],
        language: "Rust",
        memory_usage: 0.0,
        project: BareProject {
            name: "openrelay-bare",
            description: "TompHTTP Bare v2 with ProxySeller SOCKS5",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}
