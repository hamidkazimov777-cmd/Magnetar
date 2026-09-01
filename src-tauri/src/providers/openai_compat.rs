//! OpenAI-compatible adapter. Works with OpenRouter, Kimi/Moonshot, TokenRouter,
//! LM Studio, Ollama's OpenAI shim, etc. Streams via SSE (`stream: true`).

use super::{
    AgentStep, ChatParams, Connection, ModelInfo, Provider, ProviderError, StreamEvent, ToolCall,
    ToolDef,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;

pub struct OpenAiCompat {
    conn: Connection,
    api_key: String,
    http: reqwest::Client,
}

/// Prompt caching is worth turning on for gateways/models that honor
/// `cache_control` breakpoints (Anthropic + Gemini via OpenRouter). Elsewhere we
/// leave messages as plain strings — OpenAI itself caches automatically, and
/// unknown endpoints may reject the block form.
fn supports_prompt_cache(base_url: &str, model: &str) -> bool {
    let b = base_url.to_lowercase();
    let m = model.to_lowercase();
    b.contains("openrouter")
        && (m.contains("claude") || m.contains("anthropic") || m.contains("gemini"))
}

/// Mark the (large, stable) system prompt as a cache breakpoint so repeated
/// turns don't re-bill it.
fn maybe_cache_system(messages: &mut [Value], enabled: bool) {
    if !enabled {
        return;
    }
    if let Some(sys) = messages
        .iter_mut()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))
    {
        if let Some(text) = sys.get("content").and_then(|c| c.as_str()).map(String::from) {
            sys["content"] = json!([{
                "type": "text",
                "text": text,
                "cache_control": { "type": "ephemeral" }
            }]);
        }
    }
}

fn format_message(m: &crate::providers::ChatMessage) -> Value {
    // Fold any non-image file text (e.g. extracted PDF/txt) into the message text
    // so plain chat "attach a PDF and ask" works, not just images.
    let mut text = m.content.clone();
    if let Some(atts) = &m.attachments {
        for a in atts {
            if a.kind != "image" {
                if let Some(t) = &a.extracted_text {
                    if !t.is_empty() {
                        text.push_str(&format!("\n\n[Attached file: {}]\n{}", a.name, t));
                    }
                }
            }
        }
    }

    let has_images = m
        .attachments
        .as_ref()
        .map(|atts| atts.iter().any(|a| a.kind == "image" && a.data.is_some()))
        .unwrap_or(false);

    if !has_images {
        json!({ "role": m.role, "content": text })
    } else {
        let mut content = vec![json!({ "type": "text", "text": text })];
        if let Some(atts) = &m.attachments {
            for a in atts {
                if a.kind == "image" {
                    if let Some(data) = &a.data {
                        // Frontend may send a full data: URL or bare base64.
                        let url = if data.starts_with("data:") {
                            data.clone()
                        } else {
                            format!("data:{};base64,{}", a.mime_type, data)
                        };
                        content.push(json!({
                            "type": "image_url",
                            "image_url": { "url": url }
                        }));
                    }
                }
            }
        }
        json!({ "role": m.role, "content": content })
    }
}

/// True when a provider refused the request because of `temperature`.
///
/// Reasoning models reject any temperature but their own: Kimi K3 answers
/// "invalid temperature: only 1 is allowed for this model", OpenAI's o-series
/// says something similar. We send temperature 0 for background work (JSON
/// extraction wants determinism), so rather than maintaining a list of which
/// models are picky — a list that is wrong the week it is written — we notice
/// the refusal and retry once without the field.
fn is_temperature_refusal(status: reqwest::StatusCode, body: &str) -> bool {
    status.as_u16() == 400 && body.to_ascii_lowercase().contains("temperature")
}

