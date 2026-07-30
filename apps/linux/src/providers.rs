use crate::{
    ImageTaskMode, LinuxAppState,
    ai::ImageUpload,
    ai_protocol::{provider_needs_client_key, provider_request},
    i18n::tr,
    models::{ProviderConfig, ProviderKind},
};

pub(crate) fn provider_display_name(locale: &str, provider: &ProviderConfig) -> String {
    if provider.id == "custom-openai"
        && provider.custom.unwrap_or(false)
        && provider.name == "Custom relay (OpenAI compatible)"
    {
        return tr(locale, "provider.preset.custom-openai-relay").to_owned();
    }

    provider.name.clone()
}

#[derive(Clone)]
pub(crate) struct ProviderModelOption {
    pub(crate) label: String,
    pub(crate) provider_id: String,
    pub(crate) model: String,
}

#[derive(Clone, Copy)]
pub(crate) enum ProviderModelCapability {
    Chat,
    ImageGeneration,
    ImageEditing,
    Embeddings,
    Audio,
    Realtime,
    Moderation,
}

pub(crate) fn provider_model_options(
    locale: &str,
    state: &LinuxAppState,
) -> (Vec<ProviderModelOption>, u32) {
    let snapshot = state.snapshot.borrow();
    let active_conversation = snapshot
        .preferences
        .active_conversation_id
        .as_deref()
        .and_then(|id| {
            snapshot
                .conversations
                .iter()
                .find(|conversation| conversation.id == id)
        });
    let target_provider = active_conversation
        .and_then(|conversation| {
            snapshot
                .providers
                .iter()
                .find(|provider| provider.id == conversation.provider_id && provider.enabled)
        })
        .or_else(|| {
            snapshot
                .providers
                .iter()
                .find(|provider| provider.enabled)
                .or_else(|| snapshot.providers.first())
        });
    let target = target_provider.map(|provider| {
        let conversation_model = active_conversation
            .filter(|conversation| conversation.provider_id == provider.id)
            .map(|conversation| conversation.model.as_str());
        (
            provider.id.clone(),
            chat_model_for_conversation(conversation_model, provider),
        )
    });

    let mut options = Vec::new();
    let mut selected = 0_u32;
    let mut found_selected = false;

    let enabled_providers = snapshot
        .providers
        .iter()
        .filter(|provider| provider.enabled)
        .collect::<Vec<_>>();
    let visible_providers = if enabled_providers.is_empty() {
        snapshot.providers.iter().take(1).collect::<Vec<_>>()
    } else {
        enabled_providers
    };

    for provider in visible_providers {
        let provider_name = provider_display_name(locale, provider);
        for model in provider_model_values(provider) {
            let model_label = if model.is_empty() {
                tr(locale, "option.emptyModel").to_owned()
            } else {
                model.clone()
            };
            let index = options.len() as u32;
            if !found_selected {
                if let Some((target_provider_id, target_model)) = &target {
                    if provider.id.as_str() == target_provider_id.as_str()
                        && model.as_str() == target_model.as_str()
                    {
                        selected = index;
                        found_selected = true;
                    }
                }
            }
            options.push(ProviderModelOption {
                label: format!("{} / {}", provider_name, model_label),
                provider_id: provider.id.clone(),
                model,
            });
        }
    }

    if options.is_empty() {
        options.push(ProviderModelOption {
            label: format!(
                "{} / {}",
                tr(locale, "field.providerModel"),
                tr(locale, "option.emptyModel")
            ),
            provider_id: "custom-openai".to_owned(),
            model: String::new(),
        });
    }

    (options, selected)
}

fn provider_model_values(provider: &ProviderConfig) -> Vec<String> {
    let models = selectable_models_for_provider(provider);

    if models.is_empty() {
        vec![String::new()]
    } else {
        models
    }
}

pub(crate) fn image_model_for_provider(
    provider: &ProviderConfig,
    _conversation_model: &str,
) -> String {
    model_for_provider_capability(provider, ProviderModelCapability::ImageGeneration)
}

pub(crate) fn image_editing_model_for_provider(
    provider: &ProviderConfig,
    _conversation_model: &str,
) -> String {
    model_for_provider_capability(provider, ProviderModelCapability::ImageEditing)
}

pub(crate) fn is_likely_image_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    [
        "dall-e",
        "flux",
        "gpt-image",
        "image",
        "imagen",
        "midjourney",
        "stable-diffusion",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

pub(crate) fn is_likely_image_editing_model(model: &str) -> bool {
    is_likely_image_model(model) && !model.to_lowercase().contains("dall-e-3")
}

pub(crate) fn is_likely_chat_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    if normalized.contains("audio-preview") {
        return true;
    }

    [
        "audio",
        "dall-e",
        "embed",
        "embedding",
        "kling",
        "flux",
        "gpt-image",
        "image",
        "imagen",
        "midjourney",
        "moderation",
        "rerank",
        "realtime",
        "speech",
        "stable-diffusion",
        "transcribe",
        "tts",
        "upscale",
        "whisper",
    ]
    .iter()
    .all(|marker| !normalized.contains(marker))
}

fn unique_models(models: impl IntoIterator<Item = String>) -> Vec<String> {
    models.into_iter().fold(Vec::new(), |mut unique, model| {
        let model = model.trim().to_owned();
        if !model.is_empty() && !unique.iter().any(|existing| existing == &model) {
            unique.push(model);
        }
        unique
    })
}

pub(crate) fn selectable_models_for_provider(provider: &ProviderConfig) -> Vec<String> {
    let listed_models = unique_models(provider.models.clone());
    if !listed_models.is_empty() {
        return listed_models;
    }

    unique_models([
        provider.model.clone(),
        provider.image_model.clone().unwrap_or_default(),
        provider.audio_speech_model.clone().unwrap_or_default(),
        provider
            .audio_transcription_model
            .clone()
            .unwrap_or_default(),
        provider.embedding_model.clone().unwrap_or_default(),
        provider.moderation_model.clone().unwrap_or_default(),
        provider.realtime_model.clone().unwrap_or_default(),
    ])
}

pub(crate) fn chat_models_for_provider(provider: &ProviderConfig) -> Vec<String> {
    selectable_models_for_provider(provider)
        .into_iter()
        .filter(|model| is_likely_chat_model(model))
        .collect()
}

