use crate::{
    local_file::MAX_IMAGE_FILE_BYTES,
    models::{
        ChatMessage, MessageAttachment, MessageRole, ProviderConfig, ProviderKind, SyncConfig,
    },
};
use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::{Url, multipart};
use serde::Serialize;
use serde_json::{Value, json};

const DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT: i32 = 24;
const MIN_CHAT_CONTEXT_MESSAGE_LIMIT: i32 = 4;
const MAX_CHAT_CONTEXT_MESSAGE_LIMIT: i32 = 200;

const AUDIO_MIME_BY_EXTENSION: &[(&str, &str)] = &[
    ("aac", "audio/aac"),
    ("flac", "audio/flac"),
    ("m4a", "audio/mp4"),
    ("mp3", "audio/mpeg"),
    ("mp4", "audio/mp4"),
    ("mpeg", "audio/mpeg"),
    ("oga", "audio/ogg"),
    ("ogg", "audio/ogg"),
    ("opus", "audio/opus"),
    ("wav", "audio/wav"),
    ("webm", "audio/webm"),
];

const IMAGE_MIME_BY_EXTENSION: &[(&str, &str)] = &[
    ("jpeg", "image/jpeg"),
    ("jpg", "image/jpeg"),
    ("png", "image/png"),
    ("webp", "image/webp"),
];

#[derive(Debug, Clone)]
pub(crate) struct GeneratedImage {
    pub(crate) data_url: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) mime_type: String,
    pub(crate) revised_prompt: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ImageUpload {
    pub(crate) bytes: Vec<u8>,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AudioUpload {
    pub(crate) bytes: Vec<u8>,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioTranscriptionField {
    pub(crate) name: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioTranscriptionRequestParts {
    pub(crate) fields: Vec<AudioTranscriptionField>,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImageEditUploadPart {
    pub(crate) field: String,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) fn provider_needs_client_key(provider: &ProviderConfig) -> bool {
    provider.client_request_mode || provider.needs_api_key || active_proxy_url(provider).is_none()
}

pub(crate) fn provider_request(provider: &ProviderConfig, sync: &SyncConfig) -> ProviderConfig {
    if provider.client_request_mode {
        let mut copy = provider.clone();
        copy.proxy_url = None;
        return copy;
    }

    if active_proxy_url(provider).is_some() {
        return provider.clone();
    }

    let endpoint = sync
        .worker_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| sync.mode == "cloudflare" && !endpoint.is_empty());

    endpoint.map_or_else(
        || provider.clone(),
        |endpoint| {
            let mut copy = provider.clone();
            copy.proxy_url = Some(endpoint.to_owned());
            copy
        },
    )
}

pub(crate) fn provider_proxy_access_key(
    provider: &ProviderConfig,
    cloudflare_access_key: impl FnOnce() -> String,
) -> String {
    if active_proxy_url(provider).is_none() {
        String::new()
    } else {
        cloudflare_access_key()
    }
}

pub(crate) fn endpoint_for(provider: &ProviderConfig) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    let root = provider_api_root(provider)?;

    Ok(match provider.kind {
        ProviderKind::Anthropic => format!("{root}/messages"),
        ProviderKind::OpenaiResponses => format!("{root}/responses"),
        ProviderKind::OpenaiCompatible => format!("{root}/chat/completions"),
    })
}

pub(crate) fn model_list_endpoint(provider: &ProviderConfig) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    Ok(format!("{}/models", provider_api_root(provider)?))
}

pub(crate) fn image_generation_endpoint(provider: &ProviderConfig) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    Ok(format!(
        "{}/images/generations",
        provider_api_root(provider)?
    ))
}

pub(crate) fn image_edit_endpoint(provider: &ProviderConfig) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    Ok(format!("{}/images/edits", provider_api_root(provider)?))
}

pub(crate) fn image_responses_endpoint(provider: &ProviderConfig) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    Ok(format!("{}/responses", provider_api_root(provider)?))
}

pub(crate) fn audio_speech_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/audio/speech")
}

pub(crate) fn audio_transcription_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/audio/transcriptions")
}

pub(crate) fn embeddings_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/embeddings")
}

pub(crate) fn moderations_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/moderations")
}

pub(crate) fn realtime_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/realtime")
}

pub(crate) fn realtime_client_secrets_endpoint(provider: &ProviderConfig) -> Result<String> {
    capability_endpoint(provider, "/realtime/client_secrets")
}

fn capability_endpoint(provider: &ProviderConfig, path: &str) -> Result<String> {
    if let Some(proxy) = active_proxy_url(provider) {
        return Ok(format!("{}/proxy", proxy_root_url(proxy)?));
    }

    Ok(format!("{}{}", provider_api_root(provider)?, path))
}

pub(crate) fn select_context_messages(
    messages: &[ChatMessage],
    context_message_limit: i32,
) -> Vec<&ChatMessage> {
    let normalized_limit = normalize_chat_context_message_limit(context_message_limit);
    let mut selected = messages
        .iter()
        .filter(|message| {
            matches!(&message.role, crate::models::MessageRole::System)
                && !message.content.trim().is_empty()
        })
        .collect::<Vec<_>>();
    let chat_messages = messages
        .iter()
        .filter(|message| !matches!(&message.role, crate::models::MessageRole::System))
        .collect::<Vec<_>>();
    let start = chat_messages.len().saturating_sub(normalized_limit);

    selected.extend(chat_messages.into_iter().skip(start));
    selected
}

pub(crate) fn openai_chat_messages(messages: &[&ChatMessage]) -> Vec<AiMessage> {
    messages
        .iter()
        .map(|message| AiMessage {
            role: role_name(message),
            content: openai_chat_content(message),
        })
        .collect()
}

pub(crate) fn responses_chat_messages(messages: &[&ChatMessage]) -> Vec<AiMessage> {
    messages
        .iter()
        .map(|message| AiMessage {
            role: role_name(message),
            content: responses_chat_content(message),
        })
        .collect()
}

pub(crate) fn anthropic_chat_messages(messages: &[&ChatMessage]) -> Vec<AiMessage> {
    messages
        .iter()
        .map(|message| AiMessage {
            role: role_name(message),
            content: anthropic_chat_content(message),
        })
        .collect()
}

pub(crate) fn split_anthropic_messages(
    messages: Vec<AiMessage>,
) -> (Option<String>, Vec<AiMessage>) {
    let system = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| chat_content_text(&message.content))
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let messages = messages
        .into_iter()
        .filter(|message| message.role != "system")
        .collect();

    ((!system.is_empty()).then_some(system), messages)
}

fn role_name(message: &ChatMessage) -> &'static str {
    match message.role {
        MessageRole::System => "system",
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
    }
}

fn chat_image_attachments(message: &ChatMessage) -> Vec<(&MessageAttachment, String)> {
    if !matches!(message.role, MessageRole::User) {
        return Vec::new();
    }

    message
        .attachments
        .iter()
        .filter_map(|attachment| {
            if attachment.kind != "image" || attachment.purpose.as_deref() == Some("mask") {
                return None;
            }

            attachment_image_url(attachment).map(|source| (attachment, source))
        })
        .collect()
}

fn openai_chat_content(message: &ChatMessage) -> Value {
    let images = chat_image_attachments(message);
    if images.is_empty() {
        return Value::String(message.content.clone());
    }

    let mut content = Vec::new();
    if !message.content.is_empty() {
        content.push(json!({
            "type": "text",
            "text": message.content.as_str(),
        }));
    }
    for (_, source) in images {
        content.push(json!({
            "type": "image_url",
            "image_url": {
                "url": source,
            },
        }));
    }

    Value::Array(content)
}

fn responses_chat_content(message: &ChatMessage) -> Value {
    let images = chat_image_attachments(message);
    if images.is_empty() {
        return Value::String(message.content.clone());
    }

    let mut content = Vec::new();
    if !message.content.is_empty() {
        content.push(json!({
            "type": "input_text",
            "text": message.content.as_str(),
        }));
    }
    for (_, source) in images {
        content.push(json!({
            "type": "input_image",
            "image_url": source,
        }));
    }

    Value::Array(content)
}

