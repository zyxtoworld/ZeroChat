use crate::models::{ChatMessage, ProviderConfig, ProviderKind};
use anyhow::{Context, Result, bail};
use reqwest::Url;
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
        proxy_token: &str,
    ) -> Result<String> {
        let endpoint = match &provider.proxy_url {
            Some(proxy) if !proxy.trim().is_empty() => {
                format!("{}/proxy", safe_base_url(proxy, "代理地址")?)
            }
            None => match provider.kind {
                ProviderKind::Anthropic => {
                    format!(
                        "{}/messages",
                        safe_base_url(&provider.base_url, "Base URL")?
                    )
                }
                ProviderKind::OpenaiCompatible => {
                    format!(
                        "{}/chat/completions",
                        safe_base_url(&provider.base_url, "Base URL")?
                    )
                }
            },
            Some(_) => match provider.kind {
                ProviderKind::Anthropic => {
                    format!(
                        "{}/messages",
                        safe_base_url(&provider.base_url, "Base URL")?
                    )
                }
                ProviderKind::OpenaiCompatible => {
                    format!(
                        "{}/chat/completions",
                        safe_base_url(&provider.base_url, "Base URL")?
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

        if matches!(&provider.proxy_url, Some(proxy) if !proxy.trim().is_empty()) {
            if proxy_token.trim().is_empty() {
                bail!("代理访问密钥为空");
            }

            request = request
                .header("x-zerochat-proxy-token", proxy_token.trim())
                .header(
                    "x-zerochat-base-url",
                    safe_base_url(&provider.base_url, "Base URL")?,
                )
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

fn safe_base_url(value: &str, label: &str) -> Result<String> {
    let endpoint = value.trim().trim_end_matches('/');
    let url = Url::parse(endpoint)?;
    let host = url.host_str().unwrap_or_default();
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    let is_safe_scheme = url.scheme() == "https" || (url.scheme() == "http" && is_loopback);

    if !url.username().is_empty() || url.password().is_some() {
        bail!("{label} 不能包含用户名或密码");
    }

    if url.query().is_some() || url.fragment().is_some() {
        bail!("{label} 不能包含 query 或 fragment");
    }

    if !is_safe_scheme {
        bail!("{label} 必须使用 HTTPS，本机调试地址除外");
    }

    Ok(endpoint.to_owned())
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