fn model_version_score(model: &str, family: &str) -> i32 {
    let Some(start) = model.find(family) else {
        return 0;
    };
    let mut chars = model[start + family.len()..]
        .trim_start_matches(|character| character == '-' || character == '_' || character == ' ')
        .chars()
        .peekable();
    let mut parts = Vec::new();
    let mut current = String::new();

    while let Some(character) = chars.next() {
        if character.is_ascii_digit() {
            current.push(character);
            continue;
        }

        let next_is_digit = chars
            .peek()
            .map(|next| next.is_ascii_digit())
            .unwrap_or(false);
        if matches!(character, '.' | '-' | '_') && !current.is_empty() && next_is_digit {
            parts.push(current.parse::<i32>().unwrap_or(0));
            current.clear();
            continue;
        }

        break;
    }

    if !current.is_empty() {
        parts.push(current.parse::<i32>().unwrap_or(0));
    }

    parts
        .into_iter()
        .take(3)
        .enumerate()
        .fold(0, |score, (index, value)| {
            if index >= 2 && value > 99 {
                return score;
            }
            score
                + value
                    * match index {
                        0 => 10_000,
                        1 => 100,
                        _ => 1,
                    }
        })
}

fn model_variant_preference_score(model: &str) -> i32 {
    let variants: Vec<&str> = model
        .to_ascii_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|variant| !variant.is_empty())
        .collect();

    if variants.contains(&"sol") {
        return 1_200;
    }
    if variants.contains(&"terra") {
        return 800;
    }
    if variants.contains(&"luna") {
        return 400;
    }
    0
}

pub(crate) fn chat_model_preference_score(model: &str) -> i32 {
    let normalized = model.to_lowercase();
    let mut score = 0;

    if normalized.contains("gpt-") {
        score += 100_000
            + model_version_score(&normalized, "gpt")
            + model_variant_preference_score(&normalized);
    }

    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "o4")
    {
        score += 94_000;
    } else if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "o3")
    {
        score += 93_000;
    }

    if normalized.contains("claude") && normalized.contains("opus") {
        score += 92_000;
    } else if normalized.contains("claude") && normalized.contains("sonnet") {
        score += 90_000;
    }

    if normalized.contains("gemini") && normalized.contains("pro") {
        score += 88_000;
    }

    if normalized.contains("grok") {
        score += 86_000;
    }

    if normalized.contains("deepseek") && normalized.contains("r1") {
        score += 84_000;
    }

    if normalized.contains("qwen")
        && ["max", "plus", "coder"]
            .iter()
            .any(|marker| normalized.contains(marker))
    {
        score += 82_000;
    }

    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "pro")
    {
        score += 900;
    }
    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "max")
    {
        score += 850;
    }
    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "reasoning")
    {
        score += 780;
    }
    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "thinking")
    {
        score += 740;
    }
    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "large")
    {
        score += 650;
    }
    if normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == "latest")
    {
        score += 500;
    }

    if normalized.contains("mini") {
        score -= 1_200;
    }
    if normalized.contains("nano") {
        score -= 1_800;
    }
    if normalized.contains("lite") {
        score -= 1_600;
    }
    if normalized.contains("small") {
        score -= 1_300;
    }
    if normalized.contains("flash") {
        score -= 1_000;
    }
    if normalized.contains("spark") {
        score -= 800;
    }
    if normalized.contains("compact") {
        score -= 700;
    }
    if normalized.contains("auto-review") {
        score -= 2_500;
    }

    score
}

pub(crate) fn preferred_chat_model(models: &[String]) -> String {
    let mut chat_models = models
        .iter()
        .filter(|model| is_likely_chat_model(model))
        .cloned()
        .collect::<Vec<_>>();
    chat_models.sort_by(|left, right| {
        chat_model_preference_score(right)
            .cmp(&chat_model_preference_score(left))
            .then_with(|| left.cmp(right))
    });

    chat_models.first().cloned().unwrap_or_default()
}

pub(crate) fn default_chat_model_for_provider(provider: &ProviderConfig) -> String {
    model_for_provider_capability(provider, ProviderModelCapability::Chat)
}

fn chat_model_for_conversation(
    conversation_model: Option<&str>,
    provider: &ProviderConfig,
) -> String {
    let models = chat_models_for_provider(provider);
    let conversation_model = conversation_model.map(str::trim).unwrap_or_default();

    if !conversation_model.is_empty() && models.iter().any(|model| model == conversation_model) {
        return conversation_model.to_owned();
    }

    default_chat_model_for_provider(provider)
}

pub(crate) fn preferred_image_model(models: &[String]) -> String {
    for marker in [
        "gpt-image-2",
        "gpt-image-1",
        "dall-e-3",
        "dall-e-2",
        "imagen",
        "flux",
    ] {
        if let Some(model) = models
            .iter()
            .find(|model| model.to_lowercase().contains(marker))
        {
            return model.clone();
        }
    }

    models.first().cloned().unwrap_or_default()
}

pub(crate) fn is_likely_embedding_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    normalized.contains("embed") || normalized.contains("embedding")
}

pub(crate) fn is_likely_audio_model(model: &str) -> bool {
    model.to_lowercase().contains("audio")
        || is_likely_audio_speech_model(model)
        || is_likely_audio_transcription_model(model)
}

pub(crate) fn is_likely_audio_speech_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    ["tts", "speech"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

pub(crate) fn is_likely_audio_transcription_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    ["whisper", "transcri"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

pub(crate) fn is_likely_realtime_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    normalized.contains("realtime")
        || normalized == "gpt-audio"
        || normalized.starts_with("gpt-audio-")
}

pub(crate) fn is_likely_moderation_model(model: &str) -> bool {
    model.to_lowercase().contains("moderation")
}

pub(crate) fn model_capability_keys(model: &str) -> Vec<&'static str> {
    let mut keys = Vec::new();
    let audio_speech = is_likely_audio_speech_model(model);
    let audio_transcription = is_likely_audio_transcription_model(model);

    if is_likely_chat_model(model) {
        keys.push("capability.chat");
    }
    if is_likely_image_model(model) {
        keys.push("capability.image-generation");
    }
    if is_likely_image_editing_model(model) {
        keys.push("capability.image-editing");
    }
    if is_likely_audio_model(model) && !audio_speech && !audio_transcription {
        keys.push("capability.audio");
    }
    if audio_speech {
        keys.push("capability.audio-speech");
    }
    if audio_transcription {
        keys.push("capability.audio-transcription");
    }
    if is_likely_embedding_model(model) {
        keys.push("capability.embeddings");
    }
    if is_likely_realtime_model(model) {
        keys.push("capability.realtime");
    }
    if is_likely_moderation_model(model) {
        keys.push("capability.moderation");
    }

    keys
}

