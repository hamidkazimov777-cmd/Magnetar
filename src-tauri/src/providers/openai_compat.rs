//! OpenAI-compatible adapter. Works with OpenRouter, Kimi/Moonshot, TokenRouter,
//! LM Studio, Ollama's OpenAI shim, etc. Streams via SSE (`stream: true`).

use super::{
    AgentStep, ChatParams, Connection, ModelInfo, Provider, ProviderError, StreamEvent, ToolCall,
    ToolDef,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

pub struct OpenAiCompat {
    conn: Connection,
    api_key: String,
    http: reqwest::Client,
}

impl OpenAiCompat {
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
            messages.push(json!({ "role": m.role, "content": m.content }));
        }

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "stream": true,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
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
            let _ = channel.send(StreamEvent::Error {
                message: format!("{code}: {text}"),
            });
            return Err(ProviderError::Api(format!("{code}: {text}")));
        }

        // Parse the SSE byte stream. Lines look like `data: {json}` and a final
        // `data: [DONE]`. Buffer across chunk boundaries.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| ProviderError::Network(e.to_string()))?;
            buf.push_str(&String::from_utf8_lossy(&bytes));

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
            messages.push(json!({ "role": m.role, "content": m.content }));
        }

        let mut body = json!({
            "model": params.model,
            "messages": messages,
            "stream": false,
        });
        if let Some(t) = params.temperature {
            body["temperature"] = json!(t);
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
        messages: Vec<Value>,
        tools: Vec<ToolDef>,
    ) -> Result<AgentStep, ProviderError> {
        if self.api_key.is_empty() {
            return Err(ProviderError::MissingKey);
        }

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
}