impl OpenAiCompat {
    /// POST a chat request, retrying once without `temperature` if that is what
    /// the provider objected to. Returns the response and the body it used.
    async fn post_chat(
        &self,
        mut body: Value,
    ) -> Result<(reqwest::Response, Value), ProviderError> {
        let url = self.conn.endpoint("chat/completions");
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if resp.status().is_success() || body.get("temperature").is_none() {
            return Ok((resp, body));
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !is_temperature_refusal(status, &text) {
            return Err(ProviderError::Api(format!("{status}: {text}")));
        }

        if let Some(obj) = body.as_object_mut() {
            obj.remove("temperature");
        }
        let retry = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;
        Ok((retry, body))
    }

    pub fn new(conn: Connection, api_key: String) -> Self {
        Self {
            conn,
            api_key,
            http: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl Provider for OpenAiCompat {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        let resp = self
            .http
            .get(self.conn.endpoint("models"))
            .bearer_auth(&self.api_key)
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

        // Standard shape: { "data": [ { "id": "..." }, ... ] }. Some gateways
        // return a bare array — tolerate both.
        let arr = v
            .get("data")
            .and_then(|d| d.as_array())
            .or_else(|| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut models: Vec<ModelInfo> = arr
            .iter()
            .filter_map(|m| {
                let id = m.get("id").and_then(|x| x.as_str())?.to_string();
                let label = m
                    .get("name")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                Some(ModelInfo { id, label })
            })
            .collect();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    async fn chat_stream(
        &self,
        params: ChatParams,
        channel: &Channel<StreamEvent>,
        cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<(), ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }

        let mut messages: Vec<Value> = Vec::new();
        if let Some(sys) = &params.system {
            if !sys.is_empty() {
                messages.push(json!({ "role": "system", "content": sys }));
            }
        }
        for m in &params.messages {
            messages.push(format_message(m));
        }
        maybe_cache_system(
            &mut messages,
            supports_prompt_cache(&self.conn.base_url, &params.model),
        );

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "stream": true,
            // Ask for the token counts. Gateways that do not know this field
            // ignore it; the ones that do send a final usage-only chunk.
            "stream_options": { "include_usage": true },
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
        }

        let (resp, _) = self.post_chat(body).await?;

        if !resp.status().is_success() {
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let _ = channel.send(StreamEvent::Error {
                message: format!("{code}: {text}"),
            });
            return Err(ProviderError::Api(format!("{code}: {text}")));
        }

        // Parse the SSE byte stream. Lines look like `data: {json}` and a final
        // `data: [DONE]`. Buffer across chunk boundaries.
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

                match serde_json::from_str::<Value>(data) {
                    Ok(v) => {
                        // Usage arrives on its own final chunk, with an empty
                        // choices array, so read it before touching choices.
                        if let Some(u) = v.get("usage") {
                            let _ = channel.send(StreamEvent::Usage {
                                input_tokens: u
                                    .get("prompt_tokens")
                                    .and_then(|x| x.as_u64())
                                    .map(|x| x as u32),
                                output_tokens: u
                                    .get("completion_tokens")
                                    .and_then(|x| x.as_u64())
                                    .map(|x| x as u32),
                            });
                        }

                        let choice = v.get("choices").and_then(|c| c.get(0));
                        let delta = choice.and_then(|c| c.get("delta"));

                        // Reasoning models put their thinking in a separate
                        // field. OpenRouter calls it `reasoning`, DeepSeek and
                        // several others `reasoning_content`; both appear as
                        // deltas alongside the answer.
                        if let Some(thought) = delta
                            .and_then(|d| d.get("reasoning").or_else(|| d.get("reasoning_content")))
                            .and_then(|r| r.as_str())
                        {
                            if !thought.is_empty() {
                                let _ = channel.send(StreamEvent::Reasoning {
                                    content: thought.to_string(),
                                });
                            }
                        }

                        if let Some(content) =
                            delta.and_then(|d| d.get("content")).and_then(|c| c.as_str())
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
                    // Skip keep-alive comments / malformed partials.
                    Err(_) => continue,
                }
            }
        }

        let _ = channel.send(StreamEvent::Done { finish_reason: None });
        Ok(())
    }

    async fn complete(&self, params: ChatParams) -> Result<String, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }

        let mut messages: Vec<Value> = Vec::new();
        if let Some(sys) = &params.system {
            if !sys.is_empty() {
                messages.push(json!({ "role": "system", "content": sys }));
            }
        }
        for m in &params.messages {
            messages.push(format_message(m));
        }
        maybe_cache_system(
            &mut messages,
            supports_prompt_cache(&self.conn.base_url, &params.model),
        );

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "stream": false,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
        }

