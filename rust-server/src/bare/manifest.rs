use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct BareManifest {
    versions: Vec<&'static str>,
    language: &'static str,
    #[serde(rename = "memoryUsage")]
    memory_usage: f64,
    project: BareProject,
}

#[derive(Serialize)]
pub struct BareProject {
    name: &'static str,
    description: &'static str,
    version: &'static str,
}

/// Stateless on purpose: this handler is mounted on both `GET /bare` (top
/// level) and `GET /bare/` (nested). Extracting `State<AppState>` would force
/// the route to live in only one of those, and any extraction failure would
/// surface as a confusing 500.
pub async fn manifest() -> Json<BareManifest> {
    Json(BareManifest {
        versions: vec!["v2", "v3"],
        language: "Rust",
        memory_usage: 0.0,
        project: BareProject {
            name: "openrelay-bare",
            description: "TompHTTP Bare v2/v3 with ProxySeller SOCKS5",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}
