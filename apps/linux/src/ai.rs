pub(crate) use crate::ai_protocol::{GeneratedImage, ImageUpload};

use crate::{
    ai_protocol::{
        AnthropicRequest, AudioUpload, ImageGenerationRequest, OpenAiChatRequest,
        OpenAiResponsesRequest, anthropic_chat_messages, apply_auth_headers, apply_proxy_headers,
        audio_speech_endpoint, audio_speech_request, audio_transcription_endpoint,
        audio_transcription_request, chat_text_from_response, embeddings_endpoint,
        embeddings_request, endpoint_for, generated_image_from_json, image_edit_endpoint,
        image_edit_upload_part, image_generation_endpoint, image_responses_endpoint,
        model_list_endpoint, moderations_endpoint, moderations_request, openai_chat_messages,
        parse_model_ids, process_sse_event, process_sse_line, provider_needs_client_key,
        realtime_client_secrets_endpoint, realtime_client_secrets_request, realtime_endpoint,
        realtime_request, responses_chat_messages, responses_image_edit_request,
        responses_image_generation_request, safe_generated_image_url, select_context_messages,
        split_anthropic_messages,
    },
    image_request_policy::{
        DirectImageFailureAction, ImageRequestFailure, ResponsesImageFailureAction,
        direct_image_failure_action, responses_image_failure_action,
    },
    local_file::MAX_IMAGE_FILE_BYTES,
    models::{ChatMessage, ProviderConfig, ProviderKind},
    sync_http_body::{read_bounded_bytes, read_bounded_text},
};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use futures_util::StreamExt;
use reqwest::{StatusCode, header::CONTENT_TYPE, multipart, redirect::Policy};
use serde_json::{Value, json};
use std::{error::Error, fmt, future::Future, time::Duration};
use tokio::sync::watch;
use tokio::time::timeout;

pub(crate) const AI_CONNECT_TIMEOUT_MS: u64 = 30_000;
pub(crate) const AI_MODEL_LIST_TIMEOUT_MS: u64 = 30_000;
pub(crate) const AI_CHAT_REQUEST_TIMEOUT_MS: u64 = 60_000;
pub(crate) const AI_IMAGE_REQUEST_TIMEOUT_MS: u64 = 180_000;
pub(crate) const AI_CAPABILITY_REQUEST_TIMEOUT_MS: u64 = 60_000;
pub(crate) const AI_STREAM_IDLE_TIMEOUT_MS: u64 = 90_000;
pub(crate) const MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES: usize = 16_384;
pub(crate) const MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES: usize = 8_000_000;
pub(crate) const MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES: usize = 32_000_000;
pub(crate) const MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES: usize = 32_000_000;
pub(crate) const MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES: usize = 8_000_000;

#[derive(Debug)]
pub(crate) struct AiHttpFailure {
    status: u16,
    message: String,
}

impl AiHttpFailure {
    pub(crate) fn new(status: u16, message: String) -> Self {
        Self { status, message }
    }

    pub(crate) fn status(&self) -> u16 {
        self.status
    }
}

impl fmt::Display for AiHttpFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for AiHttpFailure {}

#[derive(Debug)]
pub(crate) struct AiTimeoutFailure {
    message: &'static str,
}

impl AiTimeoutFailure {
    pub(crate) fn new(message: &'static str) -> Self {
        Self { message }
    }
}

impl fmt::Display for AiTimeoutFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl Error for AiTimeoutFailure {}

#[derive(Debug)]
pub(crate) struct AiEmptyResponseFailure;

impl AiEmptyResponseFailure {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl fmt::Display for AiEmptyResponseFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("The provider returned an empty response.")
    }
}

impl Error for AiEmptyResponseFailure {}

fn ensure_non_empty_chat_response(received: String) -> Result<String> {
    if received.trim().is_empty() {
        return Err(AiEmptyResponseFailure::new().into());
    }

    Ok(received)
}

fn generated_image_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

pub struct AiClient {
    http: reqwest::Client,
}

