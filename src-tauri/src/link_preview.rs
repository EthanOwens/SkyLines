use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, Client, Response, Url};
use serde::Serialize;
use std::net::IpAddr;
use std::time::Duration;

const MAX_HEAD: usize = 512 * 1024;
const MAX_IMAGE: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageHead {
    content_type: String,
    html: String,
}

// shortcut: checks literal hosts only, a domain that resolves to a private IP gets through.
fn check_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("unsupported scheme".into());
    }
    let blocked = match url.host() {
        None => true,
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(ip)) => is_private(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_private(IpAddr::V6(ip)),
    };
    if blocked {
        Err("blocked host".into())
    } else {
        Ok(())
    }
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return is_private(IpAddr::V4(v4));
            }
            let first = ip.segments()[0];
            ip.is_loopback()
                || ip.is_unspecified()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
        }
    }
}

async fn get(url: &str) -> Result<Response, String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    check_url(&url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || check_url(attempt.url()).is_err() {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .user_agent("Mozilla/5.0 (compatible; SkyLines link preview)")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(res)
    } else {
        Err(format!("status {}", res.status()))
    }
}

fn content_type(res: &Response) -> String {
    res.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

#[tauri::command]
pub async fn fetch_page_head(url: String) -> Result<PageHead, String> {
    let mut res = get(&url).await?;
    let content_type = content_type(&res);
    if content_type.starts_with("image/") {
        return Ok(PageHead { content_type, html: String::new() });
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        let text = String::from_utf8_lossy(&buf);
        if buf.len() >= MAX_HEAD || text.to_ascii_lowercase().contains("</head>") {
            break;
        }
    }
    buf.truncate(MAX_HEAD);
    Ok(PageHead { content_type, html: String::from_utf8_lossy(&buf).into_owned() })
}

#[tauri::command]
pub async fn fetch_image(url: String) -> Result<String, String> {
    let mut res = get(&url).await?;
    let content_type = content_type(&res);
    if !content_type.starts_with("image/") {
        return Err("not an image".into());
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_IMAGE {
            return Err("image too large".into());
        }
    }
    Ok(format!("data:{};base64,{}", content_type, STANDARD.encode(&buf)))
}
