use std::collections::HashMap;

use axum::http::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_HEADER_VALUE: usize = 3072;
const BARE_HEADERS_PREFIX: &str = "x-bare-headers";

const FORBIDDEN_FORWARD: &[&str] = &[
    "connection",
    "transfer-encoding",
    "host",
    "origin",
    "referer",
];

const FORBIDDEN_PASS: &[&str] = &[
    "vary",
    "connection",
    "transfer-encoding",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "access-control-expose-headers",
    "access-control-max-age",
    "access-control-request-headers",
    "access-control-request-method",
];

const BASE_FORWARD: &[&str] = &[
    "accept-encoding",
    "accept-language",
    "sec-websocket-extensions",
    "sec-websocket-key",
    "sec-websocket-version",
];

const BASE_PASS: &[&str] = &["content-encoding", "content-length", "last-modified"];

/// Hop-by-hop and transport headers that must never appear in the x-bare-headers JSON.
/// Per RFC 7230 these are bound to the single TCP hop and would corrupt the bare response.
const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// Stay under nginx's default `proxy_buffer_size 8k`. If a single response
/// header exceeds the buffer, nginx returns 502 and we never see the body.
const MAX_X_BARE_HEADERS_BYTES: usize = 7 * 1024;

/// Headers Ultraviolet (and most consumers) actually need for client-side
/// rewriting when we have to truncate. Order doesn't matter — this is a
/// lookup table.
const MINIMAL_HEADER_KEYS: &[&str] = &[
    "content-type",
    "content-length",
    "content-encoding",
    "content-disposition",
    "set-cookie",
    "location",
    "link",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "cache-control",
    "etag",
    "last-modified",
    "expires",
    "vary",
    "www-authenticate",
];

#[derive(Clone, Debug)]
pub struct BareRequest {
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub forward_headers: Vec<String>,
    pub pass_headers: Vec<String>,
    pub pass_status: Vec<u16>,
    pub cache: bool,
}

impl BareRequest {
    pub fn target_url(&self) -> AppResult<String> {
        let scheme = match self.protocol.as_str() {
            "http:" => "http",
            "https:" => "https",
            "ws:" => "ws",
            "wss:" => "wss",
            other => return Err(AppError::bare("INVALID_PROTOCOL", format!("unsupported {other}"))),
        };
        Ok(format!(
            "{scheme}://{}:{}{}",
            self.host, self.port, self.path
        ))
    }

    pub fn is_secure(&self) -> bool {
        self.protocol == "https:" || self.protocol == "wss:"
    }
}

pub fn join_split_headers(headers: &HeaderMap) -> AppResult<HeaderMap> {
    let mut out = headers.clone();
    let prefix = BARE_HEADERS_PREFIX;

    if !headers.contains_key(format!("{prefix}-0").as_str()) {
        return Ok(out);
    }

    let mut parts: Vec<(usize, String)> = Vec::new();
    for (name, value) in headers.iter() {
        let name = name.as_str().to_ascii_lowercase();
        if let Some(id_str) = name.strip_prefix(&format!("{prefix}-")) {
            let id: usize = id_str
                .parse()
                .map_err(|_| AppError::bare("INVALID_BARE_HEADER", "invalid split id"))?;
            let raw = value
                .to_str()
                .map_err(|_| AppError::bare("INVALID_BARE_HEADER", "non-utf8 split"))?;
            if !raw.starts_with(';') {
                return Err(AppError::bare(
                    "INVALID_BARE_HEADER",
                    format!("{name} must start with semicolon"),
                ));
            }
            parts.push((id, raw[1..].to_string()));
        }
    }

    parts.sort_by_key(|(id, _)| *id);
    let joined = parts.into_iter().map(|(_, v)| v).collect::<String>();

    for key in headers.keys() {
        if key.as_str().to_ascii_lowercase().starts_with(prefix) {
            out.remove(key);
        }
    }

    out.insert(
        HeaderName::from_static(BARE_HEADERS_PREFIX),
        HeaderValue::from_str(&joined)
            .map_err(|e| AppError::bare("INVALID_BARE_HEADER", e.to_string()))?,
    );

    Ok(out)
}

