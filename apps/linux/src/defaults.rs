use crate::{
    models::{AppSnapshot, Preferences, ProviderConfig, ProviderKind, SkillSettings, SyncConfig},
    now_millis,
    providers::{
        is_likely_audio_speech_model, is_likely_audio_transcription_model,
        is_likely_embedding_model, is_likely_image_model, is_likely_moderation_model,
        is_likely_realtime_model,
    },
};

pub(crate) const CUSTOM_OPENAI_RELAY_CAPABILITIES: &[&str] = &[
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list",
];

const OFFICIAL_OPENAI_CHAT_MODEL: &str = "gpt-5.5";
const OFFICIAL_OPENAI_IMAGE_MODEL: &str = "gpt-image-2";
const OFFICIAL_OPENAI_AUDIO_SPEECH_MODEL: &str = "gpt-4o-mini-tts";
const OFFICIAL_OPENAI_AUDIO_TRANSCRIPTION_MODEL: &str = "gpt-4o-transcribe";
const OFFICIAL_OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-large";
const OFFICIAL_OPENAI_MODERATION_MODEL: &str = "omni-moderation-latest";
const OFFICIAL_OPENAI_REALTIME_MODEL: &str = "gpt-realtime-2";

const OFFICIAL_OPENAI_CAPABILITIES: &[&str] = &[
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list",
];