fn anthropic_chat_content(message: &ChatMessage) -> Value {
    let images = chat_image_attachments(message)
        .into_iter()
        .filter_map(|(_, source)| data_url_parts(&source))
        .collect::<Vec<_>>();
    if images.is_empty() {
        return Value::String(message.content.clone());
    }

    let mut content = Vec::new();
    if !message.content.is_empty() {
        content.push(json!({
            "type": "text",
            "text": message.content.as_str(),
        }));
    }
    for image in images {
        content.push(json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": image.data,
            },
        }));
    }

    Value::Array(content)
}

fn attachment_image_url(attachment: &MessageAttachment) -> Option<String> {
    attachment
        .data_url
        .as_deref()
        .and_then(safe_generated_image_data_url)
        .map(|(data_url, _)| data_url)
        .or_else(|| attachment.url.as_deref().and_then(safe_generated_image_url))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DataUrlParts {
    media_type: String,
    data: String,
}

fn data_url_parts(data_url: &str) -> Option<DataUrlParts> {
    let (metadata, data) = data_url.split_once(',')?;
    let media_type = metadata
        .strip_prefix("data:")?
        .split([';', ','])
        .next()
        .unwrap_or_default()
        .trim();

    if media_type.is_empty() || data.is_empty() {
        return None;
    }

    Some(DataUrlParts {
        media_type: media_type.to_owned(),
        data: data.to_owned(),
    })
}

fn chat_content_text(content: &Value) -> String {
    match content {
        Value::String(value) => value.trim().to_owned(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(crate) fn apply_auth_headers(
    request: reqwest::RequestBuilder,
    provider: &ProviderConfig,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let key = if provider_needs_client_key(provider) {
        api_key.trim()
    } else {
        ""
    };

    match provider.kind {
        ProviderKind::Anthropic => {
            let request = request.header("anthropic-version", "2023-06-01");
            if key.is_empty() {
                request
            } else {
                request.header("x-api-key", key)
            }
        }
        ProviderKind::OpenaiCompatible | ProviderKind::OpenaiResponses => {
            if key.is_empty() {
                request
            } else {
                request.bearer_auth(key)
            }
        }
    }
}

pub(crate) fn apply_proxy_headers(
    request: reqwest::RequestBuilder,
    provider: &ProviderConfig,
    access_key: &str,
    action: &str,
) -> Result<reqwest::RequestBuilder> {
    if active_proxy_url(provider).is_none() {
        return Ok(request);
    }

    if access_key.trim().is_empty() {
        bail!("Cloudflare access key is required.");
    }

    Ok(request
        .header("x-zerochat-access-key", access_key.trim())
        .header("x-zerochat-proxy-action", action)
        .header("x-zerochat-base-url", provider_api_root(provider)?)
        .header(
            "x-zerochat-provider-kind",
            match provider.kind {
                ProviderKind::Anthropic => "anthropic",
                ProviderKind::OpenaiResponses => "openai-responses",
                ProviderKind::OpenaiCompatible => "openai-compatible",
            },
        ))
}

pub(crate) fn parse_model_ids(value: &Value) -> Vec<String> {
    let items = if let Some(array) = value.as_array() {
        array.as_slice()
    } else if let Some(array) = value.get("data").and_then(Value::as_array) {
        array.as_slice()
    } else if let Some(array) = value.get("models").and_then(Value::as_array) {
        array.as_slice()
    } else if let Some(array) = value.get("result").and_then(Value::as_array) {
        array.as_slice()
    } else {
        &[]
    };

    let mut models: Vec<String> = items.iter().filter_map(read_model_id).collect();
    models.sort();
    models.dedup();
    models
}

pub(crate) fn generated_image_from_json(text: &str) -> Result<GeneratedImage> {
    let value: Value = serde_json::from_str(text).context("Image response is not valid JSON")?;

    generated_image_from_images_api(&value)
        .or_else(|| generated_image_from_responses_api(&value))
        .context("Image response did not include usable image data")
}

pub(crate) fn audio_speech_request(
    model: &str,
    input: &str,
    voice: Option<&str>,
    response_format: Option<&str>,
    speed: Option<f64>,
) -> Value {
    let mut body = json!({
        "model": model.trim(),
        "input": input,
        "voice": voice
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("alloy")
    });

    if let Some(record) = body.as_object_mut() {
        if let Some(format) = response_format
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            record.insert("response_format".to_owned(), json!(format));
        }

        if let Some(speed) = speed {
            record.insert("speed".to_owned(), json!(speed));
        }
    }

    body
}

pub(crate) fn audio_transcription_request(
    model: &str,
    audio: AudioUpload,
    prompt: Option<&str>,
    language: Option<&str>,
    response_format: Option<&str>,
    temperature: Option<f64>,
) -> Result<multipart::Form> {
    let parts = audio_transcription_request_parts(
        model,
        audio,
        prompt,
        language,
        response_format,
        temperature,
    );
    let mut form = multipart::Form::new();

    for field in parts.fields {
        form = form.text(field.name, field.value);
    }

    Ok(form.part(
        "file",
        multipart::Part::bytes(parts.bytes)
            .file_name(parts.file_name)
            .mime_str(&parts.mime_type)?,
    ))
}

pub(crate) fn audio_transcription_request_parts(
    model: &str,
    audio: AudioUpload,
    prompt: Option<&str>,
    language: Option<&str>,
    response_format: Option<&str>,
    temperature: Option<f64>,
) -> AudioTranscriptionRequestParts {
    let mut fields = vec![AudioTranscriptionField {
        name: "model".to_owned(),
        value: model.trim().to_owned(),
    }];

    if let Some(value) = prompt.map(str::trim).filter(|value| !value.is_empty()) {
        fields.push(AudioTranscriptionField {
            name: "prompt".to_owned(),
            value: value.to_owned(),
        });
    }
    if let Some(value) = language.map(str::trim).filter(|value| !value.is_empty()) {
        fields.push(AudioTranscriptionField {
            name: "language".to_owned(),
            value: value.to_owned(),
        });
    }
    if let Some(value) = response_format
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fields.push(AudioTranscriptionField {
            name: "response_format".to_owned(),
            value: value.to_owned(),
        });
    }
    if let Some(value) = temperature {
        fields.push(AudioTranscriptionField {
            name: "temperature".to_owned(),
            value: decimal_string(value),
        });
    }

    let file_name = audio_file_name(&audio);
    let mime_type = audio_mime_type(&audio, &file_name);

    AudioTranscriptionRequestParts {
        fields,
        file_name,
        mime_type,
        bytes: audio.bytes,
    }
}

pub(crate) fn embeddings_request(model: &str, input: Value) -> Value {
    text_capability_request(model, input)
}

pub(crate) fn moderations_request(model: &str, input: Value) -> Value {
    text_capability_request(model, input)
}

fn text_capability_request(model: &str, input: Value) -> Value {
    json!({
        "model": model.trim(),
        "input": input
    })
}

pub(crate) fn realtime_request(
    model: &str,
    modalities: &[&str],
    instructions: Option<&str>,
    voice: Option<&str>,
    input_audio_format: Option<&str>,
    output_audio_format: Option<&str>,
) -> Value {
    let output_modality = normalized_realtime_modality(modalities);
    let mut body = json!({
        "model": model.trim(),
        "modalities": normalized_realtime_modalities(&output_modality)
    });

    if let Some(record) = body.as_object_mut() {
        if let Some(value) = instructions
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            record.insert("instructions".to_owned(), json!(value));
        }
        if output_modality == "audio" {
            if let Some(value) = voice.map(str::trim).filter(|value| !value.is_empty()) {
                record.insert("voice".to_owned(), json!(value));
            }
        }
        if let Some(value) = input_audio_format
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            record.insert("input_audio_format".to_owned(), json!(value));
        }
        if output_modality == "audio" {
            if let Some(value) = output_audio_format
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                record.insert("output_audio_format".to_owned(), json!(value));
            }
        }
    }

    body
}