pub fn parse_bare_request(headers: &HeaderMap, query_cache: bool) -> AppResult<BareRequest> {
    let joined = join_split_headers(headers)?;

    let host = get_required_header(&joined, "x-bare-host")?;
    let port: u16 = get_required_header(&joined, "x-bare-port")?
        .parse()
        .map_err(|_| AppError::bare("INVALID_PORT", "invalid port"))?;
    let protocol = get_required_header(&joined, "x-bare-protocol")?;
    let path = get_required_header(&joined, "x-bare-path")?;
    let headers_json = get_required_header(&joined, "x-bare-headers")?;

    if headers_json.len() > MAX_HEADER_VALUE {
        return Err(AppError::bare(
            "INVALID_BARE_HEADER",
            "x-bare-headers exceeds 3072 bytes",
        ));
    }

    let parsed: HashMap<String, Value> = serde_json::from_str(&headers_json)
        .map_err(|e| AppError::bare("INVALID_BARE_HEADER", format!("invalid JSON: {e}")))?;

    let mut bare_headers = HashMap::new();
    for (k, v) in parsed {
        let value = match v {
            Value::String(s) => s,
            Value::Array(arr) => arr
                .into_iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect::<Vec<_>>()
                .join(", "),
            _ => v.to_string(),
        };
        bare_headers.insert(k, value);
    }

    let forward_headers = merge_header_list(
        get_optional_list(&joined, "x-bare-forward-headers")?,
        BASE_FORWARD,
        query_cache,
    );
    let pass_headers = merge_header_list(
        get_optional_list(&joined, "x-bare-pass-headers")?,
        BASE_PASS,
        query_cache,
    );
    let pass_status = parse_status_list(get_optional_list(&joined, "x-bare-pass-status")?)?;

    Ok(BareRequest {
        host,
        port,
        protocol,
        path,
        headers: bare_headers,
        forward_headers,
        pass_headers,
        pass_status,
        cache: query_cache,
    })
}

fn get_required_header(headers: &HeaderMap, name: &str) -> AppResult<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::bare("MISSING_BARE_HEADER", format!("missing {name}")))
}

fn get_optional_list(headers: &HeaderMap, name: &str) -> AppResult<Vec<String>> {
    let Some(raw) = headers.get(name).and_then(|v| v.to_str().ok()) else {
        return Ok(Vec::new());
    };
    Ok(parse_rfc8941_list(raw))
}

fn parse_rfc8941_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().trim_matches('"').to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn merge_header_list(extra: Vec<String>, base: &[&str], cache: bool) -> Vec<String> {
    let mut out: Vec<String> = base.iter().map(|s| s.to_string()).collect();
    if cache {
        for h in [
            "if-modified-since",
            "if-none-match",
            "cache-control",
            "etag",
            "cache-control",
        ] {
            if !out.contains(&h.to_string()) {
                out.push(h.to_string());
            }
        }
    }
    for h in extra {
        if !FORBIDDEN_FORWARD.contains(&h.as_str())
            && !FORBIDDEN_PASS.contains(&h.as_str())
            && !out.contains(&h)
        {
            out.push(h);
        }
    }
    out
}

fn parse_status_list(items: Vec<String>) -> AppResult<Vec<u16>> {
    let mut out = Vec::new();
    for item in items {
        if let Ok(code) = item.parse::<u16>() {
            out.push(code);
        }
    }
    Ok(out)
}

pub fn build_upstream_headers(
    bare: &BareRequest,
    incoming: &HeaderMap,
) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();

    for (k, v) in &bare.headers {
        let lower = k.to_ascii_lowercase();
        if HOP_BY_HOP_HEADERS.contains(&lower.as_str())
            || FORBIDDEN_FORWARD.contains(&lower.as_str())
        {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(v),
        ) {
            map.insert(name, value);
        }
    }

    for name in &bare.forward_headers {
        let lower = name.to_ascii_lowercase();
        if FORBIDDEN_FORWARD.contains(&lower.as_str())
            || HOP_BY_HOP_HEADERS.contains(&lower.as_str())
        {
            continue;
        }
        if let Some(value) = incoming.get(name) {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                if let Ok(header_name) = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                {
                    map.insert(header_name, v);
                }
            }
        }
    }

    map
}

