//! Multi-provider BYOK gateway.
//!
//! A single provider-neutral request/response shape flows through the app.
//! Each adapter serializes it into its own provider's wire format. Phase 1
//! ships the OpenAI-compatible adapter (covers OpenRouter, Kimi/Moonshot, and
//! any OpenAI-shaped endpoint). GigaChat and custom/self-hosted are laid into
//! the architecture and filled in on later phases.

pub mod gigachat;
pub mod openai_compat;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("network error: {0}")]
    Network(String),
    #[error("provider returned an error: {0}")]
    Api(String),
    #[error("missing API key for this connection")]
    MissingKey,
    #[error("this provider is not implemented yet")]
    NotImplemented,
}

impl serde::Serialize for ProviderError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Which adapter to use. `Custom` is wired but hidden in the UI for now.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenaiCompat,
    Gigachat,
    Custom,
}

/// Everything an adapter needs to reach an endpoint. The secret API key is not
/// here — it is fetched from the Keychain by connection id at call time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub kind: ProviderKind,
    /// e.g. "https://openrouter.ai/api/v1". Trailing slash tolerated.
    pub base_url: String,
    /// GigaChat only: OAuth scope (e.g. "GIGACHAT_API_PERS"). Ignored elsewhere.
    #[serde(default)]
    pub scope: Option<String>,
    /// GigaChat only: path to a PEM with the Russian Trusted Root CA (added to
    /// the reqwest trust store on top of the OS roots).
    #[serde(default)]
    pub ca_path: Option<String>,
}

impl Connection {
    pub fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.base_url.trim_end_matches('/'), path.trim_start_matches('/'))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatParams {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
}

/// Streaming events pushed to the frontend over a Tauri IPC channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { content: String },
    Done { finish_reason: Option<String> },
    Error { message: String },
}

#[async_trait]
pub trait Provider: Send + Sync {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError>;
    async fn chat_stream(
        &self,
        params: ChatParams,
        channel: &Channel<StreamEvent>,
    ) -> Result<(), ProviderError>;
    /// Single-shot, non-streaming completion. Used by the adaptive router
    /// (prompt classification) and the handoff summarizer — short, cheap calls.
    async fn complete(&self, params: ChatParams) -> Result<String, ProviderError>;
}

/// Build the right adapter for a connection. `api_key` already resolved from
/// the Keychain by the caller.
pub fn build_provider(
    conn: &Connection,
    api_key: String,
) -> Result<Box<dyn Provider>, ProviderError> {
    match conn.kind {
        ProviderKind::OpenaiCompat => Ok(Box::new(
            openai_compat::OpenAiCompat::new(conn.clone(), api_key),
        )),
        ProviderKind::Gigachat => Ok(Box::new(gigachat::GigaChat::new(conn.clone(), api_key)?)),
        // Custom/self-hosted: wired but hidden in the UI for now.
        ProviderKind::Custom => Err(ProviderError::NotImplemented),
    }
}
