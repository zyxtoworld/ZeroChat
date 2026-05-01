use crate::models::{ChatMessage, ProviderConfig, ProviderKind};
use anyhow::{Context, Result};
use serde::Serialize;

pub struct AiClient {
    http: reqwest::Client,
}

impl AiClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    pub async fn send(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        model: &str,
        messages: &[ChatMessage],
    ) -> Result<String> {
        let endpoint = match &provider.proxy_url {
            Some(proxy) => format!("{}/proxy", proxy.trim_end_matches('/')),
            None => match provider.kind {
                ProviderKind::Anthropic => {
                    format!("{}/messages", provider.base_url.trim_end_matches('/'))
                }
                ProviderKind::OpenaiCompatible => {
                    format!(
                        "{}/chat/completions",
                        provider.base_url.trim_end_matches('/')
                    )
                }
            },
        };

        let body = OpenAiRequest {
            model,
            messages: messages
                .iter()
                .map(|message| OpenAiMessage {
                    role: match message.role {
                        crate::models::MessageRole::System => "system",
                        crate::models::MessageRole::User => "user",
                        crate::models::MessageRole::Assistant => "assistant",
                    },
                    content: &message.content,
                })
                .collect(),
            stream: false,
            temperature: 0.7,
        };

        let mut request = self.http.post(endpoint).json(&body);

        if let Some(_) = provider.proxy_url {
            request = request
                .header("x-zerochat-base-url", &provider.base_url)
                .header(
                    "x-zerochat-provider-kind",
                    match provider.kind {
                        ProviderKind::Anthropic => "anthropic",
                        ProviderKind::OpenaiCompatible => "openai-compatible",
                    },
                );
        }

        request = match provider.kind {
            ProviderKind::Anthropic => request.header("x-api-key", api_key),
            ProviderKind::OpenaiCompatible => request.bearer_auth(api_key),
        };

        Ok(request
            .send()
            .await?
            .text()
            .await
            .context("读取 AI 响应失败")?)
    }
}

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    stream: bool,
    temperature: f32,
}

#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}