pub fn apply_bare_response_headers(
    bare: &BareRequest,
    remote_status: u16,
    remote_status_text: &str,
    remote_headers: &reqwest::header::HeaderMap,
    response_headers: &mut HeaderMap,
) {
    response_headers.insert(
        "x-bare-status",
        HeaderValue::from_str(&remote_status.to_string()).unwrap(),
    );
    response_headers.insert(
        "x-bare-status-text",
        HeaderValue::from_str(remote_status_text).unwrap_or(HeaderValue::from_static("OK")),
    );

    // Bare v3 spec: x-bare-headers carries ALL upstream response headers (except
    // hop-by-hop). Without this Ultraviolet loses content-type, set-cookie,
    // location, link headers, etc. and rewrites + cookies stop working.
    let mut all_headers: HashMap<String, Vec<String>> = HashMap::new();
    for (name, value) in remote_headers.iter() {
        let key = name.as_str().to_string();
        let lower = key.to_ascii_lowercase();
        if HOP_BY_HOP_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            all_headers
                .entry(key)
                .or_default()
                .push(v.to_string());
        }
    }

    // Cap the serialised JSON so a chatty origin (Cloudflare, S3, etc.) can't
    // produce an x-bare-headers value that exceeds nginx's response buffer and
    // turns the whole response into a 502.
    let mut json = serde_json::to_string(&all_headers).unwrap_or_else(|_| "{}".to_string());
    if json.len() > MAX_X_BARE_HEADERS_BYTES {
        tracing::warn!(
            size = json.len(),
            limit = MAX_X_BARE_HEADERS_BYTES,
            "x-bare-headers too large, truncating to minimal header set"
        );
        let minimal: HashMap<&String, &Vec<String>> = all_headers
            .iter()
            .filter(|(k, _)| MINIMAL_HEADER_KEYS.contains(&k.to_ascii_lowercase().as_str()))
            .collect();
        json = serde_json::to_string(&minimal).unwrap_or_else(|_| "{}".to_string());
    }
    if let Ok(v) = HeaderValue::from_str(&json) {
        response_headers.insert("x-bare-headers", v);
    } else {
        // HeaderValue::from_str rejects control chars / non-ASCII. Fall back
        // to a safe empty manifest so bare-mux can still parse the response.
        tracing::warn!("x-bare-headers JSON contained invalid header bytes, sending empty");
        response_headers.insert("x-bare-headers", HeaderValue::from_static("{}"));
    }

    // x-bare-pass-headers (request directive) tells the bare server which
    // upstream headers should ALSO be sent as raw HTTP headers on this
    // response. Streaming-relevant ones (content-encoding, content-length)
    // must always pass through so the browser can decode the body.
    let mut emit_raw: HashMap<String, &reqwest::header::HeaderValue> = HashMap::new();
    for (name, value) in remote_headers.iter() {
        let lower = name.as_str().to_ascii_lowercase();
        if HOP_BY_HOP_HEADERS.contains(&lower.as_str())
            || FORBIDDEN_PASS.contains(&lower.as_str())
        {
            continue;
        }
        let allowed = BASE_PASS.contains(&lower.as_str())
            || bare.pass_headers.iter().any(|p| p == &lower);
        if allowed {
            emit_raw.insert(lower, value);
        }
    }

    for (lower, value) in emit_raw {
        if let (Ok(name), Ok(v)) = (
            HeaderName::from_bytes(lower.as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            response_headers.insert(name, v);
        }
    }
}

pub fn effective_response_status(bare: &BareRequest, remote_status: u16) -> u16 {
    if bare.pass_status.contains(&remote_status) {
        remote_status
    } else {
        200
    }
}

const BASE_FORWARD_V3: &[&str] = &["accept-encoding", "accept-language"];

/// Bare v3 uses X-Bare-URL instead of host/port/protocol/path.
#[derive(Clone, Debug)]
pub struct BareRequestV3 {
    pub inner: BareRequest,
}

impl BareRequestV3 {
    pub fn target_url(&self) -> AppResult<String> {
        self.inner.target_url()
    }
}

pub fn parse_bare_request_v3(headers: &HeaderMap, cache: bool) -> AppResult<BareRequestV3> {
    let joined = join_split_headers(headers)?;
    let url_raw = get_required_header(&joined, "x-bare-url")?;
    let parsed = url::Url::parse(&url_raw)
        .map_err(|e| AppError::bare("INVALID_BARE_HEADER", format!("invalid x-bare-url: {e}")))?;

    let scheme = parsed.scheme();
    let protocol = match scheme {
        "http" => "http:",
        "https" => "https:",
        "ws" => "ws:",
        "wss" => "wss:",
        other => {
            return Err(AppError::bare(
                "INVALID_PROTOCOL",
                format!("unsupported protocol {other}"),
            ));
        }
    };

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::bare("INVALID_BARE_HEADER", "url missing host"))?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(if scheme == "https" || scheme == "wss" { 443 } else { 80 });
    let path = format!(
        "{}{}",
        parsed.path(),
        parsed
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default()
    );

    let headers_json = get_required_header(&joined, "x-bare-headers")?;
    if headers_json.len() > MAX_HEADER_VALUE {
        return Err(AppError::bare(
            "INVALID_BARE_HEADER",
            "x-bare-headers exceeds 3072 bytes",
        ));
    }

    let parsed_json: HashMap<String, Value> = serde_json::from_str(&headers_json)
        .map_err(|e| AppError::bare("INVALID_BARE_HEADER", format!("invalid JSON: {e}")))?;

    let mut bare_headers = HashMap::new();
    for (k, v) in parsed_json {
        let value = match v {
            Value::String(s) => s,
            Value::Array(arr) => arr
                .into_iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect::<Vec<_>>()
                .join(", "),
            _ => v.to_string(),
        };
        bare_headers.insert(k, value);
    }

    let forward_headers = merge_header_list(
        get_optional_list(&joined, "x-bare-forward-headers")?,
        BASE_FORWARD_V3,
        cache,
    );
    let pass_headers = merge_header_list(
        get_optional_list(&joined, "x-bare-pass-headers")?,
        BASE_PASS,
        cache,
    );
    let pass_status = parse_status_list(get_optional_list(&joined, "x-bare-pass-status")?)?;

    Ok(BareRequestV3 {
        inner: BareRequest {
            host,
            port,
            protocol: protocol.to_string(),
            path,
            headers: bare_headers,
            forward_headers,
            pass_headers,
            pass_status,
            cache,
        },
    })
}