        let (resp, _) = self.post_chat(body).await?;

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
            .unwrap_or_default()
            .to_string();
        Ok(content)
    }

    async fn agent_step(
        &self,
        model: String,
        mut messages: Vec<Value>,
        tools: Vec<ToolDef>,
    ) -> Result<AgentStep, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        maybe_cache_system(
            &mut messages,
            supports_prompt_cache(&self.conn.base_url, &model),
        );

        let tools_json: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();

        let mut body = json!({
            "model": model,
            "messages": messages,
            "stream": false,
        });
        if !tools_json.is_empty() {
            body["tools"] = json!(tools_json);
            body["tool_choice"] = json!("auto");
        }

        let resp = self
            .http
            .post(self.conn.endpoint("chat/completions"))
            .bearer_auth(&self.api_key)
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
        let message = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .cloned()
            .unwrap_or_else(|| json!({}));

        let content = message
            .get("content")
            .and_then(|c| c.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let tool_calls = message
            .get("tool_calls")
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|tc| {
                        let id = tc.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let func = tc.get("function")?;
                        let name = func.get("name").and_then(|x| x.as_str())?.to_string();
                        let arguments = func
                            .get("arguments")
                            .and_then(|x| x.as_str())
                            .unwrap_or("{}")
                            .to_string();
                        Some(ToolCall { id, name, arguments })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(AgentStep { content, tool_calls })
    }

    async fn agent_step_stream(
        &self,
        model: String,
        mut messages: Vec<Value>,
        tools: Vec<ToolDef>,
        channel: &Channel<StreamEvent>,
        cancel: Arc<AtomicBool>,
    ) -> Result<AgentStep, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }
        maybe_cache_system(
            &mut messages,
            supports_prompt_cache(&self.conn.base_url, &model),
        );

        let tools_json: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();

        let mut body = json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        if !tools_json.is_empty() {
            body["tools"] = json!(tools_json);
            body["tool_choice"] = json!("auto");
        }

        let (resp, _) = self.post_chat(body).await?;
        if !resp.status().is_success() {
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(format!("{code}: {text}")));
        }

        // Tool calls arrive in fragments keyed by index: the id and name come
        // first, then the arguments JSON accumulates character by character
        // across many chunks. Assemble by index, not by arrival order.
        let mut text = String::new();
        let mut partial: BTreeMap<u64, (String, String, String)> = BTreeMap::new();
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        // Decode across chunk boundaries: a Cyrillic letter is two bytes and
        // the network splits wherever it likes (see utf8.rs).
        let mut decoder = crate::utf8::Utf8Stream::new();

        'stream_loop: while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let bytes = chunk.map_err(|e| ProviderError::Network(e.to_string()))?;
            buf.push_str(&decoder.push(&bytes));

            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf.drain(..=idx);
                let Some(data) = line.strip_prefix("data:") else { continue };
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if data == "[DONE]" {
                    // The server closes the SSE stream here. Stop reading so
                    // reqwest doesn't hang waiting on a half-closed connection.
                    break 'stream_loop;
                }
                let Ok(v) = serde_json::from_str::<Value>(data) else { continue };

                if let Some(err) = v.get("error") {
                    let message = err
                        .as_str()
                        .map(String::from)
                        .or_else(|| err.get("message").and_then(|m| m.as_str()).map(String::from))
                        .unwrap_or_else(|| err.to_string());
                    return Err(ProviderError::Api(message));
                }

                if let Some(u) = v.get("usage") {
                    let _ = channel.send(StreamEvent::Usage {
                        input_tokens: u.get("prompt_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                        output_tokens: u.get("completion_tokens").and_then(|x| x.as_u64()).map(|x| x as u32),
                    });
                }

                let Some(delta) = v
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                else {
                    continue;
                };

                if let Some(thought) = delta
                    .get("reasoning")
                    .or_else(|| delta.get("reasoning_content"))
                    .and_then(|r| r.as_str())
                {
                    if !thought.is_empty() {
                        let _ = channel.send(StreamEvent::Reasoning { content: thought.to_string() });
                    }
                }

                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        text.push_str(content);
                        let _ = channel.send(StreamEvent::Delta { content: content.to_string() });
                    }
                }

                if let Some(calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                    for tc in calls {
                        let index = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                        let slot = partial.entry(index).or_default();
                        if let Some(id) = tc.get("id").and_then(|x| x.as_str()) {
                            if !id.is_empty() {
                                slot.0 = id.to_string();
                            }
                        }
                        if let Some(f) = tc.get("function") {
                            if let Some(n) = f.get("name").and_then(|x| x.as_str()) {
                                if !n.is_empty() {
                                    slot.1 = n.to_string();
                                }
                            }
                            if let Some(a) = f.get("arguments").and_then(|x| x.as_str()) {
                                slot.2.push_str(a);
                            }
                        }
                    }
                }
            }
        }

        let tool_calls: Vec<ToolCall> = partial
            .into_values()
            .filter(|(_, name, _)| !name.is_empty())
            .map(|(id, name, arguments)| ToolCall {
                id: if id.is_empty() { format!("call_{name}") } else { id },
                name,
                arguments: if arguments.trim().is_empty() { "{}".into() } else { arguments },
            })
            .collect();

        Ok(AgentStep {
            content: (!text.is_empty()).then_some(text),
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_temperature_refusal_is_a_400_that_names_temperature() {
        // The retry-without-temperature path hinges on this: a 400 mentioning
        // temperature is retried, anything else is a real error.
        assert!(is_temperature_refusal(
            reqwest::StatusCode::BAD_REQUEST,
            "Unsupported value: 'temperature' is not supported",
        ));
        assert!(!is_temperature_refusal(
            reqwest::StatusCode::BAD_REQUEST,
            "invalid api key",
        ));
        assert!(!is_temperature_refusal(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "temperature",
        ));
    }

    #[test]
    fn prompt_cache_is_openrouter_plus_an_anthropic_family_model() {
        assert!(supports_prompt_cache(
            "https://openrouter.ai/api/v1",
            "anthropic/claude-3.5-sonnet"
        ));
        assert!(supports_prompt_cache("https://OpenRouter.ai", "google/gemini-pro"));
        // Not OpenRouter, or not a cacheable family:
        assert!(!supports_prompt_cache("https://api.openai.com/v1", "gpt-4o"));
        assert!(!supports_prompt_cache("https://openrouter.ai", "meta/llama-3"));
    }

    #[test]
    fn caching_wraps_only_the_system_prompt() {
        let mut msgs = vec![
            json!({"role": "system", "content": "S"}),
            json!({"role": "user", "content": "U"}),
        ];
        maybe_cache_system(&mut msgs, true);
        assert_eq!(msgs[0]["content"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(msgs[0]["content"][0]["text"], "S");
        // The user turn is left exactly as it was.
        assert_eq!(msgs[1]["content"], "U");
    }

    #[test]
    fn caching_disabled_changes_nothing() {
        let mut msgs = vec![json!({"role": "system", "content": "S"})];
        maybe_cache_system(&mut msgs, false);
        assert_eq!(msgs[0]["content"], "S");
    }
}