fn preferred_model_by_markers(
    models: &[String],
    markers: &[&str],
    is_likely_model: fn(&str) -> bool,
) -> String {
    for marker in markers {
        if let Some(model) = models
            .iter()
            .find(|model| model.to_lowercase().contains(marker))
        {
            return model.clone();
        }
    }

    models
        .iter()
        .find(|model| is_likely_model(model))
        .cloned()
        .unwrap_or_default()
}

pub(crate) fn preferred_embedding_model(models: &[String]) -> String {
    preferred_model_by_markers(
        models,
        &[
            "text-embedding-3-large",
            "text-embedding-3-small",
            "embedding",
            "embed",
        ],
        is_likely_embedding_model,
    )
}

pub(crate) fn preferred_audio_speech_model(models: &[String]) -> String {
    preferred_model_by_markers(
        models,
        &["gpt-4o-mini-tts", "tts-1-hd", "tts-1", "speech"],
        is_likely_audio_speech_model,
    )
}

pub(crate) fn preferred_audio_transcription_model(models: &[String]) -> String {
    preferred_model_by_markers(
        models,
        &[
            "gpt-4o-transcribe",
            "gpt-4o-mini-transcribe",
            "whisper-1",
            "transcribe",
            "whisper",
        ],
        is_likely_audio_transcription_model,
    )
}

pub(crate) fn preferred_audio_model(models: &[String]) -> String {
    let transcription_model = preferred_audio_transcription_model(models);
    if transcription_model.is_empty() {
        let speech_model = preferred_audio_speech_model(models);
        if speech_model.is_empty() {
            preferred_model_by_markers(models, &["audio"], is_likely_audio_model)
        } else {
            speech_model
        }
    } else {
        transcription_model
    }
}

pub(crate) fn model_for_provider_audio_speech(provider: &ProviderConfig) -> String {
    let models = selectable_models_for_provider(provider)
        .into_iter()
        .filter(|model| is_likely_audio_speech_model(model))
        .collect::<Vec<_>>();

    if let Some(configured) = provider
        .audio_speech_model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty() && models.iter().any(|candidate| candidate == model))
    {
        return configured.to_owned();
    }

    preferred_audio_speech_model(&models)
}

pub(crate) fn model_for_provider_audio_transcription(provider: &ProviderConfig) -> String {
    let models = selectable_models_for_provider(provider)
        .into_iter()
        .filter(|model| is_likely_audio_transcription_model(model))
        .collect::<Vec<_>>();

    if let Some(configured) = provider
        .audio_transcription_model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty() && models.iter().any(|candidate| candidate == model))
    {
        return configured.to_owned();
    }

    preferred_audio_transcription_model(&models)
}

pub(crate) fn preferred_realtime_model(models: &[String]) -> String {
    preferred_model_by_markers(
        models,
        &[
            "gpt-realtime-2",
            "gpt-audio-1.5",
            "gpt-realtime",
            "gpt-audio-mini",
            "gpt-realtime-mini",
            "gpt-4o-realtime",
            "realtime",
        ],
        is_likely_realtime_model,
    )
}

pub(crate) fn preferred_moderation_model(models: &[String]) -> String {
    preferred_model_by_markers(
        models,
        &[
            "omni-moderation-latest",
            "omni-moderation",
            "moderation-latest",
            "moderation",
        ],
        is_likely_moderation_model,
    )
}

pub(crate) fn models_for_provider_capability(
    provider: &ProviderConfig,
    capability: ProviderModelCapability,
) -> Vec<String> {
    match capability {
        ProviderModelCapability::Chat => chat_models_for_provider(provider),
        ProviderModelCapability::ImageGeneration => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_image_model(model))
            .collect(),
        ProviderModelCapability::ImageEditing => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_image_editing_model(model))
            .collect(),
        ProviderModelCapability::Embeddings => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_embedding_model(model))
            .collect(),
        ProviderModelCapability::Audio => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_audio_model(model))
            .collect(),
        ProviderModelCapability::Realtime => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_realtime_model(model))
            .collect(),
        ProviderModelCapability::Moderation => selectable_models_for_provider(provider)
            .into_iter()
            .filter(|model| is_likely_moderation_model(model))
            .collect(),
    }
}

pub(crate) fn preferred_model_for_capability(
    models: &[String],
    capability: ProviderModelCapability,
) -> String {
    match capability {
        ProviderModelCapability::Chat => preferred_chat_model(models),
        ProviderModelCapability::ImageGeneration | ProviderModelCapability::ImageEditing => {
            preferred_image_model(models)
        }
        ProviderModelCapability::Embeddings => preferred_embedding_model(models),
        ProviderModelCapability::Audio => preferred_audio_model(models),
        ProviderModelCapability::Realtime => preferred_realtime_model(models),
        ProviderModelCapability::Moderation => preferred_moderation_model(models),
    }
}

pub(crate) fn model_for_provider_capability(
    provider: &ProviderConfig,
    capability: ProviderModelCapability,
) -> String {
    let models = models_for_provider_capability(provider, capability);
    let configured_model = match capability {
        ProviderModelCapability::Chat => provider.model.trim(),
        ProviderModelCapability::ImageGeneration | ProviderModelCapability::ImageEditing => {
            provider
                .image_model
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
        }
        ProviderModelCapability::Embeddings => provider
            .embedding_model
            .as_deref()
            .map(str::trim)
            .unwrap_or_default(),
        ProviderModelCapability::Audio => provider
            .audio_speech_model
            .as_deref()
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .or_else(|| provider.audio_transcription_model.as_deref().map(str::trim))
            .unwrap_or_default(),
        ProviderModelCapability::Realtime => provider
            .realtime_model
            .as_deref()
            .map(str::trim)
            .unwrap_or_default(),
        ProviderModelCapability::Moderation => provider
            .moderation_model
            .as_deref()
            .map(str::trim)
            .unwrap_or_default(),
    };

    if !configured_model.is_empty() && models.iter().any(|model| model == configured_model) {
        return configured_model.to_owned();
    }

    preferred_model_for_capability(&models, capability)
}