impl AiClient {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(AI_CONNECT_TIMEOUT_MS))
            .redirect(Policy::none())
            .build()
            .map_err(|_| anyhow!("AI service is unavailable."))?;

        Ok(Self { http })
    }

    pub async fn send(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        model: &str,
        messages: &[ChatMessage],
        context_message_limit: i32,
        access_key: &str,
    ) -> Result<String> {
        if provider_needs_client_key(provider) && api_key.trim().is_empty() {
            bail!("Provider key is required.");
        }

        if model.trim().is_empty() {
            bail!("Model name is required.");
        }

        let transport_messages = select_context_messages(messages, context_message_limit);
        let mut request = self.http.post(endpoint_for(provider)?);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "chat")?;

        let response =
            provider_timeout(AI_CHAT_REQUEST_TIMEOUT_MS, "AI request timed out.", async {
                let response = match provider.kind {
                    ProviderKind::OpenaiCompatible => {
                        request
                            .json(&OpenAiChatRequest {
                                model: model.trim(),
                                messages: openai_chat_messages(&transport_messages),
                                stream: false,
                                temperature: 0.7,
                            })
                            .send()
                            .await?
                    }
                    ProviderKind::OpenaiResponses => {
                        request
                            .json(&OpenAiResponsesRequest {
                                model: model.trim(),
                                input: responses_chat_messages(&transport_messages),
                                stream: false,
                                store: false,
                                temperature: 0.7,
                            })
                            .send()
                            .await?
                    }
                    ProviderKind::Anthropic => {
                        let (system, messages) =
                            split_anthropic_messages(anthropic_chat_messages(&transport_messages));

                        request
                            .json(&AnthropicRequest {
                                model: model.trim(),
                                system,
                                messages,
                                stream: false,
                                max_tokens: 4096,
                            })
                            .send()
                            .await?
                    }
                };

                Ok(response)
            })
            .await?;

        let status = response.status();
        let (max_bytes, label) = provider_response_budget(
            status,
            MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
            "AI chat response",
        );
        let text = provider_timeout(
            AI_CHAT_REQUEST_TIMEOUT_MS,
            "AI response read timed out.",
            async {
                read_bounded_text(response, max_bytes, label)
                    .await
                    .context("AI response read failed")
            },
        )
        .await?;

        if !status.is_success() {
            let message = if text.trim().is_empty() {
                format!("AI request failed: {status}")
            } else {
                text
            };
            return Err(AiHttpFailure::new(status.as_u16(), message).into());
        }

        Ok(chat_text_from_response(&text).unwrap_or(text))
    }

    pub async fn stream<F>(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        model: &str,
        messages: &[ChatMessage],
        context_message_limit: i32,
        access_key: &str,
        mut cancellation: watch::Receiver<bool>,
        mut on_partial: F,
    ) -> Result<String>
    where
        F: FnMut(String) -> bool,
    {
        if provider_needs_client_key(provider) && api_key.trim().is_empty() {
            bail!("Provider key is required.");
        }

        if model.trim().is_empty() {
            bail!("Model name is required.");
        }

        let transport_messages = select_context_messages(messages, context_message_limit);

        let mut request = self
            .http
            .post(endpoint_for(provider)?)
            .header("accept", "text/event-stream");
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "chat")?;

        if cancellation_requested(&cancellation) {
            bail!("Generation stopped");
        }

        let response = tokio::select! {
            _ = wait_for_cancellation(&mut cancellation) => {
                bail!("Generation stopped");
            }
            response = provider_timeout(
                AI_CHAT_REQUEST_TIMEOUT_MS,
                "AI streaming request timed out.",
                async {
                    let response = match provider.kind {
                        ProviderKind::OpenaiCompatible => {
                            request
                                .json(&OpenAiChatRequest {
                                    model: model.trim(),
                                    messages: openai_chat_messages(&transport_messages),
                                    stream: true,
                                    temperature: 0.7,
                                })
                                .send()
                                .await?
                        }
                        ProviderKind::OpenaiResponses => {
                            request
                                .json(&OpenAiResponsesRequest {
                                    model: model.trim(),
                                    input: responses_chat_messages(&transport_messages),
                                    stream: true,
                                    store: false,
                                    temperature: 0.7,
                                })
                                .send()
                                .await?
                        }
                        ProviderKind::Anthropic => {
                            let (system, messages) =
                                split_anthropic_messages(anthropic_chat_messages(&transport_messages));

                            request
                                .json(&AnthropicRequest {
                                    model: model.trim(),
                                    system,
                                    messages,
                                    stream: true,
                                    max_tokens: 4096,
                                })
                                .send()
                                .await?
                        }
                    };

                    Ok(response)
                },
            ) => response?,
        };

        let status = response.status();
        if !status.is_success() {
            let (max_bytes, label) = provider_response_budget(
                status,
                MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
                "AI chat response",
            );
            let text = tokio::select! {
                _ = wait_for_cancellation(&mut cancellation) => {
                    bail!("Generation stopped");
                }
                text = provider_timeout(
                    AI_CHAT_REQUEST_TIMEOUT_MS,
                    "AI response read timed out.",
                    async {
                        read_bounded_text(response, max_bytes, label)
                            .await
                            .context("AI response read failed")
                    },
                ) => text?,
            };
            let message = if text.trim().is_empty() {
                format!("AI request failed: {status}")
            } else {
                text
            };
            return Err(AiHttpFailure::new(status.as_u16(), message).into());
        }

        let mut received = String::new();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES as u64)
        {
            bail!(
                "AI provider stream response exceeded the {}-byte safety limit.",
                MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES
            );
        }

        let mut line_buffer = Vec::<u8>::new();
        let mut event_data = Vec::<String>::new();
        let mut total_bytes = 0usize;
        let mut stream = response.bytes_stream();

        loop {
            let next_chunk = tokio::select! {
                _ = wait_for_cancellation(&mut cancellation) => {
                    bail!("Generation stopped");
                }
                next = provider_timeout(
                    AI_STREAM_IDLE_TIMEOUT_MS,
                    "AI streaming response timed out.",
                    async { Ok::<_, anyhow::Error>(stream.next().await) },
                ) => next?,
            };
            let Some(chunk) = next_chunk else {
                break;
            };
            let chunk = chunk.context("AI streaming response read failed")?;
            total_bytes = accumulate_provider_response_bytes(
                total_bytes,
                chunk.len(),
                MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES,
                "AI provider stream response",
            )?;
            line_buffer.extend_from_slice(&chunk);

            let mut consumed = 0usize;
            while let Some(relative_index) = line_buffer[consumed..]
                .iter()
                .position(|byte| *byte == b'\n')
            {
                let newline_index = consumed + relative_index;
                let line_end =
                    if newline_index > consumed && line_buffer[newline_index - 1] == b'\r' {
                        newline_index - 1
                    } else {
                        newline_index
                    };
                let line = String::from_utf8_lossy(&line_buffer[consumed..line_end]);

                if !process_sse_line(&line, &mut event_data, &mut received, &mut on_partial) {
                    return ensure_non_empty_chat_response(received);
                }
                consumed = newline_index + 1;
            }

            if consumed > 0 {
                line_buffer.drain(..consumed);
            }
        }

        if !line_buffer.is_empty() {
            let line_end = if line_buffer.last() == Some(&b'\r') {
                line_buffer.len() - 1
            } else {
                line_buffer.len()
            };
            let line = String::from_utf8_lossy(&line_buffer[..line_end]);
            if !process_sse_line(&line, &mut event_data, &mut received, &mut on_partial) {
                return ensure_non_empty_chat_response(received);
            }
        }

        if !event_data.is_empty() {
            process_sse_event(&mut event_data, &mut received, &mut on_partial);
        }

        ensure_non_empty_chat_response(received)
    }

    pub async fn list_models(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
    ) -> Result<Vec<String>> {
        if provider_needs_client_key(provider) && api_key.trim().is_empty() {
            bail!("Provider key is required.");
        }

        let mut request = self.http.get(model_list_endpoint(provider)?);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "models")?;

        let response = provider_timeout(
            AI_MODEL_LIST_TIMEOUT_MS,
            "Model list request timed out.",
            async { request.send().await.context("Model list request failed") },
        )
        .await?;
        let status = response.status();
        let (max_bytes, label) = provider_response_budget(
            status,
            MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
            "AI model list response",
        );
        let text = provider_timeout(
            AI_MODEL_LIST_TIMEOUT_MS,
            "Model list read timed out.",
            async {
                read_bounded_text(response, max_bytes, label)
                    .await
                    .context("Model list read failed")
            },
        )
        .await?;

        if !status.is_success() {
            bail!(
                "{}",
                if text.trim().is_empty() {
                    format!("Model list request failed: {status}")
                } else {
                    text
                }
            );
        }

        let value: Value = serde_json::from_str(&text).context("Model list is not valid JSON")?;
        let models = parse_model_ids(&value);

        if models.is_empty() {
            bail!("No models were returned by the provider.");
        }

        Ok(models)
    }

    pub async fn generate_image(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        responses_model: Option<&str>,
        prompt: &str,
        size: Option<&str>,
    ) -> Result<GeneratedImage> {
        if provider_needs_client_key(provider) && api_key.trim().is_empty() {
            bail!("Provider key is required.");
        }

        if matches!(provider.kind, ProviderKind::Anthropic) {
            bail!("This provider does not support image generation.");
        }

        if model.trim().is_empty() {
            bail!("Image model is required.");
        }

        if prompt.trim().is_empty() {
            bail!("Image prompt is required.");
        }

        let endpoint = image_generation_endpoint(provider)?;
        let mut request = self.http.post(endpoint);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "image-generations")?;

        let response = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Image generation request timed out.",
            async {
                request
                    .json(&ImageGenerationRequest {
                        model: model.trim(),
                        prompt: prompt.trim(),
                        n: 1,
                        size: size.unwrap_or("1024x1024"),
                        response_format: "b64_json",
                    })
                    .send()
                    .await
                    .context("Image generation request failed")
            },
        )
        .await?;
        let status = response.status();
        if !status.is_success()
            && direct_image_failure_action(ImageRequestFailure::http(status.as_u16()))
                == DirectImageFailureAction::TryResponsesRoute
        {
            let generated = self
                .generate_image_with_responses_tool(
                    provider,
                    api_key,
                    access_key,
                    responses_model,
                    model,
                    prompt.trim(),
                    size.unwrap_or("1024x1024"),
                )
                .await?;
            return self.materialize_generated_image(generated).await;
        }
        let (max_bytes, label) = provider_response_budget(
            status,
            MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
            "AI image generation response",
        );
        let text = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Image generation response read timed out.",
            async {
                read_bounded_text(response, max_bytes, label)
                    .await
                    .context("Image generation response read failed")
            },
        )
        .await?;

        if !status.is_success() {
            bail!(
                "{}",
                if text.trim().is_empty() {
                    format!("Image generation request failed: {status}")
                } else {
                    text
                }
            );
        }

        self.materialize_generated_image(generated_image_from_json(&text)?)
            .await
    }

    pub async fn edit_image(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        responses_model: Option<&str>,
        prompt: &str,
        source: ImageUpload,
        mask: Option<ImageUpload>,
        size: Option<&str>,
    ) -> Result<GeneratedImage> {
        if provider_needs_client_key(provider) && api_key.trim().is_empty() {
            bail!("Provider key is required.");
        }

        if matches!(provider.kind, ProviderKind::Anthropic) {
            bail!("This provider does not support image editing.");
        }

        if model.trim().is_empty() {
            bail!("Image model is required.");
        }

        if crate::providers::is_likely_image_model(model)
            && !crate::providers::is_likely_image_editing_model(model)
        {
            bail!("This image model does not support editing.");
        }

        if prompt.trim().is_empty() {
            bail!("Image edit prompt is required.");
        }

        let endpoint = image_edit_endpoint(provider)?;
        let source_for_fallback = source.clone();
        let has_mask = mask.is_some();
        let mut form = multipart::Form::new()
            .text("model", model.trim().to_owned())
            .text("prompt", prompt.trim().to_owned())
            .text("n", "1")
            .text("size", size.unwrap_or("1024x1024").to_owned())
            .text("response_format", "b64_json");

        let source_part = image_edit_upload_part("image", source, "image.png");
        form = form.part(
            source_part.field,
            multipart::Part::bytes(source_part.bytes)
                .file_name(source_part.file_name)
                .mime_str(&source_part.mime_type)?,
        );

        if let Some(mask) = mask {
            let mask_part = image_edit_upload_part("mask", mask, "mask.png");
            form = form.part(
                mask_part.field,
                multipart::Part::bytes(mask_part.bytes)
                    .file_name(mask_part.file_name)
                    .mime_str(&mask_part.mime_type)?,
            );
        }

        let mut request = self.http.post(endpoint);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "image-edits")?;

        let response = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Image edit request timed out.",
            async {
                request
                    .multipart(form)
                    .send()
                    .await
                    .context("Image edit request failed")
            },
        )
        .await?;
        let status = response.status();
        if !status.is_success()
            && !has_mask
            && direct_image_failure_action(ImageRequestFailure::http(status.as_u16()))
                == DirectImageFailureAction::TryResponsesRoute
        {
            let generated = self
                .edit_image_with_responses_tool(
                    provider,
                    api_key,
                    access_key,
                    responses_model,
                    model,
                    prompt.trim(),
                    source_for_fallback,
                    size.unwrap_or("1024x1024"),
                )
                .await?;
            return self.materialize_generated_image(generated).await;
        }
        let (max_bytes, label) = provider_response_budget(
            status,
            MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
            "AI image edit response",
        );
        let text = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Image edit response read timed out.",
            async {
                read_bounded_text(response, max_bytes, label)
                    .await
                    .context("Image edit response read failed")
            },
        )
        .await?;

        if !status.is_success() {
            bail!(
                "{}",
                if text.trim().is_empty() {
                    format!("Image edit request failed: {status}")
                } else {
                    text
                }
            );
        }

        self.materialize_generated_image(generated_image_from_json(&text)?)
            .await
    }

    pub async fn create_speech(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        input: &str,
        voice: Option<&str>,
        response_format: Option<&str>,
        speed: Option<f64>,
    ) -> Result<Vec<u8>> {
        ensure_capability_request(provider, api_key, model, "Audio speech model is required.")?;
        if input.trim().is_empty() {
            bail!("Audio speech input is required.");
        }

        let mut request = self.http.post(audio_speech_endpoint(provider)?);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "audio-speech")?;

        let response = provider_timeout(
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Audio speech request timed out.",
            async {
                request
                    .json(&audio_speech_request(
                        model,
                        input.trim(),
                        voice,
                        response_format,
                        speed,
                    ))
                    .send()
                    .await
                    .context("Audio speech request failed")
            },
        )
        .await?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let (max_bytes, label) = provider_response_budget(
            status,
            MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES,
            "AI audio speech response",
        );
        let bytes = provider_timeout(
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Audio speech response read timed out.",
            async {
                read_bounded_bytes(response, max_bytes, label)
                    .await
                    .context("Audio speech response read failed")
            },
        )
        .await?;

        if !status.is_success() {
            let text = String::from_utf8_lossy(&bytes);
            bail!(
                "{}",
                if text.trim().is_empty() {
                    format!("Audio speech request failed: {status}")
                } else {
                    text.to_string()
                }
            );
        }

        if !provider_audio_response_looks_valid(&bytes, content_type.as_deref()) {
            bail!("AI audio speech response was not valid audio.");
        }

        Ok(bytes)
    }

    pub async fn transcribe_audio(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        audio: AudioUpload,
        prompt: Option<&str>,
        language: Option<&str>,
        response_format: Option<&str>,
        temperature: Option<f64>,
    ) -> Result<String> {
        ensure_capability_request(
            provider,
            api_key,
            model,
            "Audio transcription model is required.",
        )?;
        if audio.bytes.is_empty() {
            bail!("Audio transcription file is required.");
        }

        let form = audio_transcription_request(
            model,
            audio,
            prompt,
            language,
            response_format,
            temperature,
        )?;
        let mut request = self.http.post(audio_transcription_endpoint(provider)?);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, "audio-transcriptions")?;

        let response = provider_timeout(
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Audio transcription request timed out.",
            async {
                request
                    .multipart(form)
                    .send()
                    .await
                    .context("Audio transcription request failed")
            },
        )
        .await?;

        read_capability_text(
            response,
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Audio transcription response read timed out.",
            "Audio transcription request failed",
        )
        .await
    }

    pub async fn create_embedding(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        input: &str,
    ) -> Result<String> {
        if input.trim().is_empty() {
            bail!("Embedding input is required.");
        }

        self.post_json_capability(
            provider,
            api_key,
            access_key,
            model,
            embeddings_endpoint(provider)?,
            "embeddings",
            embeddings_request(model, json!(input.trim())),
            "Embeddings request failed",
        )
        .await
    }

    pub async fn create_embeddings(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        input: &[String],
    ) -> Result<String> {
        let normalized_input = input
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if normalized_input.is_empty() {
            bail!("Embedding input is required.");
        }

        self.post_json_capability(
            provider,
            api_key,
            access_key,
            model,
            embeddings_endpoint(provider)?,
            "embeddings",
            embeddings_request(model, json!(normalized_input)),
            "Embeddings request failed",
        )
        .await
    }

    pub async fn moderate_text(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        input: &str,
    ) -> Result<String> {
        if input.trim().is_empty() {
            bail!("Moderation input is required.");
        }

        self.post_json_capability(
            provider,
            api_key,
            access_key,
            model,
            moderations_endpoint(provider)?,
            "moderations",
            moderations_request(model, json!(input.trim())),
            "Moderation request failed",
        )
        .await
    }

    pub async fn create_realtime_session(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        modalities: &[&str],
        instructions: Option<&str>,
        voice: Option<&str>,
        input_audio_format: Option<&str>,
        output_audio_format: Option<&str>,
    ) -> Result<String> {
        self.post_json_capability(
            provider,
            api_key,
            access_key,
            model,
            realtime_endpoint(provider)?,
            "realtime",
            realtime_request(
                model,
                modalities,
                instructions,
                voice,
                input_audio_format,
                output_audio_format,
            ),
            "Realtime request failed",
        )
        .await
    }

    pub async fn create_realtime_client_secret(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        modalities: &[&str],
        instructions: Option<&str>,
        voice: Option<&str>,
        input_audio_format: Option<&str>,
        output_audio_format: Option<&str>,
    ) -> Result<String> {
        self.post_json_capability(
            provider,
            api_key,
            access_key,
            model,
            realtime_client_secrets_endpoint(provider)?,
            "realtime-client-secrets",
            realtime_client_secrets_request(
                model,
                modalities,
                instructions,
                voice,
                input_audio_format,
                output_audio_format,
            ),
            "Realtime client secret request failed",
        )
        .await
    }

    async fn generate_image_with_responses_tool(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        responses_model: Option<&str>,
        image_model: &str,
        prompt: &str,
        size: &str,
    ) -> Result<GeneratedImage> {
        let models = responses_image_models(provider, responses_model, image_model);
        if models.is_empty() {
            bail!("Model name is required.");
        }

        let mut last_error = None;

        for model in models {
            let mut request = self.http.post(image_responses_endpoint(provider)?);
            request = apply_auth_headers(request, provider, api_key);
            request = apply_proxy_headers(request, provider, access_key, "image-responses")?;

            let response = provider_timeout(
                AI_IMAGE_REQUEST_TIMEOUT_MS,
                "Responses image generation request timed out.",
                async {
                    request
                        .json(&responses_image_generation_request(&model, prompt, size))
                        .send()
                        .await
                        .context("Responses image generation request failed")
                },
            )
            .await?;
            let status = response.status();
            let (max_bytes, label) = provider_response_budget(
                status,
                MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                "AI Responses image generation response",
            );
            let text = provider_timeout(
                AI_IMAGE_REQUEST_TIMEOUT_MS,
                "Responses image generation response read timed out.",
                async {
                    read_bounded_text(response, max_bytes, label)
                        .await
                        .context("Responses image generation response read failed")
                },
            )
            .await?;

            if !status.is_success() {
                let error = anyhow!(
                    "{}",
                    if text.trim().is_empty() {
                        format!("Responses image generation request failed: {status}")
                    } else {
                        text
                    }
                );
                if responses_image_failure_action(ImageRequestFailure::http(status.as_u16()))
                    == ResponsesImageFailureAction::TryNextModel
                {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            return generated_image_from_json(&text);
        }

        Err(last_error.unwrap_or_else(|| anyhow!("Model name is required.")))
    }

    pub(crate) async fn materialize_generated_image(
        &self,
        image: GeneratedImage,
    ) -> Result<GeneratedImage> {
        if image
            .data_url
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        {
            return Ok(image);
        }

        let source = image
            .url
            .as_deref()
            .and_then(safe_generated_image_url)
            .ok_or_else(|| anyhow!("Image generation returned no usable image."))?;
        let response = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Generated image download timed out.",
            async {
                self.http
                    .get(&source)
                    .header("accept", "image/png,image/jpeg,image/webp")
                    .send()
                    .await
                    .context("Generated image download failed")
            },
        )
        .await?;
        if !response.status().is_success() {
            bail!("Generated image download failed: {}", response.status());
        }
        if safe_generated_image_url(response.url().as_str()).as_deref() != Some(source.as_str()) {
            bail!("Image generation returned no usable image.");
        }
        let bytes = provider_timeout(
            AI_IMAGE_REQUEST_TIMEOUT_MS,
            "Generated image download timed out.",
            read_bounded_bytes(response, MAX_IMAGE_FILE_BYTES, "Generated image download"),
        )
        .await?;
        let mime_type = generated_image_mime_type(&bytes)
            .ok_or_else(|| anyhow!("Image generation returned no usable image."))?;

        Ok(GeneratedImage {
            data_url: Some(format!(
                "data:{mime_type};base64,{}",
                BASE64_STANDARD.encode(bytes)
            )),
            url: None,
            mime_type: mime_type.to_owned(),
            revised_prompt: image.revised_prompt,
        })
    }

    async fn edit_image_with_responses_tool(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        responses_model: Option<&str>,
        image_model: &str,
        prompt: &str,
        source: ImageUpload,
        size: &str,
    ) -> Result<GeneratedImage> {
        let models = responses_image_models(provider, responses_model, image_model);
        if models.is_empty() {
            bail!("Model name is required.");
        }

        let mut last_error = None;

        for model in models {
            let body = responses_image_edit_request(&model, prompt, &source, size);
            let mut request = self.http.post(image_responses_endpoint(provider)?);
            request = apply_auth_headers(request, provider, api_key);
            request = apply_proxy_headers(request, provider, access_key, "image-responses")?;

            let response = provider_timeout(
                AI_IMAGE_REQUEST_TIMEOUT_MS,
                "Responses image edit request timed out.",
                async {
                    request
                        .json(&body)
                        .send()
                        .await
                        .context("Responses image edit request failed")
                },
            )
            .await?;
            let status = response.status();
            let (max_bytes, label) = provider_response_budget(
                status,
                MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                "AI Responses image edit response",
            );
            let text = provider_timeout(
                AI_IMAGE_REQUEST_TIMEOUT_MS,
                "Responses image edit response read timed out.",
                async {
                    read_bounded_text(response, max_bytes, label)
                        .await
                        .context("Responses image edit response read failed")
                },
            )
            .await?;

            if !status.is_success() {
                let error = anyhow!(
                    "{}",
                    if text.trim().is_empty() {
                        format!("Responses image edit request failed: {status}")
                    } else {
                        text
                    }
                );
                if responses_image_failure_action(ImageRequestFailure::http(status.as_u16()))
                    == ResponsesImageFailureAction::TryNextModel
                {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            return generated_image_from_json(&text);
        }

        Err(last_error.unwrap_or_else(|| anyhow!("Model name is required.")))
    }

    async fn post_json_capability(
        &self,
        provider: &ProviderConfig,
        api_key: &str,
        access_key: &str,
        model: &str,
        endpoint: String,
        action: &str,
        body: Value,
        failure_prefix: &'static str,
    ) -> Result<String> {
        ensure_capability_request(provider, api_key, model, "Capability model is required.")?;

        let mut request = self.http.post(endpoint);
        request = apply_auth_headers(request, provider, api_key);
        request = apply_proxy_headers(request, provider, access_key, action)?;

        let response = provider_timeout(
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Capability request timed out.",
            async {
                request
                    .json(&body)
                    .send()
                    .await
                    .context("Capability request failed")
            },
        )
        .await?;

        read_capability_text(
            response,
            AI_CAPABILITY_REQUEST_TIMEOUT_MS,
            "Capability response read timed out.",
            failure_prefix,
        )
        .await
    }
}

fn ensure_capability_request(
    provider: &ProviderConfig,
    api_key: &str,
    model: &str,
    model_message: &'static str,
) -> Result<()> {
    if provider_needs_client_key(provider) && api_key.trim().is_empty() {
        bail!("Provider key is required.");
    }
    if matches!(provider.kind, ProviderKind::Anthropic) {
        bail!("This provider does not support that capability.");
    }
    if model.trim().is_empty() {
        bail!("{}", model_message);
    }

    Ok(())
}

async fn read_capability_text(
    response: reqwest::Response,
    timeout_ms: u64,
    timeout_message: &'static str,
    failure_prefix: &'static str,
) -> Result<String> {
    let status = response.status();
    let (max_bytes, label) = provider_response_budget(
        status,
        MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
        "AI capability response",
    );
    let text = provider_timeout(timeout_ms, timeout_message, async {
        read_bounded_text(response, max_bytes, label)
            .await
            .context("Capability response read failed")
    })
    .await?;

    if !status.is_success() {
        bail!(
            "{}",
            if text.trim().is_empty() {
                format!("{failure_prefix}: {status}")
            } else {
                text
            }
        );
    }

    Ok(text)
}

fn responses_image_models(
    provider: &ProviderConfig,
    responses_model: Option<&str>,
    image_model: &str,
) -> Vec<String> {
    let primary = responses_model.map(str::trim).unwrap_or_default();
    let ordered = if primary.is_empty() {
        vec![provider.model.as_str(), image_model]
    } else {
        vec![primary, image_model, provider.model.as_str()]
    };
    let mut models: Vec<String> = Vec::new();

    for model in ordered {
        let candidate = model.trim();
        if !candidate.is_empty() && !models.iter().any(|item| item.as_str() == candidate) {
            models.push(candidate.to_owned());
        }
    }

    models
}

fn provider_response_budget(
    status: StatusCode,
    success_max_bytes: usize,
    success_label: &'static str,
) -> (usize, &'static str) {
    if status.is_success() {
        (success_max_bytes, success_label)
    } else {
        (
            MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES,
            "AI provider error response",
        )
    }
}

fn provider_audio_bytes_have_known_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"ID3")
        || bytes.starts_with(b"RIFF")
        || bytes.starts_with(b"OggS")
        || bytes.starts_with(b"fLaC")
        || (bytes.get(0) == Some(&0xff) && bytes.get(1).is_some_and(|byte| byte & 0xe0 == 0xe0))
        || (bytes.len() > 7 && &bytes[4..8] == b"ftyp")
}