pub(crate) fn realtime_client_secrets_request(
    model: &str,
    modalities: &[&str],
    instructions: Option<&str>,
    voice: Option<&str>,
    input_audio_format: Option<&str>,
    output_audio_format: Option<&str>,
) -> Value {
    let output_modality = normalized_realtime_modality(modalities);
    let mut session = serde_json::Map::new();
    session.insert("type".to_owned(), json!("realtime"));
    session.insert("model".to_owned(), json!(model.trim()));
    session.insert(
        "output_modalities".to_owned(),
        json!(normalized_realtime_modalities(&output_modality)),
    );

    if let Some(value) = instructions
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        session.insert("instructions".to_owned(), json!(value));
    }

    if let Some(audio) = realtime_session_audio(
        voice,
        input_audio_format,
        output_audio_format,
        output_modality == "audio",
    ) {
        session.insert("audio".to_owned(), audio);
    }

    json!({
        "expires_after": {
            "anchor": "created_at",
            "seconds": 600
        },
        "session": Value::Object(session)
    })
}

fn normalized_realtime_modality(modalities: &[&str]) -> String {
    modalities
        .iter()
        .map(|value| value.trim())
        .find(|value| matches!(*value, "text" | "audio"))
        .unwrap_or("text")
        .to_owned()
}

fn normalized_realtime_modalities(modality: &str) -> Vec<String> {
    vec![modality.to_owned()]
}

fn realtime_session_audio(
    voice: Option<&str>,
    input_audio_format: Option<&str>,
    output_audio_format: Option<&str>,
    include_output: bool,
) -> Option<Value> {
    let input_format = realtime_audio_format(input_audio_format);
    let output_format = realtime_audio_format(output_audio_format);
    let output_voice = voice.map(str::trim).filter(|value| !value.is_empty());
    let mut audio = serde_json::Map::new();

    if let Some(format) = input_format {
        audio.insert("input".to_owned(), json!({ "format": format }));
    }

    if include_output && (output_format.is_some() || output_voice.is_some()) {
        let mut output = serde_json::Map::new();
        if let Some(format) = output_format {
            output.insert("format".to_owned(), format);
        }
        if let Some(value) = output_voice {
            output.insert("voice".to_owned(), json!(value));
        }
        audio.insert("output".to_owned(), Value::Object(output));
    }

    if audio.is_empty() {
        None
    } else {
        Some(Value::Object(audio))
    }
}

fn realtime_audio_format(value: Option<&str>) -> Option<Value> {
    let normalized = value.map(str::trim).filter(|value| !value.is_empty())?;

    Some(match normalized {
        "pcm16" | "audio/pcm" => json!({ "type": "audio/pcm", "rate": 24000 }),
        "g711_ulaw" | "audio/pcmu" => json!({ "type": "audio/pcmu" }),
        "g711_alaw" | "audio/pcma" => json!({ "type": "audio/pcma" }),
        _ => json!({ "type": normalized }),
    })
}

pub(crate) fn responses_image_generation_request(model: &str, prompt: &str, size: &str) -> Value {
    json!({
        "model": model,
        "input": prompt,
        "tools": [
            {
                "type": "image_generation",
                "action": "generate",
                "size": size
            }
        ],
        "store": false
    })
}

pub(crate) fn responses_image_edit_request(
    model: &str,
    prompt: &str,
    source: &ImageUpload,
    size: &str,
) -> Value {
    let data_url = image_data_url(source);

    json!({
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt
                    },
                    {
                        "type": "input_image",
                        "image_url": data_url
                    }
                ]
            }
        ],
        "tools": [
            {
                "type": "image_generation",
                "action": "edit",
                "size": size
            }
        ],
        "store": false
    })
}

pub(crate) fn image_edit_upload_part(
    field: &str,
    upload: ImageUpload,
    fallback_name: &str,
) -> ImageEditUploadPart {
    let file_name = image_file_name(&upload, fallback_name);
    let mime_type = image_mime_type(&upload, &file_name);
    ImageEditUploadPart {
        field: field.to_owned(),
        file_name,
        mime_type,
        bytes: upload.bytes,
    }
}

pub(crate) fn image_data_url(upload: &ImageUpload) -> String {
    let file_name = image_file_name(upload, "image.png");
    let mime_type = image_mime_type(upload, &file_name);
    format!(
        "data:{mime_type};base64,{}",
        BASE64_STANDARD.encode(&upload.bytes)
    )
}

fn generated_image_from_images_api(value: &Value) -> Option<GeneratedImage> {
    value
        .get("data")
        .and_then(Value::as_array)?
        .first()
        .and_then(generated_image_from_record)
}

fn generated_image_from_responses_api(value: &Value) -> Option<GeneratedImage> {
    value
        .get("output")
        .and_then(Value::as_array)?
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("image_generation_call"))
        .find_map(generated_image_from_record)
}

fn generated_image_from_record(item: &Value) -> Option<GeneratedImage> {
    let mime_type = item
        .get("mime_type")
        .or_else(|| item.get("mimeType"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            image_mime_type_from_format(item.get("output_format").and_then(Value::as_str))
        });
    let revised_prompt = item
        .get("revised_prompt")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    if let Some(b64) = item
        .get("b64_json")
        .or_else(|| item.get("result"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let candidate = if b64.starts_with("data:") {
            b64.to_owned()
        } else {
            format!("data:{mime_type};base64,{b64}")
        };

        if let Some((data_url, safe_mime_type)) = safe_generated_image_data_url(&candidate) {
            return Some(GeneratedImage {
                data_url: Some(data_url),
                url: None,
                mime_type: safe_mime_type,
                revised_prompt,
            });
        }
    }

    item.get("url")
        .and_then(Value::as_str)
        .and_then(safe_generated_image_url)
        .map(|url| GeneratedImage {
            data_url: None,
            url: Some(url),
            mime_type,
            revised_prompt,
        })
}

fn image_mime_type_from_format(value: Option<&str>) -> String {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" | "image/jpg" | "image/jpeg" => "image/jpeg".to_owned(),
        "webp" | "image/webp" => "image/webp".to_owned(),
        "png" | "image/png" | "" => "image/png".to_owned(),
        _ => "image/png".to_owned(),
    }
}

fn valid_generated_image_base64(value: &str) -> bool {
    if value.is_empty()
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return false;
    }

    let padding = value.bytes().rev().take_while(|byte| *byte == b'=').count();
    if padding > 2 {
        return false;
    }

    let body_length = value.len() - padding;
    let body = &value.as_bytes()[..body_length];

    body_length % 4 != 1
        && (padding == 0 || value.len() % 4 == 0)
        && body
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'+' | b'/'))
        && value.as_bytes()[body_length..]
            .iter()
            .all(|byte| *byte == b'=')
        && decoded_base64_byte_count(value).is_some_and(|count| count <= MAX_IMAGE_FILE_BYTES)
}

fn decoded_base64_byte_count(value: &str) -> Option<usize> {
    let padding = value.bytes().rev().take_while(|byte| *byte == b'=').count();
    let body_length = value.len().checked_sub(padding)?;
    let tail = match body_length % 4 {
        0 => 0,
        2 => 1,
        3 => 2,
        _ => return None,
    };

    (body_length / 4).checked_mul(3)?.checked_add(tail)
}

pub(crate) fn safe_generated_image_data_url(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return None;
    }

    let (metadata, payload) = trimmed.split_once(',')?;
    let metadata = metadata.to_ascii_lowercase();
    let mime_type = metadata.strip_prefix("data:")?.strip_suffix(";base64")?;
    let mime_type = match mime_type {
        "image/jpeg" | "image/jpg" => "image/jpeg",
        "image/png" => "image/png",
        "image/webp" => "image/webp",
        _ => return None,
    };

    valid_generated_image_base64(payload).then(|| {
        (
            format!("data:{mime_type};base64,{payload}"),
            mime_type.to_owned(),
        )
    })
}

pub(crate) fn safe_generated_image_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return None;
    }

    let lowercase = trimmed.to_ascii_lowercase();
    let authority = lowercase
        .strip_prefix("https://")
        .or_else(|| lowercase.strip_prefix("http://"))?;
    if authority.is_empty() || authority.starts_with('/') {
        return None;
    }

    let url = Url::parse(trimmed).ok()?;
    let host = url.host_str()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || is_disallowed_remote_host(host)
    {
        return None;
    }

    Some(url.to_string())
}

fn image_file_name(upload: &ImageUpload, fallback_name: &str) -> String {
    let value = upload.file_name.trim();
    if value.is_empty() {
        fallback_name.to_owned()
    } else {
        value.to_owned()
    }
}

fn image_mime_type(upload: &ImageUpload, file_name: &str) -> String {
    let value = upload.mime_type.trim();
    if value.is_empty() {
        image_mime_type_from_file_name(file_name)
    } else {
        value.to_owned()
    }
}

