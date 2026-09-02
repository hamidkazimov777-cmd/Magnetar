//! Native Anthropic (Claude) adapter.
//!
//! Anthropic is deliberately NOT OpenAI-shaped: it authenticates with an
//! `x-api-key` header (a Bearer token is rejected with 401 "Invalid bearer
//! token"), it posts to `/v1/messages` instead of `/chat/completions`, it takes
//! the system prompt as a top-level field, requires `max_tokens`, and reports
//! tool use as `tool_use` content blocks rather than `tool_calls`.
//!
//! This adapter translates our provider-neutral shapes — and the OpenAI-format
//! message objects the agent loop passes around — into that wire format.

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;

use super::{
    AgentStep, ChatParams, Connection, ModelInfo, Provider, ProviderError, StreamEvent,
    ToolCall, ToolDef,
};

/// Fixed API version required on every request.
const API_VERSION: &str = "2023-06-01";
/// Anthropic requires an explicit output cap; this is a sane default for both
/// chat replies and agent steps.
const MAX_TOKENS: u32 = 8192;

/// How much room the model gets to think before answering. Big enough to be
/// useful on real engineering questions, small enough not to dominate the bill.
const THINKING_BUDGET: u32 = 4096;

/// Extended thinking exists on Claude 3.7 and the 4.x line. Asking an older
/// model for it is a 400, so this gates on the family in the model id rather
/// than sending it blindly and hoping.
fn supports_thinking(model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    if !m.contains("claude") {
        return false;
    }
    m.contains("3-7")
        || m.contains("3.7")
        || m.contains("-4")
        || m.contains("opus-4")
        || m.contains("sonnet-4")
        || m.contains("haiku-4")
        || m.contains("-5")
}

pub struct Anthropic {
    conn: Connection,
    api_key: String,
    http: reqwest::Client,
}

impl Anthropic {
    pub fn new(conn: Connection, api_key: String) -> Self {
        Self {
            conn,
            api_key,
            http: reqwest::Client::new(),
        }
    }

    fn request(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .post(self.conn.endpoint(path))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
    }