pub(crate) fn default_snapshot() -> AppSnapshot {
    let now = now_millis();
    AppSnapshot {
        version: 1,
        providers: vec![
            provider(
                "openai",
                "OpenAI",
                ProviderKind::OpenaiResponses,
                "https://api.openai.com/v1",
                OFFICIAL_OPENAI_CHAT_MODEL,
                Some(OFFICIAL_OPENAI_IMAGE_MODEL),
                OFFICIAL_OPENAI_CAPABILITIES,
                true,
                false,
                now,
            ),
            provider(
                "custom-openai",
                "Custom relay (OpenAI compatible)",
                ProviderKind::OpenaiCompatible,
                "https://relay.example.com/v1",
                "",
                None,
                CUSTOM_OPENAI_RELAY_CAPABILITIES,
                true,
                true,
                now,
            ),
            provider(
                "anthropic",
                "Anthropic",
                ProviderKind::Anthropic,
                "https://api.anthropic.com/v1",
                "",
                None,
                &["chat", "vision", "tools", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "gemini",
                "Google Gemini",
                ProviderKind::OpenaiCompatible,
                "https://generativelanguage.googleapis.com/v1beta/openai",
                "gemini-2.5-flash",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "deepseek",
                "DeepSeek",
                ProviderKind::OpenaiCompatible,
                "https://api.deepseek.com",
                "deepseek-chat",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "xai",
                "xAI",
                ProviderKind::OpenaiResponses,
                "https://api.x.ai/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "openrouter",
                "OpenRouter",
                ProviderKind::OpenaiCompatible,
                "https://openrouter.ai/api/v1",
                "openai/gpt-4.1-mini",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "mistral",
                "Mistral AI",
                ProviderKind::OpenaiCompatible,
                "https://api.mistral.ai/v1",
                "mistral-small-latest",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "groq",
                "Groq",
                ProviderKind::OpenaiCompatible,
                "https://api.groq.com/openai/v1",
                "llama-3.3-70b-versatile",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "together",
                "Together AI",
                ProviderKind::OpenaiCompatible,
                "https://api.together.xyz/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "fireworks",
                "Fireworks AI",
                ProviderKind::OpenaiCompatible,
                "https://api.fireworks.ai/inference/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "cerebras",
                "Cerebras",
                ProviderKind::OpenaiCompatible,
                "https://api.cerebras.ai/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "nvidia",
                "NVIDIA NIM",
                ProviderKind::OpenaiCompatible,
                "https://integrate.api.nvidia.com/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "deepinfra",
                "DeepInfra",
                ProviderKind::OpenaiCompatible,
                "https://api.deepinfra.com/v1/openai",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "novita",
                "Novita AI",
                ProviderKind::OpenaiCompatible,
                "https://api.novita.ai/v3/openai",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "siliconflow",
                "SiliconFlow",
                ProviderKind::OpenaiCompatible,
                "https://api.siliconflow.cn/v1",
                "Qwen/Qwen2.5-7B-Instruct",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "modelscope",
                "ModelScope 魔搭",
                ProviderKind::OpenaiCompatible,
                "https://api-inference.modelscope.cn/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "dashscope",
                "阿里云百炼",
                ProviderKind::OpenaiCompatible,
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "moonshot",
                "Moonshot",
                ProviderKind::OpenaiCompatible,
                "https://api.moonshot.cn/v1",
                "moonshot-v1-8k",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "zhipu",
                "智谱 GLM",
                ProviderKind::OpenaiCompatible,
                "https://open.bigmodel.cn/api/paas/v4",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "qianfan",
                "百度千帆",
                ProviderKind::OpenaiCompatible,
                "https://qianfan.baidubce.com/v2",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "hunyuan",
                "腾讯混元",
                ProviderKind::OpenaiCompatible,
                "https://api.hunyuan.cloud.tencent.com/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "minimax",
                "MiniMax",
                ProviderKind::OpenaiCompatible,
                "https://api.minimax.io/v1",
                "MiniMax-Text-01",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "azure-openai",
                "Azure OpenAI",
                ProviderKind::OpenaiCompatible,
                "https://your-resource.openai.azure.com/openai/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                true,
                now,
            ),
            provider(
                "volcengine",
                "火山方舟",
                ProviderKind::OpenaiCompatible,
                "https://ark.cn-beijing.volces.com/api/v3",
                "",
                None,
                &["chat", "model-list"],
                true,
                false,
                now,
            ),
            provider(
                "cloudflare-ai-gateway-openai",
                "Cloudflare AI Gateway",
                ProviderKind::OpenaiCompatible,
                "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai",
                "",
                None,
                &["chat", "model-list"],
                true,
                true,
                now,
            ),
            provider(
                "custom-responses-relay",
                "Custom relay (OpenAI Responses)",
                ProviderKind::OpenaiResponses,
                "https://relay.example.com/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                true,
                now,
            ),
            provider(
                "custom-anthropic-relay",
                "Custom relay (Anthropic / Claude)",
                ProviderKind::Anthropic,
                "https://relay.example.com/v1",
                "",
                None,
                &["chat", "model-list"],
                true,
                true,
                now,
            ),
        ],
        conversations: vec![],
        skills: vec![],
        skill_settings: SkillSettings {
            auto_match: true,
            context_budget: 2400,
            max_auto_skills: 3,
        },
        sync: SyncConfig {
            mode: "local".to_owned(),
            auto_sync: false,
            encryption_enabled: true,
            gist_id: None,
            gist_file: Some("zerochat-sync.json".to_owned()),
            worker_endpoint: None,
            last_sync_at: None,
            last_sync_status: None,
        },
        preferences: Preferences {
            first_run_done: true,
            theme: "system".to_owned(),
            language: "system".to_owned(),
            compact_mode: false,
            chat_context_message_limit: 24,
            active_conversation_id: None,
            dismissed_danger_warnings: None,
            dismissed_feature_hints: None,
        },
        updated_at: now,
    }
}

pub(crate) fn normalize_official_provider_contracts(
    mut snapshot: AppSnapshot,
) -> (AppSnapshot, bool) {
    let now = now_millis();
    let normalized_snapshot_updated_at = snapshot.updated_at.max(now);
    let capabilities = OFFICIAL_OPENAI_CAPABILITIES
        .iter()
        .map(|capability| (*capability).to_owned())
        .collect::<Vec<_>>();
    let mut changed = false;

    for provider in &mut snapshot.providers {
        if !is_official_openai_provider(provider) {
            continue;
        }

        let image_model = provider
            .image_model
            .as_deref()
            .map(str::trim)
            .filter(|model| !model.is_empty() && is_likely_image_model(model))
            .map(str::to_owned)
            .unwrap_or_else(|| OFFICIAL_OPENAI_IMAGE_MODEL.to_owned());
        let audio_speech_model = valid_capability_model(
            provider.audio_speech_model.as_deref(),
            OFFICIAL_OPENAI_AUDIO_SPEECH_MODEL,
            is_likely_audio_speech_model,
        );
        let audio_transcription_model = valid_capability_model(
            provider.audio_transcription_model.as_deref(),
            OFFICIAL_OPENAI_AUDIO_TRANSCRIPTION_MODEL,
            is_likely_audio_transcription_model,
        );
        let embedding_model = valid_capability_model(
            provider.embedding_model.as_deref(),
            OFFICIAL_OPENAI_EMBEDDING_MODEL,
            is_likely_embedding_model,
        );
        let moderation_model = valid_capability_model(
            provider.moderation_model.as_deref(),
            OFFICIAL_OPENAI_MODERATION_MODEL,
            is_likely_moderation_model,
        );
        let realtime_model = valid_capability_model(
            provider.realtime_model.as_deref(),
            OFFICIAL_OPENAI_REALTIME_MODEL,
            is_likely_realtime_model,
        );
        let model = match provider.model.trim() {
            "" | "gpt-5.4-mini" => OFFICIAL_OPENAI_CHAT_MODEL.to_owned(),
            _ => provider.model.clone(),
        };
        let mut model_values = provider.models.clone();
        model_values.push(OFFICIAL_OPENAI_CHAT_MODEL.to_owned());
        model_values.push(model.clone());
        model_values.push(provider.model.clone());
        model_values.push(provider.image_model.clone().unwrap_or_default());
        model_values.push(audio_speech_model.clone());
        model_values.push(audio_transcription_model.clone());
        model_values.push(embedding_model.clone());
        model_values.push(moderation_model.clone());
        model_values.push(realtime_model.clone());
        model_values.push(OFFICIAL_OPENAI_IMAGE_MODEL.to_owned());
        model_values.push(OFFICIAL_OPENAI_AUDIO_SPEECH_MODEL.to_owned());
        model_values.push(OFFICIAL_OPENAI_AUDIO_TRANSCRIPTION_MODEL.to_owned());
        model_values.push(OFFICIAL_OPENAI_EMBEDDING_MODEL.to_owned());
        model_values.push(OFFICIAL_OPENAI_MODERATION_MODEL.to_owned());
        model_values.push(OFFICIAL_OPENAI_REALTIME_MODEL.to_owned());
        let models = unique_model_values(model_values);

        let provider_changed = !matches!(provider.kind, ProviderKind::OpenaiResponses)
            || provider.model != model
            || !provider.needs_api_key
            || provider.image_model.as_deref() != Some(image_model.as_str())
            || provider.audio_speech_model.as_deref() != Some(audio_speech_model.as_str())
            || provider.audio_transcription_model.as_deref()
                != Some(audio_transcription_model.as_str())
            || provider.embedding_model.as_deref() != Some(embedding_model.as_str())
            || provider.moderation_model.as_deref() != Some(moderation_model.as_str())
            || provider.realtime_model.as_deref() != Some(realtime_model.as_str())
            || provider.models != models
            || provider.capabilities != capabilities;

        if provider_changed {
            provider.kind = ProviderKind::OpenaiResponses;
            provider.model = model;
            provider.image_model = Some(image_model);
            provider.audio_speech_model = Some(audio_speech_model);
            provider.audio_transcription_model = Some(audio_transcription_model);
            provider.embedding_model = Some(embedding_model);
            provider.moderation_model = Some(moderation_model);
            provider.realtime_model = Some(realtime_model);
            provider.models = models;
            provider.capabilities = capabilities.clone();
            provider.needs_api_key = true;
            provider.updated_at = provider.updated_at.max(now);
            changed = true;
        }
    }

    if changed {
        snapshot.updated_at = normalized_snapshot_updated_at;
    }

    (snapshot, changed)
}

fn valid_capability_model(
    value: Option<&str>,
    fallback: &str,
    predicate: fn(&str) -> bool,
) -> String {
    value
        .map(str::trim)
        .filter(|model| !model.is_empty() && predicate(model))
        .unwrap_or(fallback)
        .to_owned()
}

fn is_official_openai_provider(provider: &ProviderConfig) -> bool {
    !provider.custom.unwrap_or(false)
        && provider.name == "OpenAI"
        && provider.base_url == "https://api.openai.com/v1"
}

fn unique_model_values(values: Vec<String>) -> Vec<String> {
    let mut models = Vec::new();

    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !models.iter().any(|model| model == trimmed) {
            models.push(trimmed.to_owned());
        }
    }

    models
}