fn image_mime_type_from_file_name(file_name: &str) -> String {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.trim().to_ascii_lowercase())
        .unwrap_or_default();
    IMAGE_MIME_BY_EXTENSION
        .iter()
        .find_map(|(candidate, mime_type)| {
            (*candidate == extension).then_some((*mime_type).to_owned())
        })
        .unwrap_or_else(|| "image/png".to_owned())
}

fn audio_file_name(audio: &AudioUpload) -> String {
    let value = audio.file_name.trim();
    if value.is_empty() {
        "audio.webm".to_owned()
    } else {
        value.to_owned()
    }
}

fn audio_mime_type(audio: &AudioUpload, file_name: &str) -> String {
    let value = audio.mime_type.trim();
    if value.is_empty() {
        audio_mime_type_from_file_name(file_name)
    } else {
        value.to_owned()
    }
}

fn audio_mime_type_from_file_name(file_name: &str) -> String {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.trim().to_ascii_lowercase())
        .unwrap_or_default();
    AUDIO_MIME_BY_EXTENSION
        .iter()
        .find_map(|(candidate, mime_type)| {
            (*candidate == extension).then_some((*mime_type).to_owned())
        })
        .unwrap_or_else(|| "audio/webm".to_owned())
}

fn decimal_string(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

pub(crate) fn chat_text_from_response(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;

    if let Some(output_text) = value.get("output_text").and_then(Value::as_str) {
        let trimmed = output_text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_owned());
        }
    }

    if let Some(choice) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    {
        if let Some(content) = choice
            .get("message")
            .and_then(|message| message.get("content"))
        {
            let trimmed = openai_choice_content_text(content).trim().to_owned();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }

        if let Some(content) = choice
            .get("delta")
            .and_then(|message| message.get("content"))
        {
            let trimmed = openai_choice_content_text(content).trim().to_owned();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    if let Some(output) = value.get("output").and_then(Value::as_array) {
        let parts: Vec<&str> = output
            .iter()
            .flat_map(|item| {
                item.get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("output_text"))
                    .and_then(Value::as_str)
            })
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect();

        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }

    if let Some(content) = value.get("content").and_then(Value::as_array) {
        let parts: Vec<&str> = content
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect();

        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }

    None
}

fn openai_choice_content_text(content: &Value) -> String {
    match content {
        Value::String(value) => value.to_owned(),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<String>()
            .to_owned(),
        _ => String::new(),
    }
}

pub(crate) fn process_sse_line<F>(
    line: &str,
    event_data: &mut Vec<String>,
    received: &mut String,
    on_partial: &mut F,
) -> bool
where
    F: FnMut(String) -> bool,
{
    if line.trim().is_empty() {
        return process_sse_event(event_data, received, on_partial);
    }

    if let Some(data) = line.strip_prefix("data:") {
        event_data.push(data.trim_start().to_owned());
    } else if line.starts_with(':')
        || line.starts_with("event:")
        || line.starts_with("id:")
        || line.starts_with("retry:")
    {
    } else if line.starts_with('{') || line.starts_with('[') {
        event_data.push(line.to_owned());
    }

    true
}

pub(crate) fn process_sse_event<F>(
    event_data: &mut Vec<String>,
    received: &mut String,
    on_partial: &mut F,
) -> bool
where
    F: FnMut(String) -> bool,
{
    let data = event_data.join("\n").trim().to_owned();
    event_data.clear();

    if data.is_empty() {
        return true;
    }
    if data == "[DONE]" {
        return false;
    }

    if let Some(delta) = chat_delta_from_sse(&data)
        && !delta.is_empty()
    {
        received.push_str(&delta);
        return on_partial(received.clone());
    }

    true
}

fn active_proxy_url(provider: &ProviderConfig) -> Option<&str> {
    if provider.client_request_mode {
        return None;
    }

    provider
        .proxy_url
        .as_deref()
        .map(str::trim)
        .filter(|proxy| !proxy.is_empty())
}

fn provider_api_root(provider: &ProviderConfig) -> Result<String> {
    let base_url = safe_base_url(&provider.base_url, "Base URL")?;
    let strip_suffix = |suffix: &str| {
        base_url
            .strip_suffix(suffix)
            .unwrap_or(&base_url)
            .to_owned()
    };

    Ok(if base_url.ends_with("/chat/completions") {
        strip_suffix("/chat/completions")
    } else if base_url.ends_with("/responses") {
        strip_suffix("/responses")
    } else if base_url.ends_with("/messages") {
        strip_suffix("/messages")
    } else if base_url.ends_with("/models") {
        strip_suffix("/models")
    } else if base_url.ends_with("/images/generations") {
        strip_suffix("/images/generations")
    } else if base_url.ends_with("/images/edits") {
        strip_suffix("/images/edits")
    } else if base_url.ends_with("/audio/speech") {
        strip_suffix("/audio/speech")
    } else if base_url.ends_with("/audio/transcriptions") {
        strip_suffix("/audio/transcriptions")
    } else if base_url.ends_with("/embeddings") {
        strip_suffix("/embeddings")
    } else if base_url.ends_with("/moderations") {
        strip_suffix("/moderations")
    } else if base_url.ends_with("/realtime/client_secrets") {
        strip_suffix("/realtime/client_secrets")
    } else if base_url.ends_with("/realtime") {
        strip_suffix("/realtime")
    } else {
        base_url
    })
}

fn safe_base_url(value: &str, label: &str) -> Result<String> {
    let endpoint = value.trim().trim_end_matches('/');
    let url = Url::parse(endpoint)?;
    let host = url.host_str().unwrap_or_default();

    if !url.username().is_empty() || url.password().is_some() {
        bail!("{label} cannot include a username or password");
    }

    if url.query().is_some() || url.fragment().is_some() {
        bail!("{label} cannot include query parameters or # fragments");
    }

    if url.scheme() != "https" {
        bail!("{label} must be a remote HTTPS URL");
    }

    if host.is_empty() || is_disallowed_remote_host(host) {
        bail!("{label} cannot use localhost, this device, private network, or LAN addresses");
    }

    Ok(endpoint.to_owned())
}

fn proxy_root_url(value: &str) -> Result<String> {
    let base_url = safe_base_url(value, "AI proxy URL")?;

    if let Some(root) = base_url.strip_suffix("/proxy/hosts") {
        return Ok(root.to_owned());
    }

    if let Some(root) = base_url.strip_suffix("/proxy") {
        return Ok(root.to_owned());
    }

    Ok(base_url)
}

fn normalize_chat_context_message_limit(value: i32) -> usize {
    let value = if value <= 0 {
        DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT
    } else {
        value
    };

    value.clamp(
        MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
        MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
    ) as usize
}

fn read_model_id(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_owned());
    }

    ["id", "name", "model", "slug"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn chat_delta_from_sse(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;

    openai_choice_delta(&value)
        .or_else(|| responses_delta(&value))
        .or_else(|| anthropic_delta(&value))
}

fn openai_choice_delta(value: &Value) -> Option<String> {
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())?;

    choice
        .get("delta")
        .and_then(|delta| delta.get("content"))
        .map(openai_choice_content_text)
        .filter(|text| !text.is_empty())
        .or_else(|| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .map(openai_choice_content_text)
                .filter(|text| !text.is_empty())
        })
}

fn responses_delta(value: &Value) -> Option<String> {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !event_type.is_empty() && !event_type.contains("delta") {
        return None;
    }

    value
        .get("delta")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("response")
                .and_then(|response| response.get("delta"))
                .and_then(Value::as_str)
        })
        .map(ToOwned::to_owned)
}