fn provider_audio_bytes_look_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(96)];
    let first_content_byte = sample
        .iter()
        .copied()
        .find(|byte| *byte != b'\t' && *byte != b'\n' && *byte != b'\r' && *byte != b' ');

    if matches!(first_content_byte, Some(b'{' | b'[' | b'<')) {
        return true;
    }

    sample.iter().all(|byte| {
        *byte == b'\t' || *byte == b'\n' || *byte == b'\r' || (0x20..=0x7e).contains(byte)
    })
}

fn provider_audio_response_looks_valid(bytes: &[u8], content_type: Option<&str>) -> bool {
    if bytes.is_empty() || provider_audio_bytes_look_like_text(bytes) {
        return false;
    }

    let normalized_content_type = content_type.unwrap_or_default().trim().to_ascii_lowercase();
    if normalized_content_type.starts_with("audio/")
        || normalized_content_type.contains("octet-stream")
    {
        return true;
    }

    if provider_audio_bytes_have_known_signature(bytes) {
        return true;
    }

    !(normalized_content_type.contains("json")
        || normalized_content_type.starts_with("text/")
        || normalized_content_type.contains("html")
        || normalized_content_type.contains("xml"))
}

fn accumulate_provider_response_bytes(
    current_bytes: usize,
    next_bytes: usize,
    max_bytes: usize,
    label: &str,
) -> Result<usize> {
    let total_bytes = current_bytes
        .checked_add(next_bytes)
        .ok_or_else(|| anyhow!("{label} exceeded the {max_bytes}-byte safety limit."))?;
    if total_bytes > max_bytes {
        bail!("{label} exceeded the {max_bytes}-byte safety limit.");
    }
    Ok(total_bytes)
}