fn add_capability(capabilities: &mut Vec<String>, capability: &str) {
    if !capabilities.iter().any(|existing| existing == capability) {
        capabilities.push(capability.to_owned());
    }
}

pub(crate) fn capabilities_for_model_list(
    provider: &ProviderConfig,
    models: &[String],
) -> Vec<String> {
    let mut capabilities = if provider.capabilities.is_empty() {
        match &provider.kind {
            ProviderKind::Anthropic => vec![
                "chat".to_owned(),
                "vision".to_owned(),
                "tools".to_owned(),
                "model-list".to_owned(),
            ],
            ProviderKind::OpenaiResponses => vec![
                "chat".to_owned(),
                "vision".to_owned(),
                "tools".to_owned(),
                "image-generation".to_owned(),
                "image-editing".to_owned(),
                "model-list".to_owned(),
            ],
            ProviderKind::OpenaiCompatible => vec![
                "chat".to_owned(),
                "vision".to_owned(),
                "tools".to_owned(),
                "embeddings".to_owned(),
                "model-list".to_owned(),
            ],
        }
    } else {
        provider.capabilities.clone()
    };

    if models.iter().any(|model| is_likely_image_model(model)) {
        add_capability(&mut capabilities, "image-generation");
    }
    if models
        .iter()
        .any(|model| is_likely_image_editing_model(model))
    {
        add_capability(&mut capabilities, "image-editing");
    }

    for model in models {
        if is_likely_embedding_model(model) {
            add_capability(&mut capabilities, "embeddings");
        }

        if is_likely_audio_model(model) {
            add_capability(&mut capabilities, "audio");
        }

        if is_likely_realtime_model(model) {
            add_capability(&mut capabilities, "realtime");
        }

        if is_likely_moderation_model(model) {
            add_capability(&mut capabilities, "moderation");
        }
    }

    capabilities
}

