use anyhow::{Context, Result, anyhow, bail};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio::time::{Duration, timeout};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use crate::ai::{AI_STREAM_IDLE_TIMEOUT_MS, ensure_non_empty_chat_response};
use crate::ai_protocol::{
    endpoint_for, model_context_char_budget, provider_needs_client_key, responses_chat_messages,
    select_context_messages_with_char_budget,
};
use crate::models::{ChatMessage, ProviderConfig, ProviderKind};

const RESPONSES_WEBSOCKET_BETA: &str = "responses_websockets=2026-02-06";

#[derive(Debug)]
pub(crate) struct ResponsesWebSocketFallback {
    pub(crate) message: String,
}

impl std::fmt::Display for ResponsesWebSocketFallback {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ResponsesWebSocketFallback {}

fn websocket_endpoint(provider: &ProviderConfig) -> Result<(String, bool)> {
    let endpoint = endpoint_for(provider)?;
    let proxy = provider
        .proxy_url
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty());

    if proxy {
        let root = endpoint
            .strip_suffix("/proxy")
            .ok_or_else(|| anyhow!("Invalid Worker proxy URL."))?;
        return Ok((format!("{root}/proxy/ws"), true));
    }

    let endpoint = endpoint
        .strip_prefix("https://")
        .map(|value| format!("wss://{value}"))
        .ok_or_else(|| anyhow!("Responses WebSocket requires an HTTPS endpoint."))?;
    Ok((endpoint, false))
}

fn response_create_message(
    provider: &ProviderConfig,
    model: &str,
    messages: &[ChatMessage],
    context_message_limit: i32,
) -> String {
    let context = select_context_messages_with_char_budget(
        messages,
        context_message_limit,
        model_context_char_budget(provider, model),
    )
    .into_iter()
    .collect::<Vec<_>>();
    json!({
        "type": "response.create",
        "model": model.trim(),
        "input": responses_chat_messages(&context),
        "store": false,
        "temperature": 0.7,
    })
    .to_string()
}

fn proxy_authorization_message(
    provider: &ProviderConfig,
    api_key: &str,
    access_key: &str,
) -> String {
    let mut value = json!({
        "type": "zerochat.proxy.authorize",
        "accessKey": access_key.trim(),
        "providerKind": "openai-responses",
        "baseUrl": provider.base_url,
    });
    if provider_needs_client_key(provider) {
        value["apiKey"] = Value::String(api_key.trim().to_owned());
    }
    value.to_string()
}

fn event_type(value: &Value) -> &str {
    value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn event_error_message(value: &Value) -> String {
    value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("Responses WebSocket request failed.")
        .to_owned()
}

pub(crate) async fn stream_responses_websocket<F>(
    provider: &ProviderConfig,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    context_message_limit: i32,
    access_key: &str,
    mut cancellation: watch::Receiver<bool>,
    on_partial: &mut F,
) -> Result<Option<String>>
where
    F: FnMut(String) -> bool,
{
    if !matches!(provider.kind, ProviderKind::OpenaiResponses) {
        return Ok(None);
    }

    let (endpoint, proxy) = websocket_endpoint(provider)?;
    let mut request = endpoint
        .into_client_request()
        .context("Responses WebSocket request is invalid")?;
    request.headers_mut().insert(
        "OpenAI-Beta",
        HeaderValue::from_static(RESPONSES_WEBSOCKET_BETA),
    );
    if !proxy && provider_needs_client_key(provider) {
        let value = format!("Bearer {}", api_key.trim());
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&value)
                .context("Responses WebSocket authorization is invalid")?,
        );
    }

    let connection = timeout(Duration::from_millis(10_000), connect_async(request))
        .await
        .map_err(|_| ResponsesWebSocketFallback {
            message: "Responses WebSocket connection timed out.".to_owned(),
        })?
        .map_err(|error| ResponsesWebSocketFallback {
            message: format!("Responses WebSocket connection failed: {error}"),
        })?;

    let (mut socket, _) = connection;
    if proxy {
        socket
            .send(Message::Text(
                proxy_authorization_message(provider, api_key, access_key).into(),
            ))
            .await
            .context("Responses WebSocket authorization send failed")?;

        let ready = timeout(
            Duration::from_millis(AI_STREAM_IDLE_TIMEOUT_MS),
            socket.next(),
        )
        .await
        .map_err(|_| ResponsesWebSocketFallback {
            message: "Responses WebSocket proxy authorization timed out.".to_owned(),
        })?
        .ok_or_else(|| ResponsesWebSocketFallback {
            message: "Responses WebSocket closed during proxy authorization.".to_owned(),
        })?
        .context("Responses WebSocket proxy authorization failed")?;

        let ready = match ready {
            Message::Text(text) => serde_json::from_str::<Value>(text.as_ref())?,
            Message::Binary(bytes) => serde_json::from_slice::<Value>(&bytes)?,
            _ => bail!("Responses WebSocket returned an invalid authorization event."),
        };
        if event_type(&ready) != "zerochat.proxy.ready" {
            return Err(ResponsesWebSocketFallback {
                message: event_error_message(&ready),
            }
            .into());
        }
    }

    socket
        .send(Message::Text(
            response_create_message(provider, model, messages, context_message_limit).into(),
        ))
        .await
        .context("Responses WebSocket request send failed")?;

    let mut received = String::new();
    loop {
        let next = tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() { bail!("Generation stopped"); }
                continue;
            }
            next = timeout(Duration::from_millis(AI_STREAM_IDLE_TIMEOUT_MS), socket.next()) => next
                .map_err(|_| anyhow!("AI streaming response timed out."))?,
        };
        let Some(message) = next else {
            if received.is_empty() {
                return Err(ResponsesWebSocketFallback {
                    message: "Responses WebSocket closed before output.".to_owned(),
                }
                .into());
            }
            break;
        };

        let value = match message.context("Responses WebSocket stream failed")? {
            Message::Text(text) => serde_json::from_str::<Value>(text.as_ref())?,
            Message::Binary(bytes) => serde_json::from_slice::<Value>(&bytes)?,
            Message::Close(_) => break,
            _ => continue,
        };

        match event_type(&value) {
            "response.output_text.delta" => {
                let delta = value
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if delta.is_empty() {
                    continue;
                }
                received.push_str(delta);
                if !on_partial(received.clone()) {
                    break;
                }
            }
            "response.completed" => break,
            "response.failed" | "response.incomplete" | "error" => {
                if received.is_empty() {
                    return Err(ResponsesWebSocketFallback {
                        message: event_error_message(&value),
                    }
                    .into());
                }
                bail!(event_error_message(&value));
            }
            _ => {}
        }
    }

    Ok(Some(ensure_non_empty_chat_response(received)?))
}
