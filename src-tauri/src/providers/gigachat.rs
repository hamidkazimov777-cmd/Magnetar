//! GigaChat (Sber) adapter. Battle-tested specifics baked in:
//! - OAuth on **port 9443** (`ngw.devices.sberbank.ru:9443/api/v2/oauth`),
//!   Basic auth + RqUID + User-Agent, `scope` in the form body. Token ~30 min,
//!   cached globally.
//! - Russian Trusted Root CA added to the reqwest trust store (PEM path from
//!   settings) on top of OS roots.
//! - Freemium allows 1 concurrent request → all GigaChat network calls are
//!   serialized behind a global async mutex.
//! - Model output may arrive wrapped in a ```json fence → we unwrap first `{` … last `}`.

use super::{ChatParams, Connection, ModelInfo, Provider, ProviderError, StreamEvent};
use async_trait::async_trait;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::sync::Mutex as AsyncMutex;

const OAUTH_URL: &str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_BASE: &str = "https://gigachat.devices.sberbank.ru/api/v1";
const USER_AGENT: &str = "Magnetar/0.1";

/// Russian Trusted Root CA (+ Sub CA), НУЦ Минцифры — bundled so GigaChat works
/// out of the box without the user hunting for a PEM. Trusted only inside this
/// reqwest client, never installed system-wide. Root SHA-256:
/// D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
const BUNDLED_CA: &[u8] = include_bytes!("../../certs/russian_trusted_ca.pem");

/// Freemium = one request at a time. Serialize every GigaChat network call.
static GIGA_LOCK: Lazy<AsyncMutex<()>> = Lazy::new(|| AsyncMutex::new(()));

/// Global token cache keyed by the Basic auth key: (access_token, expires_at_ms).
static TOKENS: Lazy<StdMutex<HashMap<String, (String, u64)>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct GigaChat {
    /// Base64 "client_id:client_secret" — the Authorization: Basic value.
    auth_key: String,
    scope: String,
    http: reqwest::Client,
}

impl GigaChat {
    pub fn new(conn: Connection, auth_key: String) -> Result<Self, ProviderError> {
        let mut builder = reqwest::Client::builder().user_agent(USER_AGENT);

        // Use a user-supplied PEM if given, otherwise the bundled Russian CA.
        let pem: Vec<u8> = match conn.ca_path.as_ref().filter(|p| !p.is_empty()) {
            Some(path) => std::fs::read(path)
                .map_err(|e| ProviderError::Api(format!("cannot read CA at {path}: {e}")))?,
            None => BUNDLED_CA.to_vec(),
        };
        // Russian trust bundle holds root + sub CA.
        let certs = reqwest::Certificate::from_pem_bundle(&pem)
            .map_err(|e| ProviderError::Api(format!("bad CA PEM: {e}")))?;
        for cert in certs {
            builder = builder.add_root_certificate(cert);
        }

        let http = builder
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        Ok(Self {
            auth_key,
            scope: conn
                .scope
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "GIGACHAT_API_PERS".to_string()),
            http,
        })
    }

    async fn access_token(&self) -> Result<String, ProviderError> {
        if self.auth_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        // Reuse a cached token while it has >60s left.
        if let Some((tok, exp)) = TOKENS
            .lock()
            .ok()
            .and_then(|m| m.get(&self.auth_key).cloned())
        {
            if exp > now_ms() + 60_000 {
                return Ok(tok);
            }
        }

        let rquid = uuid::Uuid::new_v4().to_string();
        let resp = self
            .http
            .post(OAUTH_URL)
            .header("Authorization", format!("Basic {}", self.auth_key))
            .header("RqUID", rquid)
            .header("Accept", "application/json")
            .form(&[("scope", self.scope.as_str())])
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(format!("oauth {code}: {body}")));
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;
        let token = v
            .get("access_token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| ProviderError::Api("oauth: no access_token".into()))?
            .to_string();
        // expires_at is an absolute ms epoch; default to +25 min if absent.
        let exp = v
            .get("expires_at")
            .and_then(|e| e.as_u64())
            .unwrap_or_else(|| now_ms() + 25 * 60_000);

        if let Ok(mut m) = TOKENS.lock() {
            m.insert(self.auth_key.clone(), (token.clone(), exp));
        }
        Ok(token)
    }

    async fn upload_file(&self, token: &str, data_url: &str) -> Result<String, ProviderError> {
        let b64 = if let Some(stripped) = data_url.strip_prefix("data:") {
            if let Some(idx) = stripped.find("base64,") {
                &stripped[idx + 7..]
            } else {
                data_url
            }
        } else {
            data_url
        };

        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
            .map_err(|e| ProviderError::Api(format!("bad base64: {e}")))?;

        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("image.jpg")
            .mime_str("image/jpeg")
            .unwrap();

        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("purpose", "general");

        let resp = self.http.post(format!("{API_BASE}/files"))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(format!("files {code}: {body}")));
        }

        let v: Value = resp.json().await.map_err(|e| ProviderError::Api(e.to_string()))?;
        let id = v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
        Ok(id)
    }

    async fn build_messages(&self, token: &str, params: &ChatParams) -> Result<Vec<Value>, ProviderError> {
        let mut messages: Vec<Value> = Vec::new();
        if let Some(sys) = &params.system {
            if !sys.is_empty() {
                messages.push(json!({ "role": "system", "content": sys }));
            }
        }
        for m in &params.messages {
            let mut has_images = false;
            if let Some(atts) = &m.attachments {
                if atts.iter().any(|a| a.kind == "image" && a.data.is_some()) {
                    has_images = true;
                }
            }
            if !has_images {
                messages.push(json!({ "role": m.role, "content": m.content }));
            } else {
                let mut file_ids = Vec::new();
                if let Some(atts) = &m.attachments {
                    for a in atts {
                        if a.kind == "image" {
                            if let Some(data) = &a.data {
                                let id = self.upload_file(token, data).await?;
                                file_ids.push(id);
                            }
                        }
                    }
                }
                messages.push(json!({
                    "role": m.role,
                    "content": m.content,
                    "attachments": file_ids
                }));
            }
        }
        Ok(messages)
    }
}