pub(crate) fn apply_configured_provider_models(provider: &mut ProviderConfig, models: Vec<String>) {
    let next_models = unique_models(models);
    let chat_models = next_models
        .iter()
        .filter(|model| is_likely_chat_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let image_models = next_models
        .iter()
        .filter(|model| is_likely_image_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let audio_speech_models = next_models
        .iter()
        .filter(|model| is_likely_audio_speech_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let audio_transcription_models = next_models
        .iter()
        .filter(|model| is_likely_audio_transcription_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let embedding_models = next_models
        .iter()
        .filter(|model| is_likely_embedding_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let moderation_models = next_models
        .iter()
        .filter(|model| is_likely_moderation_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let realtime_models = next_models
        .iter()
        .filter(|model| is_likely_realtime_model(model))
        .cloned()
        .collect::<Vec<_>>();

    provider.models = next_models;
    provider.model = configured_or_preferred_model(
        Some(provider.model.as_str()),
        &chat_models,
        preferred_chat_model,
    );
    provider.image_model = option_from_model(configured_or_preferred_model(
        provider.image_model.as_deref(),
        &image_models,
        preferred_image_model,
    ));
    provider.audio_speech_model = option_from_model(configured_or_preferred_model(
        provider.audio_speech_model.as_deref(),
        &audio_speech_models,
        preferred_audio_speech_model,
    ));
    provider.audio_transcription_model = option_from_model(configured_or_preferred_model(
        provider.audio_transcription_model.as_deref(),
        &audio_transcription_models,
        preferred_audio_transcription_model,
    ));
    provider.embedding_model = option_from_model(configured_or_preferred_model(
        provider.embedding_model.as_deref(),
        &embedding_models,
        preferred_embedding_model,
    ));
    provider.moderation_model = option_from_model(configured_or_preferred_model(
        provider.moderation_model.as_deref(),
        &moderation_models,
        preferred_moderation_model,
    ));
    provider.realtime_model = option_from_model(configured_or_preferred_model(
        provider.realtime_model.as_deref(),
        &realtime_models,
        preferred_realtime_model,
    ));
    provider.capabilities = capabilities_for_model_list(provider, &provider.models);
}

pub(crate) fn apply_fetched_provider_models(provider: &mut ProviderConfig, models: Vec<String>) {
    let next_models = unique_models(models);

    if next_models.is_empty() {
        return;
    }

    let previous_models = unique_models(provider.models.clone());
    let chat_models = next_models
        .iter()
        .filter(|model| is_likely_chat_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let image_models = next_models
        .iter()
        .filter(|model| is_likely_image_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let audio_speech_models = next_models
        .iter()
        .filter(|model| is_likely_audio_speech_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let audio_transcription_models = next_models
        .iter()
        .filter(|model| is_likely_audio_transcription_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let embedding_models = next_models
        .iter()
        .filter(|model| is_likely_embedding_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let moderation_models = next_models
        .iter()
        .filter(|model| is_likely_moderation_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let realtime_models = next_models
        .iter()
        .filter(|model| is_likely_realtime_model(model))
        .cloned()
        .collect::<Vec<_>>();
    let current_model = provider.model.trim().to_owned();
    let current_image_model = provider
        .image_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let current_audio_speech_model = provider
        .audio_speech_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let current_audio_transcription_model = provider
        .audio_transcription_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let current_embedding_model = provider
        .embedding_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let current_moderation_model = provider
        .moderation_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let current_realtime_model = provider
        .realtime_model
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();

    provider.models = next_models;
    provider.model = preferred_fetched_model(
        Some(&current_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_chat_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &chat_models,
        preferred_chat_model,
    );
    let image_model = preferred_fetched_model(
        Some(&current_image_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_image_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &image_models,
        preferred_image_model,
    );
    provider.image_model = (!image_model.is_empty()).then_some(image_model);
    let audio_speech_model = preferred_fetched_model(
        Some(&current_audio_speech_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_audio_speech_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &audio_speech_models,
        preferred_audio_speech_model,
    );
    provider.audio_speech_model = (!audio_speech_model.is_empty()).then_some(audio_speech_model);
    let audio_transcription_model = preferred_fetched_model(
        Some(&current_audio_transcription_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_audio_transcription_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &audio_transcription_models,
        preferred_audio_transcription_model,
    );
    provider.audio_transcription_model =
        (!audio_transcription_model.is_empty()).then_some(audio_transcription_model);
    let embedding_model = preferred_fetched_model(
        Some(&current_embedding_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_embedding_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &embedding_models,
        preferred_embedding_model,
    );
    provider.embedding_model = (!embedding_model.is_empty()).then_some(embedding_model);
    let moderation_model = preferred_fetched_model(
        Some(&current_moderation_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_moderation_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &moderation_models,
        preferred_moderation_model,
    );
    provider.moderation_model = (!moderation_model.is_empty()).then_some(moderation_model);
    let realtime_model = preferred_fetched_model(
        Some(&current_realtime_model),
        &previous_models
            .iter()
            .filter(|model| is_likely_realtime_model(model))
            .cloned()
            .collect::<Vec<_>>(),
        &realtime_models,
        preferred_realtime_model,
    );
    provider.realtime_model = (!realtime_model.is_empty()).then_some(realtime_model);
    let capabilities = capabilities_for_model_list(provider, &provider.models);
    provider.capabilities = capabilities;
}

fn preferred_fetched_model(
    current_model: Option<&str>,
    previous_models: &[String],
    fetched_models: &[String],
    preferred_model: fn(&[String]) -> String,
) -> String {
    let current = current_model.map(str::trim).unwrap_or_default();

    if fetched_models.is_empty() {
        return String::new();
    }

    if current.is_empty() || !fetched_models.iter().any(|model| model == current) {
        return preferred_model(fetched_models);
    }

    let previous_preferred = preferred_model(previous_models);
    if !previous_preferred.is_empty() && current == previous_preferred {
        preferred_model(fetched_models)
    } else {
        current.to_owned()
    }
}

fn configured_or_preferred_model(
    current_model: Option<&str>,
    models: &[String],
    preferred_model: fn(&[String]) -> String,
) -> String {
    let current = current_model.unwrap_or_default().trim();
    if !current.is_empty() && models.iter().any(|model| model == current) {
        return current.to_owned();
    }

    preferred_model(models)
}

fn option_from_model(model: String) -> Option<String> {
    (!model.is_empty()).then_some(model)
}

fn provider_needs_client_key_for_ui(state: &LinuxAppState, provider: &ProviderConfig) -> bool {
    let request_provider = provider_request(provider, &state.sync_config());
    provider_needs_client_key(&request_provider)
}

pub(crate) fn provider_key_missing(state: &LinuxAppState, provider: &ProviderConfig) -> bool {
    provider_needs_client_key_for_ui(state, provider) && !state.has_provider_key(&provider.id)
}

fn active_provider_and_model(state: &LinuxAppState) -> Option<(ProviderConfig, String)> {
    let conversation = state.active_conversation();
    let providers = state.providers();
    let provider = conversation
        .as_ref()
        .and_then(|conversation| {
            providers
                .iter()
                .find(|provider| provider.id == conversation.provider_id && provider.enabled)
                .cloned()
        })
        .or_else(|| providers.iter().find(|provider| provider.enabled).cloned());

    provider.map(|provider| {
        let model = conversation
            .as_ref()
            .map(|conversation| conversation.model.trim().to_owned())
            .filter(|model| !model.is_empty())
            .unwrap_or_else(|| provider.model.trim().to_owned());
        (provider, model)
    })
}

pub(crate) fn chat_composer_hint(locale: &str, state: &LinuxAppState) -> Option<String> {
    let Some((provider, model)) = active_provider_and_model(state) else {
        return Some(tr(locale, "message.configureModelFirst").to_owned());
    };

    if provider_key_missing(state, &provider) {
        return Some(tr(locale, "error.providerKeyRequired").to_owned());
    }

    if model.trim().is_empty() {
        return Some(tr(locale, "message.modelRequired").to_owned());
    }

    None
}

pub(crate) fn active_image_provider_model_label(locale: &str, state: &LinuxAppState) -> String {
    let conversation = state.active_conversation();
    let providers = state.providers();
    let provider = conversation
        .as_ref()
        .and_then(|conversation| {
            providers
                .iter()
                .find(|provider| provider.id == conversation.provider_id && provider.enabled)
                .cloned()
        })
        .or_else(|| providers.iter().find(|provider| provider.enabled).cloned());

    let Some(provider) = provider else {
        return tr(locale, "message.configureModelFirst").to_owned();
    };

    let conversation_model = conversation
        .as_ref()
        .map(|conversation| conversation.model.as_str())
        .unwrap_or_default();
    let image_model = image_model_for_provider(&provider, conversation_model);
    let model_label = if image_model.is_empty() {
        tr(locale, "message.imageModelRequired").to_owned()
    } else {
        image_model
    };

    format!(
        "{} / {}",
        provider_display_name(locale, &provider),
        model_label
    )
}

pub(crate) fn image_composer_hint(
    locale: &str,
    state: &LinuxAppState,
    task_mode: ImageTaskMode,
    source: Option<&ImageUpload>,
    mask: Option<&ImageUpload>,
) -> Option<String> {
    let conversation = match state.active_conversation() {
        Some(conversation) => conversation,
        None => return Some(tr(locale, "message.configureModelFirst").to_owned()),
    };
    let provider = state
        .provider(&conversation.provider_id)
        .filter(|provider| provider.enabled)
        .or_else(|| {
            state
                .providers()
                .into_iter()
                .find(|provider| provider.enabled)
        });
    let provider = match provider {
        Some(provider) => provider,
        None => return Some(tr(locale, "message.configureModelFirst").to_owned()),
    };

    if matches!(provider.kind, ProviderKind::Anthropic) {
        return Some(tr(locale, "message.imageProviderRequired").to_owned());
    }

    if provider_key_missing(state, &provider) {
        return Some(tr(locale, "error.providerKeyRequired").to_owned());
    }

    let image_model = if matches!(task_mode, ImageTaskMode::Generate) {
        image_model_for_provider(&provider, &conversation.model)
    } else {
        image_editing_model_for_provider(&provider, &conversation.model)
    };

    if image_model.trim().is_empty() {
        return Some(tr(locale, "message.imageModelRequired").to_owned());
    }

    if !matches!(task_mode, ImageTaskMode::Generate) && source.is_none() {
        return Some(tr(locale, "message.sourceImageRequired").to_owned());
    }

    if matches!(task_mode, ImageTaskMode::Inpaint) && mask.is_none() {
        return Some(tr(locale, "message.maskImageRequired").to_owned());
    }

    None
}

pub(crate) fn parse_model_list(value: &str) -> Vec<String> {
    value
        .split(|character: char| character.is_whitespace() || character == ',' || character == ';')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .fold(Vec::new(), |mut models, model| {
            if !models.iter().any(|existing| existing == model) {
                models.push(model.to_owned());
            }
            models
        })
}

pub(crate) fn ensure_provider_model_present(provider: &mut ProviderConfig) {
    for model in [
        provider.model.trim().to_owned(),
        provider
            .image_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        provider
            .audio_speech_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        provider
            .audio_transcription_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        provider
            .embedding_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        provider
            .moderation_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        provider
            .realtime_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned(),
    ] {
        if !model.is_empty() && !provider.models.iter().any(|existing| existing == &model) {
            provider.models.push(model);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(model: &str, image_model: Option<&str>, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: "provider".to_owned(),
            name: "Provider".to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "https://relay.example.com/v1".to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: model.to_owned(),
            image_model: image_model.map(str::to_owned),
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: models.iter().map(|model| (*model).to_owned()).collect(),
            capabilities: vec!["chat".to_owned(), "model-list".to_owned()],
            enabled: true,
            needs_api_key: true,
            custom: Some(true),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn selectable_models_treat_fetched_lists_as_authoritative() {
        let provider = provider(
            "gpt-4.1-mini",
            Some("dall-e-3"),
            &["gpt-5.5", "gpt-image-2"],
        );

        assert_eq!(
            selectable_models_for_provider(&provider),
            vec!["gpt-5.5", "gpt-image-2"]
        );
        assert_eq!(
            models_for_provider_capability(&provider, ProviderModelCapability::ImageEditing),
            vec!["gpt-image-2"]
        );
        assert_eq!(chat_models_for_provider(&provider), vec!["gpt-5.5"]);
        assert_eq!(image_model_for_provider(&provider, ""), "gpt-image-2");
        assert_eq!(default_chat_model_for_provider(&provider), "gpt-5.5");
    }

    #[test]
    fn preferred_chat_model_prefers_advanced_models_over_compact_variants() {
        let models = vec![
            "gpt-5.5-openai-compact".to_owned(),
            "gpt-5.2".to_owned(),
            "gpt-5.5".to_owned(),
            "gpt-5.5-auto-review".to_owned(),
        ];

        assert_eq!(preferred_chat_model(&models), "gpt-5.5");
        assert!(chat_model_preference_score("gpt-5.5") > chat_model_preference_score("gpt-5.2"));
        assert!(
            chat_model_preference_score("gpt-5.5")
                > chat_model_preference_score("gpt-5.5-openai-compact")
        );
    }

    #[test]
    fn preferred_chat_model_treats_hyphenated_gpt_versions_as_newer_revisions() {
        let models = vec![
            "auto".to_owned(),
            "gpt-5".to_owned(),
            "gpt-5-1".to_owned(),
            "gpt-5-2".to_owned(),
            "gpt-5-3".to_owned(),
            "gpt-5-3-mini".to_owned(),
            "gpt-5-5".to_owned(),
            "gpt-5-mini".to_owned(),
            "gpt-5.3-codex-spark".to_owned(),
            "gpt-image-2".to_owned(),
        ];

        assert_eq!(preferred_chat_model(&models), "gpt-5-5");
        assert!(chat_model_preference_score("gpt-5-5") > chat_model_preference_score("gpt-5-3"));
        assert!(chat_model_preference_score("gpt-5-5") > chat_model_preference_score("gpt-5"));
    }

    #[test]
    fn preferred_chat_model_prefers_high_capability_variants_without_treating_dates_as_revisions() {
        let models = vec![
            "gpt-5.5-mini".to_owned(),
            "gpt-5.5".to_owned(),
            "gpt-5.5-reasoning".to_owned(),
            "gpt-5.5-pro".to_owned(),
        ];

        assert_eq!(preferred_chat_model(&models), "gpt-5.5-pro");
        assert!(
            chat_model_preference_score("gpt-5.5-pro")
                > chat_model_preference_score("gpt-5.5-reasoning")
        );
        assert!(
            chat_model_preference_score("gpt-5.5-reasoning")
                > chat_model_preference_score("gpt-5.5")
        );
        assert!(
            chat_model_preference_score("gpt-4.2")
                > chat_model_preference_score("gpt-4.1-2025-04-14")
        );
    }

    #[test]
    fn preferred_chat_model_prefers_frontier_relay_variants_when_numeric_revisions_tie() {
        let models = vec![
            "gpt-5.6-luna".to_owned(),
            "gpt-5.6-terra".to_owned(),
            "gpt-5.6-sol".to_owned(),
        ];

        assert_eq!(preferred_chat_model(&models), "gpt-5.6-sol");
        assert!(
            chat_model_preference_score("gpt-5.6-sol")
                > chat_model_preference_score("gpt-5.6-terra")
        );
        assert!(
            chat_model_preference_score("gpt-5.6-terra")
                > chat_model_preference_score("gpt-5.6-luna")
        );
    }

    #[test]
    fn apply_fetched_provider_models_replaces_stale_catalog_and_infers_capabilities() {
        let mut provider = provider(
            "gpt-4.1-mini",
            Some("dall-e-3"),
            &["legacy-model", "gpt-4.1-mini"],
        );

        apply_fetched_provider_models(
            &mut provider,
            vec![
                "gpt-5.5-openai-compact".to_owned(),
                "gpt-5.5".to_owned(),
                "gpt-image-2".to_owned(),
                "text-embedding-3-large".to_owned(),
                "gpt-4o-audio-preview".to_owned(),
                "gpt-realtime".to_owned(),
                "omni-moderation-latest".to_owned(),
            ],
        );

        assert_eq!(
            provider.models,
            vec![
                "gpt-5.5-openai-compact",
                "gpt-5.5",
                "gpt-image-2",
                "text-embedding-3-large",
                "gpt-4o-audio-preview",
                "gpt-realtime",
                "omni-moderation-latest",
            ],
        );
        assert_eq!(provider.model, "gpt-5.5");
        assert_eq!(provider.image_model.as_deref(), Some("gpt-image-2"));
        assert_eq!(
            provider.capabilities,
            vec![
                "chat",
                "model-list",
                "image-generation",
                "image-editing",
                "embeddings",
                "audio",
                "realtime",
                "moderation",
            ],
        );
    }

    #[test]
    fn apply_fetched_provider_models_refreshes_advanced_capability_defaults() {
        let mut provider = provider(
            "gpt-5.4-mini",
            Some("gpt-image-1"),
            &[
                "gpt-5.4-mini",
                "gpt-image-1",
                "tts-1",
                "gpt-4o-transcribe",
                "whisper-1",
                "text-embedding-3-small",
                "moderation-latest",
                "gpt-realtime",
            ],
        );
        provider.audio_speech_model = Some("tts-1".to_owned());
        provider.audio_transcription_model = Some("whisper-1".to_owned());
        provider.embedding_model = Some("text-embedding-3-small".to_owned());
        provider.moderation_model = Some("moderation-latest".to_owned());
        provider.realtime_model = Some("gpt-realtime".to_owned());

        apply_fetched_provider_models(
            &mut provider,
            vec![
                "gpt-5.5".to_owned(),
                "gpt-image-2".to_owned(),
                "gpt-4o-mini-tts".to_owned(),
                "gpt-4o-transcribe".to_owned(),
                "whisper-1".to_owned(),
                "text-embedding-3-large".to_owned(),
                "omni-moderation-latest".to_owned(),
                "gpt-realtime-2".to_owned(),
            ],
        );

        assert_eq!(provider.model, "gpt-5.5");
        assert_eq!(provider.image_model.as_deref(), Some("gpt-image-2"));
        assert_eq!(
            provider.audio_speech_model.as_deref(),
            Some("gpt-4o-mini-tts")
        );
        assert_eq!(
            provider.audio_transcription_model.as_deref(),
            Some("whisper-1")
        );
        assert_eq!(
            provider.embedding_model.as_deref(),
            Some("text-embedding-3-large")
        );
        assert_eq!(
            provider.moderation_model.as_deref(),
            Some("omni-moderation-latest")
        );
        assert_eq!(provider.realtime_model.as_deref(), Some("gpt-realtime-2"));
    }

    #[test]
    fn apply_configured_provider_models_repairs_removed_capability_defaults() {
        let mut provider = provider(
            "gpt-5.4-mini",
            Some("gpt-image-1"),
            &[
                "gpt-5.4-mini",
                "gpt-image-1",
                "tts-1",
                "whisper-1",
                "text-embedding-3-small",
                "moderation-latest",
                "gpt-realtime",
            ],
        );
        provider.audio_speech_model = Some("tts-1".to_owned());
        provider.audio_transcription_model = Some("whisper-1".to_owned());
        provider.embedding_model = Some("text-embedding-3-small".to_owned());
        provider.moderation_model = Some("moderation-latest".to_owned());
        provider.realtime_model = Some("gpt-realtime".to_owned());

        apply_configured_provider_models(
            &mut provider,
            vec![
                "gpt-5.5".to_owned(),
                "gpt-image-2".to_owned(),
                "gpt-4o-mini-tts".to_owned(),
                "gpt-4o-transcribe".to_owned(),
                "text-embedding-3-large".to_owned(),
                "omni-moderation-latest".to_owned(),
                "gpt-realtime-2".to_owned(),
            ],
        );

        assert_eq!(provider.model, "gpt-5.5");
        assert_eq!(provider.image_model.as_deref(), Some("gpt-image-2"));
        assert_eq!(
            provider.audio_speech_model.as_deref(),
            Some("gpt-4o-mini-tts")
        );
        assert_eq!(
            provider.audio_transcription_model.as_deref(),
            Some("gpt-4o-transcribe")
        );
        assert_eq!(
            provider.embedding_model.as_deref(),
            Some("text-embedding-3-large")
        );
        assert_eq!(
            provider.moderation_model.as_deref(),
            Some("omni-moderation-latest")
        );
        assert_eq!(provider.realtime_model.as_deref(), Some("gpt-realtime-2"));
    }

    #[test]
    fn audio_model_resolvers_reject_stale_configured_models() {
        let mut provider = provider("gpt-5.5", None, &["gpt-5.5", "tts-1", "whisper-1"]);
        provider.audio_speech_model = Some("removed-tts".to_owned());
        provider.audio_transcription_model = Some("removed-transcription".to_owned());

        assert_eq!(model_for_provider_audio_speech(&provider), "tts-1");
        assert_eq!(
            model_for_provider_audio_transcription(&provider),
            "whisper-1"
        );
    }

    #[test]
    fn preferred_capability_models_pick_strong_fetched_model_families() {
        let models = vec![
            "embedding-lite".to_owned(),
            "text-embedding-3-large".to_owned(),
            "tts-1".to_owned(),
            "gpt-4o-transcribe".to_owned(),
            "gpt-audio-1.5".to_owned(),
            "gpt-4o-realtime-preview".to_owned(),
            "gpt-realtime-2".to_owned(),
            "gpt-realtime".to_owned(),
            "moderation-latest".to_owned(),
            "omni-moderation-latest".to_owned(),
        ];

        assert!(is_likely_embedding_model("text-embedding-3-large"));
        assert!(is_likely_audio_model("gpt-4o-transcribe"));
        assert!(is_likely_audio_model("gpt-4o-audio-preview"));
        assert!(is_likely_chat_model("gpt-4o-audio-preview"));
        assert!(is_likely_audio_speech_model("tts-1"));
        assert!(!is_likely_audio_speech_model("gpt-4o-transcribe"));
        assert!(!is_likely_audio_speech_model("gpt-4o-audio-preview"));
        assert!(is_likely_audio_transcription_model("gpt-4o-transcribe"));
        assert!(!is_likely_audio_transcription_model("tts-1"));
        assert!(!is_likely_audio_transcription_model("gpt-4o-audio-preview"));
        assert!(is_likely_realtime_model("gpt-realtime"));
        assert!(is_likely_realtime_model("gpt-realtime-2"));
        assert!(is_likely_realtime_model("gpt-audio-1.5"));
        assert!(!is_likely_realtime_model("gpt-4o-audio-preview"));
        assert!(is_likely_moderation_model("omni-moderation-latest"));
        assert_eq!(preferred_embedding_model(&models), "text-embedding-3-large");
        assert_eq!(preferred_audio_model(&models), "gpt-4o-transcribe");
        assert_eq!(preferred_audio_speech_model(&models), "tts-1");
        assert_eq!(
            preferred_audio_transcription_model(&models),
            "gpt-4o-transcribe"
        );
        assert_eq!(
            preferred_audio_model(&["gpt-4o-audio-preview".to_owned()]),
            "gpt-4o-audio-preview"
        );
        assert_eq!(
            preferred_audio_speech_model(&["gpt-4o-audio-preview".to_owned()]),
            ""
        );
        assert_eq!(
            preferred_audio_transcription_model(&["gpt-4o-audio-preview".to_owned()]),
            ""
        );
        assert_eq!(preferred_realtime_model(&models), "gpt-realtime-2");
        assert_eq!(
            preferred_moderation_model(&models),
            "omni-moderation-latest"
        );
    }

    #[test]
    fn model_for_provider_capability_uses_capability_specific_model_families() {
        let provider = provider(
            "gpt-5.4-mini",
            Some("gpt-image-1"),
            &[
                "gpt-5.5",
                "gpt-5.4-mini",
                "gpt-image-2",
                "gpt-image-1",
                "embedding-lite",
                "text-embedding-3-large",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-4o-audio-preview",
                "gpt-audio-1.5",
                "gpt-4o-realtime-preview",
                "gpt-realtime-2",
                "gpt-realtime",
                "moderation-latest",
                "omni-moderation-latest",
            ],
        );

        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Chat),
            "gpt-5.4-mini"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::ImageGeneration),
            "gpt-image-1"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Embeddings),
            "text-embedding-3-large"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Audio),
            "gpt-4o-transcribe"
        );
        assert_eq!(model_for_provider_audio_speech(&provider), "tts-1");
        assert_eq!(
            model_for_provider_audio_transcription(&provider),
            "gpt-4o-transcribe"
        );
        assert_eq!(
            models_for_provider_capability(&provider, ProviderModelCapability::Audio),
            vec![
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-4o-audio-preview",
                "gpt-audio-1.5"
            ]
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Realtime),
            "gpt-realtime-2"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Moderation),
            "omni-moderation-latest"
        );
        assert_eq!(
            models_for_provider_capability(&provider, ProviderModelCapability::Embeddings),
            vec!["embedding-lite", "text-embedding-3-large"]
        );
    }

    #[test]
    fn explicit_capability_models_override_catalog_preferences() {
        let mut provider = provider(
            "gpt-5.5",
            Some("gpt-image-2"),
            &[
                "gpt-5.5",
                "gpt-image-2",
                "tts-1",
                "gpt-4o-mini-tts",
                "gpt-4o-transcribe",
                "text-embedding-3-small",
                "text-embedding-3-large",
                "moderation-latest",
                "omni-moderation-latest",
                "gpt-realtime",
                "gpt-realtime-2",
            ],
        );
        provider.audio_speech_model = Some("tts-1".to_owned());
        provider.audio_transcription_model = Some("gpt-4o-transcribe".to_owned());
        provider.embedding_model = Some("text-embedding-3-small".to_owned());
        provider.moderation_model = Some("moderation-latest".to_owned());
        provider.realtime_model = Some("gpt-realtime".to_owned());

        assert_eq!(model_for_provider_audio_speech(&provider), "tts-1");
        assert_eq!(
            model_for_provider_audio_transcription(&provider),
            "gpt-4o-transcribe"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Embeddings),
            "text-embedding-3-small"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Moderation),
            "moderation-latest"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::Realtime),
            "gpt-realtime"
        );
    }

    #[test]
    fn model_capability_keys_describe_single_model_families() {
        assert_eq!(model_capability_keys("gpt-5.5"), vec!["capability.chat"]);
        assert_eq!(
            model_capability_keys("gpt-image-2"),
            vec!["capability.image-generation", "capability.image-editing"]
        );
        assert_eq!(
            model_capability_keys("gpt-4o-transcribe"),
            vec!["capability.audio-transcription"]
        );
        assert_eq!(
            model_capability_keys("gpt-4o-audio-preview"),
            vec!["capability.chat", "capability.audio"]
        );
        assert_eq!(
            model_capability_keys("text-embedding-3-large"),
            vec!["capability.embeddings"]
        );
        assert_eq!(
            model_capability_keys("gpt-realtime"),
            vec!["capability.realtime"]
        );
        assert_eq!(
            model_capability_keys("gpt-audio-1.5"),
            vec!["capability.audio", "capability.realtime"]
        );
        assert_eq!(
            model_capability_keys("omni-moderation-latest"),
            vec!["capability.moderation"]
        );
    }

    #[test]
    fn dall_e_3_is_generation_only_and_resolves_a_compatible_editing_model() {
        let provider = provider(
            "gpt-5.5",
            Some("dall-e-3"),
            &["gpt-5.5", "dall-e-3", "gpt-image-1"],
        );

        assert!(is_likely_image_model("dall-e-3"));
        assert!(!is_likely_image_editing_model("dall-e-3"));
        assert!(is_likely_image_editing_model("gpt-image-1"));
        assert_eq!(
            image_editing_models_for_provider(&provider),
            vec!["gpt-image-1"]
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::ImageGeneration),
            "dall-e-3"
        );
        assert_eq!(
            model_for_provider_capability(&provider, ProviderModelCapability::ImageEditing),
            "gpt-image-1"
        );
        assert_eq!(
            model_capability_keys("dall-e-3"),
            vec!["capability.image-generation"]
        );
    }

    #[test]
    fn apply_fetched_provider_models_upgrades_automatic_defaults_to_best_models() {
        let mut provider = provider(
            "gpt-5.4-mini",
            Some("gpt-image-1"),
            &["gpt-5.4-mini", "gpt-image-1"],
        );

        apply_fetched_provider_models(
            &mut provider,
            vec![
                "gpt-5.4-mini".to_owned(),
                "gpt-5.5".to_owned(),
                "gpt-image-1".to_owned(),
                "gpt-image-2".to_owned(),
            ],
        );

        assert_eq!(provider.model, "gpt-5.5");
        assert_eq!(provider.image_model.as_deref(), Some("gpt-image-2"));
    }

    #[test]
    fn apply_fetched_provider_models_preserves_explicit_lightweight_selections() {
        let mut provider = provider(
            "gpt-5.4-mini",
            Some("gpt-image-1"),
            &["gpt-5.5", "gpt-5.4-mini", "gpt-image-2", "gpt-image-1"],
        );

        apply_fetched_provider_models(
            &mut provider,
            vec![
                "gpt-5.6".to_owned(),
                "gpt-5.4-mini".to_owned(),
                "gpt-image-2".to_owned(),
                "gpt-image-1".to_owned(),
            ],
        );

        assert_eq!(provider.model, "gpt-5.4-mini");
        assert_eq!(provider.image_model.as_deref(), Some("gpt-image-1"));
    }
}
