use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const TIMEOUT: Duration = Duration::from_secs(300);
const PAGE: &str = "<!doctype html><meta charset=utf-8><title>SkyLines</title>\
<body style=\"font-family:sans-serif;text-align:center;margin-top:20vh\">\
<h2>You can close this tab and return to SkyLines.</h2></body>";

// Bumped by every listen call; an older listener sees the change and stops.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn google_oauth_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        let start = Instant::now();
        while start.elapsed() < TIMEOUT && GENERATION.load(Ordering::SeqCst) == generation {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let target = request
                .lines()
                .next()
                .and_then(|l| l.strip_prefix("GET "))
                .and_then(|l| l.split(' ').next())
                .unwrap_or("");
            let (path, query) = target.split_once('?').unwrap_or((target, ""));
            if path != "/" {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                PAGE.len(),
                PAGE
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = app.emit_to("main", "google-oauth:redirect", query.to_string());
            break;
        }
    });

    Ok(port)
}

#[tauri::command]
pub async fn google_oauth_exchange(
    code: String,
    code_verifier: String,
    redirect_uri: String,
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "network error".to_string())?;
    let ok = response.status().is_success();
    let text = response.text().await.map_err(|_| "bad response".to_string())?;
    let body: serde_json::Value = serde_json::from_str(&text).map_err(|_| "bad response".to_string())?;
    if !ok {
        let field = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or("");
        return Err(format!("{}: {}", field("error"), field("error_description")));
    }
    body.get("id_token")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "no id_token in response".to_string())
}