/// GigaChat sometimes wraps JSON answers in a ```json fence. Unwrap the span
/// from the first `{` to the last `}` when the whole thing looks like that.
pub fn strip_json_fence(s: &str) -> String {
    let t = s.trim();
    if t.starts_with("```") {
        if let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) {
            if b > a {
                return t[a..=b].to_string();
            }
        }
    }
    s.to_string()
}

#[async_trait]
impl Provider for GigaChat {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let _guard = GIGA_LOCK.lock().await;
        let token = self.access_token().await?;
        let resp = self
            .http
            .get(format!("{API_BASE}/models"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(format!("{code}: {body}")));
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;
        let mut models: Vec<ModelInfo> = v
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let id = m.get("id").and_then(|x| x.as_str())?.to_string();
                        Some(ModelInfo { id, label: None })
                    })
                    .collect()
            })
            .unwrap_or_default();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    async fn chat_stream(
        &self,
        params: ChatParams,
        channel: &Channel<StreamEvent>,
        cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<(), ProviderError> {
        let _guard = GIGA_LOCK.lock().await;
        let token = self.access_token().await?;

        let msgs = self.build_messages(&token, &params).await?;
        let mut body = json!({
            "model": params.model,
            "messages": msgs,
            "stream": true,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
        }

        let resp = self
            .http
            .post(format!("{API_BASE}/chat/completions"))
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let _ = channel.send(StreamEvent::Error {
                message: format!("{code}: {text}"),
            });
            return Err(ProviderError::Api(format!("{code}: {text}")));
        }

        // Same SSE shape as OpenAI: `data: {json}` lines, then `data: [DONE]`.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        // Decode across chunk boundaries: a Cyrillic letter is two bytes and
        // the network splits wherever it likes (see utf8.rs).
        let mut decoder = crate::utf8::Utf8Stream::new();
        while let Some(chunk) = stream.next().await {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = channel.send(StreamEvent::Done {
                    finish_reason: Some("cancelled".into()),
                });
                return Ok(());
            }
            let bytes = chunk.map_err(|e| ProviderError::Network(e.to_string()))?;
            buf.push_str(&decoder.push(&bytes));
            while let Some(nl) = buf.find('\n') {
                let line = buf[..nl].trim().to_string();
                buf.drain(..=nl);
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    let _ = channel.send(StreamEvent::Done { finish_reason: None });
                    return Ok(());
                }
                if data.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    let choice = v.get("choices").and_then(|c| c.get(0));
                    if let Some(content) = choice
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !content.is_empty() {
                            let _ = channel.send(StreamEvent::Delta {
                                content: content.to_string(),
                            });
                        }
                    }
                    if let Some(fr) = choice
                        .and_then(|c| c.get("finish_reason"))
                        .and_then(|f| f.as_str())
                    {
                        let _ = channel.send(StreamEvent::Done {
                            finish_reason: Some(fr.to_string()),
                        });
                        return Ok(());
                    }
                }
            }
        }
        let _ = channel.send(StreamEvent::Done { finish_reason: None });
        Ok(())
    }

    async fn complete(&self, params: ChatParams) -> Result<String, ProviderError> {
        let _guard = GIGA_LOCK.lock().await;
        let token = self.access_token().await?;

        let msgs = self.build_messages(&token, &params).await?;
        let mut body = json!({
            "model": params.model,
            "messages": msgs,
            "stream": false,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
        }

        let resp = self
            .http
            .post(format!("{API_BASE}/chat/completions"))
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(format!("{code}: {text}")));
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;
        let content = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or_default();
        Ok(strip_json_fence(content))
    }
}