fn provider(
    id: &str,
    name: &str,
    kind: ProviderKind,
    base_url: &str,
    model: &str,
    image_model: Option<&str>,
    capabilities: &[&str],
    needs_api_key: bool,
    custom: bool,
    now: i64,
) -> ProviderConfig {
    let models = [model, image_model.unwrap_or_default()]
        .into_iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_owned())
            }
        })
        .collect::<Vec<_>>();

    ProviderConfig {
        id: id.to_owned(),
        name: name.to_owned(),
        kind,
        base_url: base_url.to_owned(),
        proxy_url: None,
        client_request_mode: false,
        model: model.to_owned(),
        image_model: image_model.map(str::to_owned),
        audio_speech_model: (id == "openai").then(|| OFFICIAL_OPENAI_AUDIO_SPEECH_MODEL.to_owned()),
        audio_transcription_model: (id == "openai")
            .then(|| OFFICIAL_OPENAI_AUDIO_TRANSCRIPTION_MODEL.to_owned()),
        embedding_model: (id == "openai").then(|| OFFICIAL_OPENAI_EMBEDDING_MODEL.to_owned()),
        moderation_model: (id == "openai").then(|| OFFICIAL_OPENAI_MODERATION_MODEL.to_owned()),
        realtime_model: (id == "openai").then(|| OFFICIAL_OPENAI_REALTIME_MODEL.to_owned()),
        models,
        model_metadata: std::collections::BTreeMap::new(),
        capabilities: capabilities
            .iter()
            .map(|capability| capability.to_string())
            .collect(),
        enabled: id == "openai",
        needs_api_key,
        custom: Some(custom),
        created_at: now,
        updated_at: now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_official_provider_contracts_does_not_lower_snapshot_updated_at() {
        let mut snapshot = default_snapshot();
        let future_updated_at = now_millis() + 86_400_000;
        snapshot.updated_at = future_updated_at;
        let provider = snapshot
            .providers
            .iter_mut()
            .find(|provider| provider.id == "openai")
            .expect("default OpenAI provider");
        provider.kind = ProviderKind::OpenaiCompatible;
        provider.needs_api_key = false;
        provider.image_model = None;
        provider.models = vec![provider.model.clone()];
        provider.capabilities = vec!["chat".to_owned()];

        let (normalized, changed) = normalize_official_provider_contracts(snapshot);
        let openai = normalized
            .providers
            .iter()
            .find(|provider| provider.id == "openai")
            .expect("normalized OpenAI provider");

        assert!(changed);
        assert_eq!(normalized.updated_at, future_updated_at);
        assert!(matches!(openai.kind, ProviderKind::OpenaiResponses));
        assert_eq!(openai.image_model.as_deref(), Some("gpt-image-2"));
        assert!(openai.updated_at <= normalized.updated_at);
    }

    #[test]
    fn normalize_official_provider_contracts_preserves_valid_advanced_models() {
        let mut snapshot = default_snapshot();
        let provider = snapshot
            .providers
            .iter_mut()
            .find(|provider| provider.id == "openai")
            .expect("default OpenAI provider");
        provider.audio_speech_model = Some("tts-1-hd".to_owned());
        provider.audio_transcription_model = Some("whisper-1".to_owned());
        provider.embedding_model = Some("text-embedding-3-small".to_owned());
        provider.moderation_model = Some("omni-moderation-custom".to_owned());
        provider.realtime_model = Some("gpt-realtime-custom".to_owned());

        let (normalized, changed) = normalize_official_provider_contracts(snapshot);
        let openai = normalized
            .providers
            .iter()
            .find(|provider| provider.id == "openai")
            .expect("normalized OpenAI provider");

        assert!(changed);
        assert_eq!(openai.audio_speech_model.as_deref(), Some("tts-1-hd"));
        assert_eq!(
            openai.audio_transcription_model.as_deref(),
            Some("whisper-1")
        );
        assert_eq!(
            openai.embedding_model.as_deref(),
            Some("text-embedding-3-small")
        );
        assert_eq!(
            openai.moderation_model.as_deref(),
            Some("omni-moderation-custom")
        );
        assert_eq!(
            openai.realtime_model.as_deref(),
            Some("gpt-realtime-custom")
        );
        for model in [
            "tts-1-hd",
            "whisper-1",
            "text-embedding-3-small",
            "omni-moderation-custom",
            "gpt-realtime-custom",
        ] {
            assert!(openai.models.iter().any(|candidate| candidate == model));
        }
    }
}