fn anthropic_delta(value: &Value) -> Option<String> {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !event_type.is_empty() && event_type != "content_block_delta" {
        return None;
    }

    value
        .get("delta")
        .and_then(|delta| delta.get("text"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn is_legacy_ipv4_label(label: &str) -> bool {
    if label.is_empty() {
        return false;
    }

    if label.bytes().all(|byte| byte.is_ascii_digit()) {
        return true;
    }

    label
        .strip_prefix("0x")
        .or_else(|| label.strip_prefix("0X"))
        .is_some_and(|digits| {
            !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn is_disallowed_remote_host(host: &str) -> bool {
    let normalized = host
        .to_ascii_lowercase()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_owned();

    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized.ends_with(".lan")
        || normalized.ends_with(".home.arpa")
    {
        return true;
    }

    if let Some(octets) = parse_ipv4(&normalized) {
        let canonical = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], octets[3]);
        return normalized != canonical || is_disallowed_ipv4(octets);
    }

    if !normalized.contains(':') {
        return !normalized.contains('.') || normalized.split('.').all(is_legacy_ipv4_label);
    }

    if let Some(embedded_ipv4) = embedded_ipv4_from_ipv6(&normalized) {
        if is_disallowed_ipv4(embedded_ipv4) {
            return true;
        }
    }

    if let Some(ipv6) = parse_ipv6_hextets(&normalized) {
        let first = ipv6[0];
        return normalized == "::"
            || normalized == "::1"
            || (first == 0x100 && ipv6[1..4].iter().all(|part| *part == 0))
            || (first == 0x2001 && ipv6[1] == 0x0db8)
            || (first & 0xfe00) == 0xfc00
            || (first & 0xffc0) == 0xfe80
            || (first & 0xff00) == 0xff00;
    }

    normalized == "::1"
        || normalized.starts_with("fc")
        || normalized.starts_with("fd")
        || normalized.starts_with("fe80:")
        || normalized.starts_with("ff")
}

fn is_disallowed_ipv4(octets: [u8; 4]) -> bool {
    let [first, second, third, _] = octets;

    first == 0
        || first == 10
        || first == 127
        || (first == 169 && second == 254)
        || (first == 172 && (16..=31).contains(&second))
        || (first == 192 && second == 0 && matches!(third, 0 | 2))
        || (first == 192 && second == 88 && third == 99)
        || (first == 192 && second == 168)
        || (first == 198 && matches!(second, 18 | 19))
        || (first == 198 && second == 51 && third == 100)
        || (first == 203 && second == 0 && third == 113)
        || (first == 100 && (64..=127).contains(&second))
        || first >= 224
}

fn parse_ipv4(value: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = value.split('.').collect();

    if parts.len() != 4 {
        return None;
    }

    let mut octets = [0_u8; 4];

    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.chars().all(|character| character.is_ascii_digit()) {
            return None;
        }

        octets[index] = part.parse().ok()?;
    }

    Some(octets)
}

fn parse_ipv6_hextets(value: &str) -> Option<[u16; 8]> {
    fn parse_part(part: &str) -> Option<Vec<u16>> {
        if part.is_empty() {
            return None;
        }

        if part.contains('.') {
            let ipv4 = parse_ipv4(part)?;

            return Some(vec![
                ((ipv4[0] as u16) << 8) + ipv4[1] as u16,
                ((ipv4[2] as u16) << 8) + ipv4[3] as u16,
            ]);
        }

        if part.len() > 4 || !part.chars().all(|character| character.is_ascii_hexdigit()) {
            return None;
        }

        Some(vec![u16::from_str_radix(part, 16).ok()?])
    }

    fn parse_side(side: &str) -> Option<Vec<u16>> {
        if side.is_empty() {
            return Some(Vec::new());
        }

        let mut hextets = Vec::new();

        for part in side.split(':') {
            hextets.extend(parse_part(part)?);
        }

        Some(hextets)
    }

    let sections: Vec<&str> = value.split("::").collect();

    if sections.len() > 2 {
        return None;
    }

    let left = parse_side(sections[0])?;
    let right = if sections.len() == 2 {
        parse_side(sections[1])?
    } else {
        Vec::new()
    };

    let hextets = if sections.len() == 1 {
        if left.len() != 8 {
            return None;
        }

        left
    } else {
        let zeros = 8usize.checked_sub(left.len() + right.len())?;

        if zeros < 1 {
            return None;
        }

        left.into_iter()
            .chain(std::iter::repeat(0).take(zeros))
            .chain(right)
            .collect()
    };

    hextets.try_into().ok()
}

fn embedded_ipv4_from_ipv6(value: &str) -> Option<[u8; 4]> {
    let hextets = parse_ipv6_hextets(value)?;
    let from_words = |first_word: u16, second_word: u16| -> [u8; 4] {
        [
            (first_word >> 8) as u8,
            (first_word & 255) as u8,
            (second_word >> 8) as u8,
            (second_word & 255) as u8,
        ]
    };

    if hextets[..5].iter().all(|part| *part == 0) && (hextets[5] == 0 || hextets[5] == 0xffff) {
        return Some(from_words(hextets[6], hextets[7]));
    }

    if hextets[0] == 0x64 && hextets[1] == 0xff9b && hextets[2..6].iter().all(|part| *part == 0) {
        return Some(from_words(hextets[6], hextets[7]));
    }

    if hextets[0] == 0x64
        && hextets[1] == 0xff9b
        && hextets[2] == 1
        && hextets[3..6].iter().all(|part| *part == 0)
    {
        return Some(from_words(hextets[6], hextets[7]));
    }

    if hextets[0] == 0x2002 {
        return Some(from_words(hextets[1], hextets[2]));
    }

    None
}

#[derive(Serialize)]
pub(crate) struct OpenAiChatRequest<'a> {
    pub(crate) model: &'a str,
    pub(crate) messages: Vec<AiMessage>,
    pub(crate) stream: bool,
    pub(crate) temperature: f32,
}

#[derive(Serialize)]
pub(crate) struct OpenAiResponsesRequest<'a> {
    pub(crate) model: &'a str,
    pub(crate) input: Vec<AiMessage>,
    pub(crate) stream: bool,
    pub(crate) store: bool,
    pub(crate) temperature: f32,
}

#[derive(Serialize)]
pub(crate) struct AnthropicRequest<'a> {
    pub(crate) model: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) system: Option<String>,
    pub(crate) messages: Vec<AiMessage>,
    pub(crate) stream: bool,
    pub(crate) max_tokens: i32,
}

#[derive(Serialize)]
pub(crate) struct AiMessage {
    pub(crate) role: &'static str,
    pub(crate) content: Value,
}

#[derive(Serialize)]
pub(crate) struct ImageGenerationRequest<'a> {
    pub(crate) model: &'a str,
    pub(crate) prompt: &'a str,
    pub(crate) n: i32,
    pub(crate) size: &'a str,
    pub(crate) response_format: &'a str,
}

#[cfg(test)]
mod tests {
    use super::{
        AnthropicRequest, AudioUpload, ImageUpload, MAX_IMAGE_FILE_BYTES, OpenAiChatRequest,
        OpenAiResponsesRequest, anthropic_chat_messages, apply_auth_headers, apply_proxy_headers,
        audio_speech_endpoint, audio_speech_request, audio_transcription_endpoint,
        audio_transcription_request_parts, chat_text_from_response, embeddings_endpoint,
        embeddings_request, endpoint_for, generated_image_from_json, image_data_url,
        image_edit_endpoint, image_edit_upload_part, image_responses_endpoint, model_list_endpoint,
        moderations_endpoint, moderations_request, openai_chat_messages, process_sse_event,
        provider_proxy_access_key, provider_request, realtime_client_secrets_endpoint,
        realtime_client_secrets_request, realtime_endpoint, realtime_request,
        responses_chat_messages, responses_image_edit_request, responses_image_generation_request,
        safe_generated_image_data_url, safe_generated_image_url, select_context_messages,
        split_anthropic_messages,
    };
    use crate::models::{
        ChatMessage, MessageAttachment, MessageRole, ProviderConfig, ProviderKind, SyncConfig,
    };