async fn provider_timeout<T, F>(timeout_ms: u64, message: &'static str, future: F) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    match timeout(Duration::from_millis(timeout_ms), future).await {
        Ok(result) => result,
        Err(_) => Err(AiTimeoutFailure::new(message).into()),
    }
}

fn cancellation_requested(cancellation: &watch::Receiver<bool>) -> bool {
    *cancellation.borrow()
}

async fn wait_for_cancellation(cancellation: &mut watch::Receiver<bool>) {
    if cancellation_requested(cancellation) {
        return;
    }

    let _ = cancellation.changed().await;
}

#[cfg(test)]
mod tests {
    use super::{
        AI_CHAT_REQUEST_TIMEOUT_MS, AI_CONNECT_TIMEOUT_MS, AI_IMAGE_REQUEST_TIMEOUT_MS,
        AI_MODEL_LIST_TIMEOUT_MS, AI_STREAM_IDLE_TIMEOUT_MS, AiClient, AiEmptyResponseFailure,
        MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES, MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES,
        MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES, MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES,
        MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES, accumulate_provider_response_bytes,
        ensure_non_empty_chat_response, generated_image_mime_type,
        provider_audio_response_looks_valid, wait_for_cancellation,
    };
    use tokio::sync::watch;

    #[test]
    fn ai_client_timeout_budget_keeps_fast_failures_and_long_image_room() {
        assert_eq!(AI_CONNECT_TIMEOUT_MS, 30_000);
        assert_eq!(AI_MODEL_LIST_TIMEOUT_MS, 30_000);
        assert_eq!(AI_CHAT_REQUEST_TIMEOUT_MS, 60_000);
        assert_eq!(AI_STREAM_IDLE_TIMEOUT_MS, 90_000);
        assert_eq!(AI_IMAGE_REQUEST_TIMEOUT_MS, 180_000);
        assert!(AI_CHAT_REQUEST_TIMEOUT_MS < AI_IMAGE_REQUEST_TIMEOUT_MS);
        assert!(AI_CONNECT_TIMEOUT_MS <= AI_STREAM_IDLE_TIMEOUT_MS);

        assert_eq!(MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES, 16_384);
        assert_eq!(MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES, 8_000_000);
        assert_eq!(MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES, 32_000_000);
        assert_eq!(MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES, 32_000_000);
        assert_eq!(MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES, 8_000_000);

        let _client = AiClient::new().expect("AI HTTP client should initialize in tests");
    }

