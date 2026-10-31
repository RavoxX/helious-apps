use crate::vault::{hash, Result};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use url::Url;
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub origin: String,
    pub cookies: BTreeMap<String, String>,
    pub csrf: Option<String>,
}
#[derive(Serialize)]
pub struct Reply {
    pub status: u16,
    pub data: Value,
}
pub fn origin(value: &str) -> Result<String> {
    let url = Url::parse(value).map_err(|_| "Enter the server's HTTPS origin.")?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || !(url.scheme() == "https"
            || (url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
    {
        return Err("Use HTTPS, or HTTP on localhost, without a path or credentials.".into());
    }
    Ok(url.origin().ascii_serialization())
}
fn entry(origin: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("com.helious.desktop", &hash(origin.as_bytes()))
        .map_err(|_| "OS credential storage is unavailable.")
        .map_err(Into::into)
}
pub fn save(session: &Session) -> Result<()> {
    entry(&session.origin)?
        .set_password(&serde_json::to_string(session).map_err(|_| "Cannot encode server session.")?)
        .map_err(|_| {
            "Cannot save the session in OS credential storage. No plaintext fallback is used."
                .into()
        })
}
pub fn load(server: &str) -> Result<Session> {
    let canonical = origin(server)?;
    let stored = entry(&canonical)?
        .get_password()
        .map_err(|_| "Sign in to this server again.")?;
    let session: Session = serde_json::from_str(&stored)
        .map_err(|_| "Stored server session is invalid. Sign in again.")?;
    if session.origin != canonical {
        return Err("Stored session does not match this server.".into());
    }
    Ok(session)
}
pub fn forget(server: &str) -> Result<()> {
    match entry(server)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Cannot remove the stored OS credential.".into()),
    }
}
fn client() -> Result<&'static Client> {
    static CLIENT: std::sync::OnceLock<std::result::Result<Client, String>> =
        std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(45))
                .user_agent(concat!("Helious-Desktop/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|_| "Cannot initialize the secure connection.".into())
        })
        .as_ref()
        .map_err(Clone::clone)
}
async fn bytes(mut response: Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|n| n > 40 * 1024 * 1024)
    {
        return Err("Server response exceeds 40 MiB.".into());
    }
    let mut data = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Server response was interrupted.")?
    {
        if data.len() + chunk.len() > 40 * 1024 * 1024 {
            return Err("Server response exceeds 40 MiB.".into());
        }
        data.extend_from_slice(&chunk)
    }
    Ok(data)
}
async fn send(session: &mut Session, path: &str, method: &str, body: &Value) -> Result<Response> {
    let method = match method {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PATCH" => Method::PATCH,
        "DELETE" => Method::DELETE,
        _ => return Err("Unsupported request method.".into()),
    };
    if !path.starts_with("/api/") || path.contains(['\\', '\r', '\n']) || path.len() > 4096 {
        return Err("Only Helious API paths are permitted.".into());
    }
    let url = Url::parse(&(session.origin.clone() + path)).map_err(|_| "Invalid API path.")?;
    if url.origin().ascii_serialization() != session.origin || !url.path().starts_with("/api/") {
        return Err("API path escaped the configured server.".into());
    }
    let mut request = client()?
        .request(method.clone(), url)
        .header("Origin", &session.origin)
        .header(
            "Cookie",
            session
                .cookies
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("; "),
        );
    if method != Method::GET {
        request = request.header(
            "X-CSRF-Token",
            session
                .csrf
                .as_deref()
                .ok_or("Secure connection needs refreshing.")?,
        );
    }
    if method != Method::GET {
        if let Some(file) = body.get("_upload") {
            use base64::{engine::general_purpose::STANDARD, Engine};
            let name = file["name"].as_str().ok_or("Missing upload name.")?;
            let data = STANDARD
                .decode(file["data"].as_str().ok_or("Missing upload data.")?)
                .map_err(|_| "Invalid upload data.")?;
            if data.len() > 20 * 1024 * 1024 {
                return Err("Attachments are limited to 20 MiB.".into());
            }
            let mut form = reqwest::multipart::Form::new().part(
                "file",
                reqwest::multipart::Part::bytes(data)
                    .file_name(name.to_string())
                    .mime_str("application/octet-stream")
                    .map_err(|_| "Invalid upload type.")?,
            );
            for field in ["path", "spaceId"] {
                if let Some(v) = body[field].as_str() {
                    form = form.text(field, v.to_string());
                }
            }
            request = request.multipart(form);
        } else {
            request = request.json(body)
        }
    }
    let response = request.send().await.map_err(|_| {
        "Cannot reach the server securely. Check its address, certificate and network connection."
    })?;
    for header in response.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie) = header.to_str() {
            if let Some(pair) = cookie.split(';').next() {
                if let Some((key, value)) = pair.split_once('=') {
                    if ["helious_session", "helious_csrf"].contains(&key) {
                        if key == "helious_csrf"
                            && session.cookies.get(key).map(String::as_str) != Some(value)
                        {
                            session.csrf = None;
                        }
                        if value.is_empty() {
                            session.cookies.remove(key);
                        } else {
                            session.cookies.insert(key.into(), value.into());
                        }
                    }
                }
            }
        }
    }
    Ok(response)
}
async fn csrf(session: &mut Session) -> Result<()> {
    let response = send(session, "/api/auth/csrf", "GET", &Value::Null).await?;
    if !response.status().is_success() {
        return Err("Cannot establish the server's secure session.".into());
    }
    let data: Value = serde_json::from_slice(&bytes(response).await?)
        .map_err(|_| "The address did not return a Helious API response.")?;
    session.csrf = data["csrfToken"].as_str().map(str::to_string);
    if session.csrf.is_none() {
        return Err("The server did not provide a CSRF token.".into());
    }
    Ok(())
}
pub async fn connect(
    server: &str,
    email: &str,
    password: &str,
    code: Option<String>,
) -> Result<Reply> {
    let mut session = Session {
        origin: origin(server)?,
        cookies: BTreeMap::new(),
        csrf: None,
    };
    csrf(&mut session).await?;
    let mut body = json!({"email":email,"password":password});
    if let Some(code) = code {
        body["code"] = json!(code)
    }
    let response = send(&mut session, "/api/auth/login", "POST", &body).await?;
    let status = response.status().as_u16();
    let data: Value = serde_json::from_slice(&bytes(response).await?)
        .map_err(|_| "The server returned an invalid response.")?;
    if status == 200 {
        if !session.cookies.contains_key("helious_session") {
            return Err("The server did not establish a session.".into());
        }
        if let Err(error) = save(&session) {
            let _ = send(&mut session, "/api/auth/logout", "POST", &json!({})).await;
            return Err(error);
        }
    }
    Ok(Reply { status, data })
}
pub async fn request(server: &str, path: &str, method: &str, body: Value) -> Result<Reply> {
    let mut session = load(server)?;
    if method != "GET" && session.csrf.is_none() {
        csrf(&mut session).await?;
    }
    let response = send(&mut session, path, method, &body).await?;
    let status = response.status().as_u16();
    save(&session)?;
    let data: Value = serde_json::from_slice(&bytes(response).await?)
        .map_err(|_| "The server returned an invalid JSON response.")?;
    Ok(Reply { status, data })
}
pub async fn download(server: &str, path: &str) -> Result<Vec<u8>> {
    if !path.starts_with("/api/vaults/") || !path.contains("/attachments/") {
        return Err("Only an attachment download is permitted.".into());
    }
    let mut session = load(server)?;
    let response = send(&mut session, path, "GET", &Value::Null).await?;
    save(&session)?;
    if !response.status().is_success() {
        return Err("Attachment is unavailable.".into());
    }
    bytes(response).await
}