    #[test]
    fn chat_request_messages_include_user_image_attachments_as_multimodal_content() {
        let messages = vec![
            chat_message(
                "u",
                MessageRole::User,
                "describe this image",
                vec![
                    image_attachment("source", None, Some("data:image/png;base64,AA==")),
                    image_attachment("mask", Some("mask"), Some("data:image/png;base64,MASK")),
                ],
            ),
            chat_message(
                "a",
                MessageRole::Assistant,
                "generated",
                vec![image_attachment(
                    "generated",
                    Some("generated"),
                    Some("data:image/png;base64,GENERATED"),
                )],
            ),
        ];
        let selected = select_context_messages(&messages, 24);
        let openai = serde_json::to_value(OpenAiChatRequest {
            model: "gpt-5",
            messages: openai_chat_messages(&selected),
            stream: true,
            temperature: 0.7,
        })
        .expect("openai body should serialize");
        let responses = serde_json::to_value(OpenAiResponsesRequest {
            model: "gpt-5",
            input: responses_chat_messages(&selected),
            stream: true,
            store: false,
            temperature: 0.7,
        })
        .expect("responses body should serialize");
        let (system, anthropic_messages) =
            split_anthropic_messages(anthropic_chat_messages(&selected));
        let anthropic = serde_json::to_value(AnthropicRequest {
            model: "claude-sonnet-4-5",
            system,
            messages: anthropic_messages,
            stream: true,
            max_tokens: 4096,
        })
        .expect("anthropic body should serialize");

        assert_eq!(openai["messages"][0]["content"][0]["type"], "text");
        assert_eq!(
            openai["messages"][0]["content"][0]["text"],
            "describe this image"
        );
        assert_eq!(openai["messages"][0]["content"][1]["type"], "image_url");
        assert_eq!(
            openai["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,AA=="
        );
        assert_eq!(openai["messages"][1]["content"], "generated");

        assert_eq!(responses["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(responses["input"][0]["content"][1]["type"], "input_image");
        assert_eq!(
            responses["input"][0]["content"][1]["image_url"],
            "data:image/png;base64,AA=="
        );

        assert_eq!(anthropic["messages"][0]["content"][0]["type"], "text");
        assert_eq!(anthropic["messages"][0]["content"][1]["type"], "image");
        assert_eq!(
            anthropic["messages"][0]["content"][1]["source"]["type"],
            "base64"
        );
        assert_eq!(
            anthropic["messages"][0]["content"][1]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(
            anthropic["messages"][0]["content"][1]["source"]["data"],
            "AA=="
        );
    }

    #[test]
    fn chat_request_messages_filter_unsafe_imported_image_sources() {
        let messages = vec![chat_message(
            "u",
            MessageRole::User,
            "inspect",
            vec![
                image_attachment("safe-data", None, Some("data:image/png;base64,AA==")),
                image_attachment(
                    "active-data",
                    None,
                    Some("data:image/svg+xml;base64,PHN2Zz4="),
                ),
                remote_image_attachment("credentials", "https://user:secret@cdn.example/image.png"),
                remote_image_attachment("loopback", "https://127.0.0.1/image.png"),
                remote_image_attachment("runtime-blob", "blob:zerochat-image"),
                remote_image_attachment(
                    "safe-remote",
                    "https://cdn.example.test/image.webp?size=1024",
                ),
            ],
        )];
        let selected = select_context_messages(&messages, 24);
        let openai = serde_json::to_string(&openai_chat_messages(&selected))
            .expect("openai messages should serialize");
        let responses = serde_json::to_string(&responses_chat_messages(&selected))
            .expect("responses messages should serialize");
        let anthropic = serde_json::to_string(&anthropic_chat_messages(&selected))
            .expect("anthropic messages should serialize");

        for payload in [&openai, &responses] {
            assert!(payload.contains("data:image/png;base64,AA=="));
            assert!(payload.contains("cdn.example.test"));
            assert!(!payload.contains("image/svg+xml"));
            assert!(!payload.contains("user:secret"));
            assert!(!payload.contains("127.0.0.1"));
            assert!(!payload.contains("blob:zerochat-image"));
        }

        assert!(anthropic.contains("image/png"));
        assert!(anthropic.contains("AA=="));
        assert!(!anthropic.contains("cdn.example.test"));
        assert!(!anthropic.contains("image/svg+xml"));
    }

    #[test]
    fn generated_image_parser_accepts_responses_image_tool_output() {
        let image = generated_image_from_json(
            r#"{
              "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "done"}]},
                {
                  "type": "image_generation_call",
                  "result": "abc123",
                  "output_format": "jpeg",
                  "revised_prompt": "refined"
                }
              ]
            }"#,
        )
        .expect("responses image output should parse");

        assert_eq!(
            image.data_url.as_deref(),
            Some("data:image/jpeg;base64,abc123")
        );
        assert_eq!(image.mime_type, "image/jpeg");
        assert_eq!(image.revised_prompt.as_deref(), Some("refined"));
    }

    #[test]
    fn chat_text_blocks_preserve_order_and_stream_whitespace() {
        let response = r#"{
          "choices": [{
            "message": {
              "content": [
                {"type": "text", "text": "Hello "},
                {"type": "image_url"},
                {"type": "text", "text": "world"}
              ]
            }
          }]
        }"#;
        assert_eq!(
            chat_text_from_response(response).as_deref(),
            Some("Hello world")
        );

        let mut received = String::new();
        let mut partials = Vec::new();
        let mut on_partial = |partial: String| {
            partials.push(partial);
            true
        };
        let mut first_event = vec![
            r#"{"choices":[{"delta":{"content":[{"type":"text","text":"Hello "},{"type":"image_url"}]}}]}"#
                .to_owned(),
        ];
        let mut second_event = vec![
            r#"{"choices":[{"delta":{"content":[{"type":"text","text":"world"}]}}]}"#.to_owned(),
        ];

        assert!(process_sse_event(
            &mut first_event,
            &mut received,
            &mut on_partial
        ));
        assert!(process_sse_event(
            &mut second_event,
            &mut received,
            &mut on_partial
        ));
        assert_eq!(received, "Hello world");
        assert_eq!(partials, vec!["Hello ", "Hello world"]);
    }

    #[test]
    fn generated_image_safety_rejects_active_data_and_unsafe_remote_urls() {
        assert_eq!(
            safe_generated_image_data_url(" data:image/jpg;base64,YQ== "),
            Some((
                "data:image/jpeg;base64,YQ==".to_owned(),
                "image/jpeg".to_owned(),
            ))
        );
        assert!(safe_generated_image_data_url("data:image/svg+xml;base64,PHN2Zz4=").is_none());
        assert!(
            safe_generated_image_data_url("data:text/html;base64,PGgxPkJvb208L2gxPg==").is_none()
        );
        assert!(safe_generated_image_data_url("data:image/png;base64,").is_none());
        assert_eq!(
            safe_generated_image_url(" https://cdn.example.test/image.png?size=1024 ").as_deref(),
            Some("https://cdn.example.test/image.png?size=1024")
        );

        for url in [
            "intent://open/image",
            "file:///tmp/image.png",
            "https://user:secret@cdn.example/image.png",
            "https://localhost/image.png",
            "https://192.168.1.2/image.png",
            "https:///missing-host.png",
        ] {
            assert!(safe_generated_image_url(url).is_none(), "{url}");
            let response = format!(r#"{{"data":[{{"url":"{url}"}}]}}"#);
            assert!(generated_image_from_json(&response).is_err(), "{url}");
        }
    }

    #[test]
    fn generated_image_safety_rejects_data_urls_over_the_decoded_image_budget() {
        let encoded_length = 4 * (MAX_IMAGE_FILE_BYTES / 3 + 1);
        let oversized = format!("data:image/png;base64,{}", "A".repeat(encoded_length));

        assert!(safe_generated_image_data_url(&oversized).is_none());
    }

    #[test]
    fn responses_image_tool_contract_uses_chat_model_and_data_url_input() {
        let provider = provider("https://api.example.test/v1/images/generations");
        let generation = responses_image_generation_request("gpt-5.5", "Draw OK", "1024x1024");
        let edit = responses_image_edit_request(
            "gpt-5.5",
            "Edit OK",
            &ImageUpload {
                bytes: b"png".to_vec(),
                file_name: "source.png".to_owned(),
                mime_type: "image/png".to_owned(),
            },
            "1024x1024",
        );

        assert_eq!(
            image_responses_endpoint(&provider).expect("endpoint should build"),
            "https://api.example.test/v1/responses"
        );
        assert_eq!(generation["model"], "gpt-5.5");
        assert_eq!(generation["tools"][0]["type"], "image_generation");
        assert_eq!(generation["tools"][0]["action"], "generate");
        assert_eq!(generation["store"], false);
        assert_eq!(edit["model"], "gpt-5.5");
        assert_eq!(edit["input"][0]["content"][1]["type"], "input_image");
        assert_eq!(
            edit["input"][0]["content"][1]["image_url"],
            "data:image/png;base64,cG5n"
        );
        assert_eq!(edit["tools"][0]["action"], "edit");
    }

    #[test]
    fn image_edit_upload_parts_infer_names_mime_types_and_preserve_bytes() {
        let image = image_edit_upload_part(
            "image",
            ImageUpload {
                bytes: vec![1, 2],
                file_name: " ".to_owned(),
                mime_type: " ".to_owned(),
            },
            "image.png",
        );
        let mask = image_edit_upload_part(
            "mask",
            ImageUpload {
                bytes: vec![3, 4],
                file_name: " mask.webp ".to_owned(),
                mime_type: " ".to_owned(),
            },
            "mask.png",
        );

        assert_eq!(image.field, "image");
        assert_eq!(image.file_name, "image.png");
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.bytes, vec![1, 2]);
        assert_eq!(mask.field, "mask");
        assert_eq!(mask.file_name, "mask.webp");
        assert_eq!(mask.mime_type, "image/webp");
        assert_eq!(mask.bytes, vec![3, 4]);
        assert!(
            image_data_url(&ImageUpload {
                bytes: vec![5],
                file_name: " source.webp ".to_owned(),
                mime_type: " ".to_owned(),
            })
            .starts_with("data:image/webp;base64,")
        );
    }

    #[test]
    fn capability_endpoints_normalize_known_endpoint_roots() {
        let pasted_embedding_endpoint = provider("https://api.example.test/v1/embeddings");
        let pasted_audio_endpoint = provider("https://api.example.test/v1/audio/speech");
        let pasted_realtime_secret_endpoint =
            provider("https://api.example.test/v1/realtime/client_secrets");
        let mut proxied = provider("https://api.example.test/v1/realtime");
        proxied.proxy_url = Some(" https://proxy.example.test ".to_owned());
        let mut proxy_endpoint = provider("https://api.example.test/v1");
        proxy_endpoint.proxy_url = Some("https://proxy.example.test/zerochat/proxy".to_owned());
        let mut proxy_host_list_endpoint = provider("https://api.example.test/v1");
        proxy_host_list_endpoint.proxy_url =
            Some("https://proxy.example.test/zerochat/proxy/hosts".to_owned());
        let repeated_suffix = provider("https://api.example.test/v1/responses/responses");

        assert_eq!(
            audio_speech_endpoint(&pasted_embedding_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/audio/speech"
        );
        assert_eq!(
            audio_transcription_endpoint(&pasted_audio_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/audio/transcriptions"
        );
        assert_eq!(
            embeddings_endpoint(&pasted_audio_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/embeddings"
        );
        assert_eq!(
            moderations_endpoint(&pasted_embedding_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/moderations"
        );
        assert_eq!(
            realtime_endpoint(&pasted_embedding_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/realtime"
        );
        assert_eq!(
            realtime_endpoint(&pasted_realtime_secret_endpoint).expect("endpoint should build"),
            "https://api.example.test/v1/realtime"
        );
        assert_eq!(
            realtime_client_secrets_endpoint(&pasted_embedding_endpoint)
                .expect("endpoint should build"),
            "https://api.example.test/v1/realtime/client_secrets"
        );
        assert_eq!(
            realtime_client_secrets_endpoint(&pasted_realtime_secret_endpoint)
                .expect("endpoint should build"),
            "https://api.example.test/v1/realtime/client_secrets"
        );
        assert_eq!(
            realtime_client_secrets_endpoint(&proxied).expect("endpoint should build"),
            "https://proxy.example.test/proxy"
        );
        assert_eq!(
            endpoint_for(&proxy_endpoint).expect("endpoint should build"),
            "https://proxy.example.test/zerochat/proxy"
        );
        assert_eq!(
            model_list_endpoint(&proxy_endpoint).expect("endpoint should build"),
            "https://proxy.example.test/zerochat/proxy"
        );
        assert_eq!(
            image_edit_endpoint(&proxy_host_list_endpoint).expect("endpoint should build"),
            "https://proxy.example.test/zerochat/proxy"
        );
        assert_eq!(
            realtime_endpoint(&repeated_suffix).expect("endpoint should build"),
            "https://api.example.test/v1/responses/realtime"
        );
    }

    #[test]
    fn managed_proxy_auth_omits_stale_provider_key() {
        let mut managed = provider("https://api.example.test/v1");
        managed.proxy_url = Some("https://proxy.example.test".to_owned());
        managed.needs_api_key = false;
        let request = apply_auth_headers(
            reqwest::Client::new().post("https://proxy.example.test/proxy"),
            &managed,
            "stale-provider-key",
        )
        .build()
        .expect("request should build");

        assert!(request.headers().get("authorization").is_none());
        assert!(request.headers().get("x-api-key").is_none());
    }

    #[test]
    fn provider_proxy_access_key_skips_direct_providers() {
        let provider = provider("https://api.example.test/v1");
        let mut calls = 0;

        let token = provider_proxy_access_key(&provider, || {
            calls += 1;
            "proxy-token".to_owned()
        });

        assert_eq!(token, "");
        assert_eq!(calls, 0);
    }

    #[test]
    fn provider_proxy_access_key_derives_only_for_request_proxy() {
        let mut provider = provider("https://api.example.test/v1");
        provider.proxy_url = Some("https://proxy.example.test".to_owned());
        let mut calls = 0;

        let token = provider_proxy_access_key(&provider, || {
            calls += 1;
            "proxy-token".to_owned()
        });

        assert_eq!(token, "proxy-token");
        assert_eq!(calls, 1);
    }

    #[test]
    fn provider_request_strips_client_mode_proxy_before_access_key() {
        let mut provider = provider("https://api.example.test/v1");
        provider.client_request_mode = true;
        provider.proxy_url = Some("https://proxy.example.test".to_owned());
        let request_provider = provider_request(&provider, &sync_config("local", None));
        let mut calls = 0;

        let token = provider_proxy_access_key(&request_provider, || {
            calls += 1;
            "proxy-token".to_owned()
        });

        assert!(request_provider.proxy_url.is_none());
        assert_eq!(token, "");
        assert_eq!(calls, 0);
    }

    #[test]
    fn provider_request_strips_client_mode_proxy_before_capability_endpoint() {
        let mut provider = provider("https://api.example.test/v1");
        provider.client_request_mode = true;
        provider.proxy_url = Some("https://proxy.example.test".to_owned());

        let request_provider = provider_request(&provider, &sync_config("local", None));

        assert!(request_provider.proxy_url.is_none());
        assert_eq!(
            embeddings_endpoint(&request_provider).expect("endpoint should build"),
            "https://api.example.test/v1/embeddings"
        );
    }

    #[test]
    fn proxy_headers_send_api_root_when_base_url_is_endpoint_suffixed() {
        let mut provider = provider("https://api.example.test/v1/realtime/client_secrets");
        provider.proxy_url = Some("https://proxy.example.test".to_owned());
        let request = apply_proxy_headers(
            reqwest::Client::new().post("https://proxy.example.test/proxy"),
            &provider,
            "access-key",
            "realtime-client-secrets",
        )
        .expect("proxy headers should build")
        .build()
        .expect("request should build");

        assert_eq!(
            request
                .headers()
                .get("x-zerochat-base-url")
                .and_then(|value| value.to_str().ok()),
            Some("https://api.example.test/v1")
        );
        assert_eq!(
            request
                .headers()
                .get("x-zerochat-proxy-action")
                .and_then(|value| value.to_str().ok()),
            Some("realtime-client-secrets")
        );
    }

    #[test]
    fn endpoint_safety_rejects_special_use_ip_ranges() {
        for base_url in [
            "https://192.0.2.1/v1",
            "https://198.18.0.1/v1",
            "https://198.51.100.2/v1",
            "https://203.0.113.8/v1",
            "https://224.0.0.1/v1",
            "https://[2001:db8::1]/v1",
            "https://[ff02::1]/v1",
            "https://[64:ff9b::c000:201]/v1",
            "https://[2002:c000:0201::1]/v1",
        ] {
            assert!(
                endpoint_for(&provider(base_url)).is_err(),
                "{base_url} should be rejected"
            );
        }
    }

    #[test]
    fn remote_url_safety_rejects_single_label_and_ambiguous_numeric_hosts() {
        for host in [
            "api",
            "0",
            "2130706433",
            "0x7f000001",
            "0x7f.0.0.1",
            "0177.0.0.1",
            "127.1",
            "127.0.1",
            "999.999.999.999",
        ] {
            let base_url = format!("https://{host}/v1");
            let image_url = format!("https://{host}/image.png");

            assert!(
                endpoint_for(&provider(&base_url)).is_err(),
                "{base_url} should be rejected"
            );
            assert!(
                safe_generated_image_url(&image_url).is_none(),
                "{image_url} should be rejected"
            );
        }
    }

    #[test]
    fn provider_request_reuses_cloudflare_worker_fallback_for_access_key() {
        let provider = provider("https://api.example.test/v1");
        let request_provider = provider_request(
            &provider,
            &sync_config("cloudflare", Some(" https://sync.example.workers.dev ")),
        );
        let mut calls = 0;

        let token = provider_proxy_access_key(&request_provider, || {
            calls += 1;
            "worker-token".to_owned()
        });

        assert_eq!(
            request_provider.proxy_url.as_deref(),
            Some("https://sync.example.workers.dev")
        );
        assert_eq!(token, "worker-token");
        assert_eq!(calls, 1);
    }

    #[test]
    fn capability_json_bodies_trim_metadata_without_rewriting_input_text() {
        let speech = audio_speech_request(
            " tts-1 ",
            "  speak this exactly  ",
            Some(" nova "),
            Some(" wav "),
            Some(1.1),
        );
        let embeddings = embeddings_request(
            " text-embedding-3-large ",
            serde_json::json!([" keep spaces ", "second"]),
        );
        let moderation = moderations_request(
            " omni-moderation-latest ",
            serde_json::json!(" inspect this text "),
        );
        let realtime = realtime_request(
            " gpt-realtime-2 ",
            &[" text ", "audio", " "],
            Some(" stay brief "),
            Some(" alloy "),
            Some(" pcm16 "),
            Some(" opus "),
        );
        let realtime_client_secrets = realtime_client_secrets_request(
            " gpt-realtime-2 ",
            &[" text ", "audio", " "],
            Some(" stay brief "),
            Some(" alloy "),
            Some(" pcm16 "),
            Some(" g711_ulaw "),
        );

        assert_eq!(speech["model"], "tts-1");
        assert_eq!(speech["input"], "  speak this exactly  ");
        assert_eq!(speech["voice"], "nova");
        assert_eq!(speech["response_format"], "wav");
        assert_eq!(speech["speed"], 1.1);
        assert_eq!(embeddings["model"], "text-embedding-3-large");
        assert_eq!(embeddings["input"][0], " keep spaces ");
        assert_eq!(embeddings["input"][1], "second");
        assert_eq!(moderation["model"], "omni-moderation-latest");
        assert_eq!(moderation["input"], " inspect this text ");
        assert_eq!(realtime["model"], "gpt-realtime-2");
        assert_eq!(realtime["modalities"][0], "text");
        assert_eq!(realtime["modalities"].as_array().unwrap().len(), 1);
        assert_eq!(realtime["instructions"], "stay brief");
        assert!(realtime.get("voice").is_none());
        assert_eq!(realtime["input_audio_format"], "pcm16");
        assert!(realtime.get("output_audio_format").is_none());
        assert_eq!(
            realtime_client_secrets["expires_after"]["anchor"],
            "created_at"
        );
        assert_eq!(realtime_client_secrets["expires_after"]["seconds"], 600);
        assert_eq!(realtime_client_secrets["session"]["type"], "realtime");
        assert_eq!(
            realtime_client_secrets["session"]["model"],
            "gpt-realtime-2"
        );
        assert_eq!(
            realtime_client_secrets["session"]["output_modalities"][0],
            "text"
        );
        assert_eq!(
            realtime_client_secrets["session"]["output_modalities"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            realtime_client_secrets["session"]["instructions"],
            "stay brief"
        );
        assert_eq!(
            realtime_client_secrets["session"]["audio"]["input"]["format"]["type"],
            "audio/pcm"
        );
        assert_eq!(
            realtime_client_secrets["session"]["audio"]["input"]["format"]["rate"],
            24000
        );
        assert!(
            realtime_client_secrets["session"]["audio"]
                .get("output")
                .is_none()
        );

        let audio_realtime_client_secrets = realtime_client_secrets_request(
            " gpt-realtime-2 ",
            &[" audio "],
            None,
            Some(" alloy "),
            None,
            Some(" g711_ulaw "),
        );
        assert_eq!(
            audio_realtime_client_secrets["session"]["output_modalities"][0],
            "audio"
        );
        assert_eq!(
            audio_realtime_client_secrets["session"]["audio"]["output"]["format"]["type"],
            "audio/pcmu"
        );
        assert_eq!(
            audio_realtime_client_secrets["session"]["audio"]["output"]["voice"],
            "alloy"
        );
    }

    #[test]
    fn audio_transcription_multipart_parts_trim_metadata_and_preserve_audio_bytes() {
        let parts = audio_transcription_request_parts(
            " whisper-1 ",
            AudioUpload {
                bytes: vec![1, 2, 3, 4],
                file_name: " ".to_owned(),
                mime_type: " ".to_owned(),
            },
            Some(" ZeroChat names "),
            Some(" en "),
            Some(" verbose_json "),
            Some(0.0),
        );
        let fields = parts
            .fields
            .iter()
            .map(|field| (field.name.as_str(), field.value.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(
            fields,
            vec![
                ("model", "whisper-1"),
                ("prompt", "ZeroChat names"),
                ("language", "en"),
                ("response_format", "verbose_json"),
                ("temperature", "0"),
            ]
        );
        assert_eq!(parts.file_name, "audio.webm");
        assert_eq!(parts.mime_type, "audio/webm");
        assert_eq!(parts.bytes, vec![1, 2, 3, 4]);

        let wav_parts = audio_transcription_request_parts(
            "whisper-1",
            AudioUpload {
                bytes: vec![5, 6],
                file_name: " voice.wav ".to_owned(),
                mime_type: " ".to_owned(),
            },
            None,
            None,
            None,
            None,
        );
        assert_eq!(wav_parts.file_name, "voice.wav");
        assert_eq!(wav_parts.mime_type, "audio/wav");
    }

    fn chat_message(
        id: &str,
        role: MessageRole,
        content: &str,
        attachments: Vec<MessageAttachment>,
    ) -> ChatMessage {
        ChatMessage {
            id: id.to_owned(),
            role,
            content: content.to_owned(),
            created_at: 1,
            status: None,
            error: None,
            attachments,
            queued_text_request: None,
            offline_replay_claim: None,
        }
    }

    fn image_attachment(
        id: &str,
        purpose: Option<&str>,
        data_url: Option<&str>,
    ) -> MessageAttachment {
        MessageAttachment {
            id: id.to_owned(),
            kind: "image".to_owned(),
            purpose: purpose.map(str::to_owned),
            mime_type: "image/png".to_owned(),
            data_url: data_url.map(str::to_owned),
            url: None,
            alt: None,
            model: None,
            created_at: 1,
        }
    }

    fn remote_image_attachment(id: &str, url: &str) -> MessageAttachment {
        MessageAttachment {
            id: id.to_owned(),
            kind: "image".to_owned(),
            purpose: None,
            mime_type: "image/png".to_owned(),
            data_url: None,
            url: Some(url.to_owned()),
            alt: None,
            model: None,
            created_at: 1,
        }
    }

    fn provider(base_url: &str) -> ProviderConfig {
        ProviderConfig {
            id: "provider".to_owned(),
            name: "Provider".to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: base_url.to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: "gpt-5.4-mini".to_owned(),
            image_model: Some("gpt-image-2".to_owned()),
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: vec!["gpt-5.5".to_owned(), "gpt-image-2".to_owned()],
            capabilities: vec!["chat".to_owned(), "image-generation".to_owned()],
            enabled: true,
            needs_api_key: true,
            custom: Some(false),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn sync_config(mode: &str, worker_endpoint: Option<&str>) -> SyncConfig {
        SyncConfig {
            mode: mode.to_owned(),
            auto_sync: false,
            encryption_enabled: true,
            gist_id: None,
            gist_file: None,
            worker_endpoint: worker_endpoint.map(str::to_owned),
            last_sync_at: None,
            last_sync_status: None,
        }
    }
}