    /// Split our canon messages into Anthropic's (system, messages) pair.
    /// Attachments become image blocks; extracted text is folded into the text.
    fn build_messages(params: &ChatParams) -> (Option<String>, Vec<Value>) {
        let mut system = params.system.clone();
        let mut out: Vec<Value> = Vec::new();

        for m in &params.messages {
            if m.role == "system" {
                // Anthropic has no system role inside messages — merge it up.
                system = Some(match system {
                    Some(s) => format!("{s}\n\n{}", m.content),
                    None => m.content.clone(),
                });
                continue;
            }

            let mut blocks: Vec<Value> = Vec::new();
            let mut text = m.content.clone();

            if let Some(atts) = &m.attachments {
                for a in atts {
                    if a.kind == "image" {
                        if let Some(data) = &a.data {
                            blocks.push(json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": a.mime_type,
                                    "data": data,
                                }
                            }));
                        }
                    } else if let Some(extracted) = &a.extracted_text {
                        if !extracted.is_empty() {
                            text = format!("{text}\n\n[{}]\n{extracted}", a.name);
                        }
                    }
                }
            }

            if !text.is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            if blocks.is_empty() {
                continue; // nothing to send for this turn
            }

            out.push(json!({ "role": m.role, "content": blocks }));
        }

        (system, out)
    }

    /// Convert the OpenAI-format message list used by the agent loop into
    /// Anthropic blocks: `tool_calls` → `tool_use`, role "tool" → a user turn
    /// carrying `tool_result`.
    fn convert_agent_messages(messages: Vec<Value>) -> (Option<String>, Vec<Value>) {
        let mut system: Option<String> = None;
        let mut out: Vec<Value> = Vec::new();

        for m in messages {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");

            match role {
                "system" => {
                    system = Some(match system {
                        Some(s) => format!("{s}\n\n{content}"),
                        None => content.to_string(),
                    });
                }
                "tool" => {
                    let id = m
                        .get("tool_call_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let block = json!({
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": content,
                    });
                    // Consecutive tool results belong to one user turn.
                    match out.last_mut() {
                        Some(last)
                            if last.get("role").and_then(|r| r.as_str()) == Some("user")
                                && last
                                    .get("content")
                                    .and_then(|c| c.as_array())
                                    .map(|a| {
                                        a.first().and_then(|b| b.get("type")).and_then(|t| t.as_str())
                                            == Some("tool_result")
                                    })
                                    .unwrap_or(false) =>
                        {
                            if let Some(arr) =
                                last.get_mut("content").and_then(|c| c.as_array_mut())
                            {
                                arr.push(block);
                            }
                        }
                        _ => out.push(json!({ "role": "user", "content": [block] })),
                    }
                }
                "assistant" => {
                    let mut blocks: Vec<Value> = Vec::new();
                    if !content.is_empty() {
                        blocks.push(json!({ "type": "text", "text": content }));
                    }
                    if let Some(calls) = m.get("tool_calls").and_then(|c| c.as_array()) {
                        for c in calls {
                            let f = c.get("function");
                            let name = f
                                .and_then(|f| f.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            let args = f
                                .and_then(|f| f.get("arguments"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("{}");
                            blocks.push(json!({
                                "type": "tool_use",
                                "id": c.get("id").and_then(|v| v.as_str()).unwrap_or_default(),
                                "name": name,
                                "input": serde_json::from_str::<Value>(args)
                                    .unwrap_or_else(|_| json!({})),
                            }));
                        }
                    }
                    if !blocks.is_empty() {
                        out.push(json!({ "role": "assistant", "content": blocks }));
                    }
                }
                _ => {
                    if !content.is_empty() {
                        out.push(json!({
                            "role": "user",
                            "content": [{ "type": "text", "text": content }],
                        }));
                    }
                }
            }
        }

        (system, out)
    }

    async fn api_error(resp: reqwest::Response) -> ProviderError {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        ProviderError::Api(format!("{code}: {body}"))
    }
}

#[async_trait]
impl Provider for Anthropic {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let resp = self
            .http
            .get(self.conn.endpoint("models"))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(Self::api_error(resp).await);
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;

        let list = v
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(list
            .iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let label = m
                    .get("display_name")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string());
                Some(ModelInfo { id, label })
            })
            .collect())
    }

    async fn chat_stream(
        &self,
        params: ChatParams,
        channel: &Channel<StreamEvent>,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let (system, messages) = Self::build_messages(&params);

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "max_tokens": MAX_TOKENS,
            "stream": true,
        });
        if let Some(s) = system {
            body["system"] = json!(s);
        }
        if supports_thinking(&params.model) {
            // Extended thinking: the model reasons in its own block before it
            // answers, and we can show that live. Temperature must not be set
            // alongside it — the API rejects the combination.
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": THINKING_BUDGET });
            body["max_tokens"] = json!(MAX_TOKENS.max(THINKING_BUDGET + 4096));
        } else if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
        }

        let resp = self
            .request("messages")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            let err = Self::api_error(resp).await;
            let _ = channel.send(StreamEvent::Error {
                message: err.to_string(),
            });
            return Err(err);
        }

        // Anthropic SSE: `content_block_delta` carries `delta.text_delta`,
        // and — with thinking enabled — `delta.thinking` for the reasoning
        // block. Token counts arrive on `message_start` and `message_delta`.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        // Decode across chunk boundaries: a Cyrillic letter is two bytes and
        // the network splits wherever it likes (see utf8.rs).
        let mut decoder = crate::utf8::Utf8Stream::new();

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = channel.send(StreamEvent::Done {
                    finish_reason: Some("cancelled".into()),
                });
                return Ok(());
            }
            let bytes = chunk.map_err(|e| ProviderError::Network(e.to_string()))?;
            buf.push_str(&decoder.push(&bytes));

            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf.drain(..=idx);
                let Some(payload) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(payload) else {
                    continue;
                };
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("content_block_delta") => {
                        let delta = v.get("delta");
                        if let Some(text) = delta.and_then(|d| d.get("text")).and_then(|t| t.as_str())
                        {
                            let _ = channel.send(StreamEvent::Delta {
                                content: text.to_string(),
                            });
                        } else if let Some(thought) = delta
                            .and_then(|d| d.get("thinking"))
                            .and_then(|t| t.as_str())
                        {
                            let _ = channel.send(StreamEvent::Reasoning {
                                content: thought.to_string(),
                            });
                        }
                    }
                    Some("message_start") => {
                        if let Some(u) = v.get("message").and_then(|m| m.get("usage")) {
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: u.get("input_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                                output_tokens: None,
                            });
                        }
                    }
                    Some("message_delta") => {
                        if let Some(u) = v.get("usage") {
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: None,
                                output_tokens: u.get("output_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                            });
                        }
                    }
                    Some("message_stop") => {
                        let _ = channel.send(StreamEvent::Done {
                            finish_reason: Some("stop".into()),
                        });
                        return Ok(());
                    }
                    Some("error") => {
                        let msg = v.get("error").map(|e| e.to_string()).unwrap_or_default();
                        let _ = channel.send(StreamEvent::Error { message: msg });
                        return Ok(());
                    }
                    _ => {}
                }
            }
        }

        let _ = channel.send(StreamEvent::Done {
            finish_reason: None,
        });
        Ok(())
    }

    async fn complete(&self, params: ChatParams) -> Result<String, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let (system, messages) = Self::build_messages(&params);

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "max_tokens": MAX_TOKENS,
        });
        if let Some(s) = system {
            body["system"] = json!(s);
        }

        let resp = self
            .request("messages")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(Self::api_error(resp).await);
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;

        Ok(v.get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default())
    }

    async fn agent_step(
        &self,
        model: String,
        messages: Vec<Value>,
        tools: Vec<ToolDef>,
    ) -> Result<AgentStep, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let (system, msgs) = Self::convert_agent_messages(messages);

        // Anthropic calls the schema `input_schema`, not `parameters`.
        let tools_json: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect();

        let mut body = json!({
            "model": model,
            "messages": msgs,
            "max_tokens": MAX_TOKENS,
        });
        if let Some(s) = system {
            body["system"] = json!(s);
        }
        if !tools_json.is_empty() {
            body["tools"] = json!(tools_json);
        }

        let resp = self
            .request("messages")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(Self::api_error(resp).await);
        }

        let v: Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Api(e.to_string()))?;

        let mut text = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        if let Some(blocks) = v.get("content").and_then(|c| c.as_array()) {
            for b in blocks {
                match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        tool_calls.push(ToolCall {
                            id: b
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            name: b
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            // The agent loop expects arguments as a JSON string.
                            arguments: b
                                .get("input")
                                .map(|i| i.to_string())
                                .unwrap_or_else(|| "{}".into()),
                        });
                    }
                    _ => {}
                }
            }
        }

        Ok(AgentStep {
            content: if text.is_empty() { None } else { Some(text) },
            tool_calls,
        })
    }

    async fn agent_step_stream(
        &self,
        model: String,
        messages: Vec<Value>,
        tools: Vec<ToolDef>,
        channel: &Channel<StreamEvent>,
        cancel: Arc<AtomicBool>,
    ) -> Result<AgentStep, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let (system, msgs) = Self::convert_agent_messages(messages);

        let tools_json: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect();

        let thinking = supports_thinking(&model);
        let mut body = json!({
            "model": model,
            "messages": msgs,
            // Agent turns are where the model needs room: it has to reason
            // about the project AND emit tool calls. The old 8k cap truncated
            // long turns, which is part of why the agent looked dim.
            "max_tokens": if thinking { MAX_TOKENS.max(THINKING_BUDGET + 8192) } else { MAX_TOKENS * 2 },
            "stream": true,
        });
        if let Some(s) = system {
            // Cache the system block: it carries the agent prompt plus the whole
            // project memory and is byte-identical on every step of a run.
            // Without this Claude re-reads and re-bills all of it each step,
            // which is both the slowest and the most expensive part of a run.
            body["system"] = json!([{
                "type": "text",
                "text": s,
                "cache_control": { "type": "ephemeral" }
            }]);
        }
        if !tools_json.is_empty() {
            body["tools"] = json!(tools_json);
        }
        if thinking {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": THINKING_BUDGET });
        }

        let resp = self
            .request("messages")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(Self::api_error(resp).await);
        }

        // Anthropic streams each content block separately: text arrives as
        // text_delta, a tool call opens with content_block_start (id + name)
        // and then its arguments accumulate as input_json_delta fragments.
        let mut text = String::new();
        let mut calls: Vec<ToolCall> = Vec::new();
        let mut open: Option<(String, String, String)> = None;

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        // Decode across chunk boundaries: a Cyrillic letter is two bytes and
        // the network splits wherever it likes (see utf8.rs).
        let mut decoder = crate::utf8::Utf8Stream::new();

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let bytes = chunk.map_err(|e| ProviderError::Network(e.to_string()))?;
            buf.push_str(&decoder.push(&bytes));

            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf.drain(..=idx);
                let Some(payload) = line.strip_prefix("data:") else { continue };
                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(payload) else { continue };

                match v.get("type").and_then(|t| t.as_str()) {
                    Some("content_block_start") => {
                        let block = v.get("content_block");
                        if block.and_then(|b| b.get("type")).and_then(|t| t.as_str())
                            == Some("tool_use")
                        {
                            open = Some((
                                block
                                    .and_then(|b| b.get("id"))
                                    .and_then(|x| x.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                block
                                    .and_then(|b| b.get("name"))
                                    .and_then(|x| x.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                String::new(),
                            ));
                        }
                    }
                    Some("content_block_delta") => {
                        let delta = v.get("delta");
                        if let Some(t) = delta.and_then(|d| d.get("text")).and_then(|x| x.as_str()) {
                            text.push_str(t);
                            let _ = channel.send(StreamEvent::Delta { content: t.to_string() });
                        } else if let Some(th) =
                            delta.and_then(|d| d.get("thinking")).and_then(|x| x.as_str())
                        {
                            let _ = channel.send(StreamEvent::Reasoning { content: th.to_string() });
                        } else if let Some(frag) = delta
                            .and_then(|d| d.get("partial_json"))
                            .and_then(|x| x.as_str())
                        {
                            if let Some(slot) = open.as_mut() {
                                slot.2.push_str(frag);
                            }
                        }
                    }
                    Some("content_block_stop") => {
                        if let Some((id, name, args)) = open.take() {
                            if !name.is_empty() {
                                calls.push(ToolCall {
                                    id,
                                    name,
                                    arguments: if args.trim().is_empty() { "{}".into() } else { args },
                                });
                            }
                        }
                    }
                    Some("message_start") => {
                        if let Some(u) = v.get("message").and_then(|m| m.get("usage")) {
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: u.get("input_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                                output_tokens: None,
                            });
                        }
                    }
                    Some("message_delta") => {
                        if let Some(u) = v.get("usage") {
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: None,
                                output_tokens: u.get("output_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                            });
                        }
                    }
                    Some("message_stop") => break,
                    Some("error") => {
                        let msg = v.get("error").map(|e| e.to_string()).unwrap_or_default();
                        return Err(ProviderError::Api(msg));
                    }
                    _ => {}
                }
            }
        }

        Ok(AgentStep {
            content: (!text.is_empty()).then_some(text),
            tool_calls: calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinking_is_offered_for_recent_claude_only() {
        assert!(supports_thinking("claude-3-7-sonnet"));
        assert!(supports_thinking("claude-opus-4-20250101"));
        assert!(supports_thinking("claude-sonnet-4-5"));
        assert!(supports_thinking("claude-opus-5"));
        // Older Claude and non-Claude models do not.
        assert!(!supports_thinking("claude-2.1"));
        assert!(!supports_thinking("claude-3-haiku"));
        assert!(!supports_thinking("gpt-4o"));
    }
}