    #[test]
    fn provider_response_byte_budget_accepts_boundary_and_rejects_overflow() {
        assert_eq!(
            accumulate_provider_response_bytes(2, 2, 4, "AI test response")
                .expect("the exact byte boundary should be accepted"),
            4
        );
        assert_eq!(
            accumulate_provider_response_bytes(4, 1, 4, "AI test response")
                .expect_err("one byte above the limit must be rejected")
                .to_string(),
            "AI test response exceeded the 4-byte safety limit."
        );
    }

    #[test]
    fn successful_empty_chat_stream_becomes_typed_failure() {
        assert_eq!(
            ensure_non_empty_chat_response("answer".to_owned())
                .expect("visible content should pass"),
            "answer"
        );

        let failure = ensure_non_empty_chat_response(" \n\t".to_owned())
            .expect_err("blank provider output must fail");
        assert!(failure.downcast_ref::<AiEmptyResponseFailure>().is_some());
    }

    #[test]
    fn generated_image_signatures_accept_only_supported_raster_formats() {
        assert_eq!(
            generated_image_mime_type(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Some("image/png")
        );
        assert_eq!(
            generated_image_mime_type(&[0xff, 0xd8, 0xff]),
            Some("image/jpeg")
        );
        assert_eq!(
            generated_image_mime_type(b"RIFF\0\0\0\0WEBP"),
            Some("image/webp")
        );
        assert_eq!(generated_image_mime_type(b"<html>expired</html>"), None);
    }

    #[test]
    fn audio_response_validation_rejects_textual_bodies_even_with_audio_mime() {
        assert!(!provider_audio_response_looks_valid(
            br#"{"error":"upstream"}"#,
            Some("audio/mpeg"),
        ));
        assert!(!provider_audio_response_looks_valid(
            b"<html>upstream failure</html>",
            Some("application/octet-stream"),
        ));
        assert!(!provider_audio_response_looks_valid(b"audio-bytes", None));
        assert!(provider_audio_response_looks_valid(
            &[0x49, 0x44, 0x33, 0x04],
            Some("application/octet-stream"),
        ));
        assert!(provider_audio_response_looks_valid(
            &[0x00, 0x01, 0x02, 0x03],
            Some("audio/mpeg"),
        ));
    }

    #[tokio::test]
    async fn stream_cancellation_signal_wakes_the_network_waiter() {
        let (sender, mut receiver) = watch::channel(false);
        let waiter = tokio::spawn(async move {
            wait_for_cancellation(&mut receiver).await;
        });

        sender
            .send(true)
            .expect("the stream cancellation receiver should still be alive");
        waiter
            .await
            .expect("the stream cancellation waiter should finish");
    }
}
