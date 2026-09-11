use anyhow::{Result, anyhow};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

use crate::models::{
    AppSnapshot, ChatMessage, Conversation, MessageAttachment, OfflineReplayClaim, Preferences,
    ProviderConfig, QueuedTextRequest, SkillSettings, SyncConfig, SyncVault, UserSkill,
    UserSkillChunk,
};

pub(crate) fn decode_validated_sync_vault(bytes: &[u8]) -> Result<SyncVault> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid_vault_format())?;
    if !is_canonical_sync_vault_json(&value) {
        return Err(invalid_vault_format());
    }

    let vault: SyncVault = serde_json::from_value(value).map_err(|_| invalid_vault_format())?;
    if !is_canonical_app_snapshot(&vault.data) {
        return Err(invalid_vault_format());
    }

    Ok(vault)
}

fn invalid_vault_format() -> anyhow::Error {
    anyhow!("Remote snapshot payload has invalid format.")
}

fn is_canonical_sync_vault_json(value: &Value) -> bool {
    if contains_null(value) {
        return false;
    }

    let Some(vault) = object_with_shape(value, VAULT_KEYS, VAULT_KEYS) else {
        return false;
    };
    let Some(data) = vault
        .get("data")
        .and_then(|value| object_with_shape(value, APP_DATA_KEYS, APP_DATA_KEYS))
    else {
        return false;
    };
    let Some(secrets) = vault
        .get("secrets")
        .and_then(|value| object_with_shape(value, SECRETS_KEYS, SECRETS_KEYS))
    else {
        return false;
    };
    let Some(provider_keys) = secrets.get("providerKeys").and_then(Value::as_object) else {
        return false;
    };
    if !provider_keys.values().all(Value::is_string) {
        return false;
    }

    if array_objects(data.get("providers"), PROVIDER_KEYS, PROVIDER_REQUIRED_KEYS).is_none() {
        return false;
    }

    let Some(conversations) = array_objects(
        data.get("conversations"),
        CONVERSATION_KEYS,
        CONVERSATION_KEYS,
    ) else {
        return false;
    };
    for conversation in conversations {
        let Some(messages) = array_objects(
            conversation.get("messages"),
            MESSAGE_KEYS,
            MESSAGE_REQUIRED_KEYS,
        ) else {
            return false;
        };
        for message in messages {
            if let Some(attachments) = message.get("attachments")
                && array_objects(Some(attachments), ATTACHMENT_KEYS, ATTACHMENT_REQUIRED_KEYS)
                    .is_none()
            {
                return false;
            }
            if let Some(request) = message.get("queuedTextRequest")
                && object_with_shape(
                    request,
                    QUEUED_TEXT_REQUEST_KEYS,
                    QUEUED_TEXT_REQUEST_REQUIRED_KEYS,
                )
                .is_none()
            {
                return false;
            }
            if let Some(claim) = message.get("offlineReplayClaim")
                && object_with_shape(claim, OFFLINE_REPLAY_CLAIM_KEYS, OFFLINE_REPLAY_CLAIM_KEYS)
                    .is_none()
            {
                return false;
            }
        }
    }

    let Some(skills) = array_objects(data.get("skills"), SKILL_KEYS, SKILL_REQUIRED_KEYS) else {
        return false;
    };
    for skill in skills {
        if array_objects(
            skill.get("chunks"),
            SKILL_CHUNK_KEYS,
            SKILL_CHUNK_REQUIRED_KEYS,
        )
        .is_none()
        {
            return false;
        }
    }

    data.get("skillSettings")
        .and_then(|value| object_with_shape(value, SKILL_SETTINGS_KEYS, SKILL_SETTINGS_KEYS))
        .is_some()
        && data
            .get("sync")
            .and_then(|value| object_with_shape(value, SYNC_KEYS, SYNC_REQUIRED_KEYS))
            .is_some()
        && data
            .get("preferences")
            .and_then(|value| object_with_shape(value, PREFERENCES_KEYS, PREFERENCES_REQUIRED_KEYS))
            .is_some()
}

fn contains_null(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(values) => values.iter().any(contains_null),
        Value::Object(values) => values.values().any(contains_null),
        _ => false,
    }
}

fn object_with_shape<'a>(
    value: &'a Value,
    allowed_keys: &[&str],
    required_keys: &[&str],
) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    if object
        .keys()
        .any(|key| !allowed_keys.contains(&key.as_str()))
        || required_keys.iter().any(|key| !object.contains_key(*key))
    {
        return None;
    }
    Some(object)
}

fn array_objects<'a>(
    value: Option<&'a Value>,
    allowed_keys: &[&str],
    required_keys: &[&str],
) -> Option<Vec<&'a Map<String, Value>>> {
    value?
        .as_array()?
        .iter()
        .map(|item| object_with_shape(item, allowed_keys, required_keys))
        .collect()
}

fn is_canonical_app_snapshot(data: &AppSnapshot) -> bool {
    data.version == 1
        && data.updated_at >= 0
        && has_unique_snapshot_record_ids(data)
        && data.providers.iter().all(is_canonical_provider)
        && data.conversations.iter().all(is_canonical_conversation)
        && data.skills.iter().all(is_canonical_skill)
        && is_canonical_skill_settings(&data.skill_settings)
        && is_canonical_sync_config(&data.sync)
        && is_canonical_preferences(&data.preferences)
}

fn unique_ids<'a>(ids: impl IntoIterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    ids.into_iter().all(|id| seen.insert(id))
}

pub(crate) fn has_unique_snapshot_record_ids(data: &AppSnapshot) -> bool {
    unique_ids(data.providers.iter().map(|provider| provider.id.as_str()))
        && unique_ids(
            data.conversations
                .iter()
                .map(|conversation| conversation.id.as_str()),
        )
        && data.conversations.iter().all(|conversation| {
            unique_ids(
                conversation
                    .messages
                    .iter()
                    .map(|message| message.id.as_str()),
            ) && conversation.messages.iter().all(|message| {
                unique_ids(
                    message
                        .attachments
                        .iter()
                        .map(|attachment| attachment.id.as_str()),
                )
            })
        })
        && unique_ids(data.skills.iter().map(|skill| skill.id.as_str()))
        && data
            .skills
            .iter()
            .all(|skill| unique_ids(skill.chunks.iter().map(|chunk| chunk.id.as_str())))
}

fn is_canonical_provider(provider: &ProviderConfig) -> bool {
    !provider.id.is_empty()
        && !provider.name.is_empty()
        && !provider.base_url.is_empty()
        && provider.models.iter().all(|model| !model.is_empty())
        && provider.models.iter().collect::<BTreeSet<_>>().len() == provider.models.len()
        && provider
            .capabilities
            .iter()
            .all(|capability| PROVIDER_CAPABILITIES.contains(&capability.as_str()))
        && provider.capabilities.iter().collect::<BTreeSet<_>>().len()
            == provider.capabilities.len()
        && provider.created_at >= 0
        && provider.updated_at >= 0
}

const PROVIDER_CAPABILITIES: &[&str] = &[
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "video",
    "model-list",
];

fn is_canonical_conversation(conversation: &Conversation) -> bool {
    !conversation.id.is_empty()
        && !conversation.provider_id.is_empty()
        && conversation.created_at >= 0
        && conversation.updated_at >= 0
        && conversation.messages.iter().all(is_canonical_message)
}

fn is_canonical_message(message: &ChatMessage) -> bool {
    !message.id.is_empty()
        && message.created_at >= 0
        && matches!(
            message.status.as_deref().unwrap_or("done"),
            "queued" | "streaming" | "done" | "error"
        )
        && message.attachments.iter().all(is_canonical_attachment)
        && message
            .queued_text_request
            .as_ref()
            .map_or(true, is_canonical_queued_text_request)
        && message
            .offline_replay_claim
            .as_ref()
            .map_or(true, is_canonical_offline_replay_claim)
}

fn is_canonical_queued_text_request(request: &QueuedTextRequest) -> bool {
    !request.provider_id.is_empty()
        && !request.model.is_empty()
        && request
            .prompt_message_id
            .as_ref()
            .map_or(true, |prompt_message_id| !prompt_message_id.is_empty())
}

fn is_canonical_offline_replay_claim(claim: &OfflineReplayClaim) -> bool {
    !claim.claim_id.is_empty() && !claim.owner.is_empty()
}

fn is_canonical_attachment(attachment: &MessageAttachment) -> bool {
    !attachment.id.is_empty()
        && attachment.kind == "image"
        && matches!(
            attachment.purpose.as_deref(),
            None | Some("generated" | "source" | "mask")
        )
        && !attachment.mime_type.is_empty()
        && attachment.created_at >= 0
}

fn is_canonical_skill(skill: &UserSkill) -> bool {
    !skill.id.is_empty()
        && !skill.name.is_empty()
        && matches!(skill.content_type.as_str(), "markdown" | "text" | "json")
        && skill.source_size >= 0
        && !skill.content_hash.is_empty()
        && skill.keywords.iter().all(|keyword| !keyword.is_empty())
        && !skill.chunks.is_empty()
        && skill.chunks.iter().all(is_canonical_skill_chunk)
        && skill.created_at >= 0
        && skill.updated_at >= 0
}

fn is_canonical_skill_chunk(chunk: &UserSkillChunk) -> bool {
    !chunk.id.is_empty()
        && (!chunk.content.is_empty()
            || chunk
                .content_ref
                .as_deref()
                .is_some_and(|content_ref| !content_ref.is_empty()))
        && chunk.keywords.iter().all(|keyword| !keyword.is_empty())
        && chunk.token_estimate >= 1
}

fn is_canonical_skill_settings(settings: &SkillSettings) -> bool {
    (600..=8_000).contains(&settings.context_budget) && (1..=8).contains(&settings.max_auto_skills)
}

fn is_canonical_sync_config(sync: &SyncConfig) -> bool {
    matches!(sync.mode.as_str(), "local" | "gist" | "cloudflare")
        && sync.last_sync_at.is_none_or(|timestamp| timestamp >= 0)
}

fn is_canonical_preferences(preferences: &Preferences) -> bool {
    matches!(preferences.theme.as_str(), "system" | "light" | "dark")
        && LANGUAGES.contains(&preferences.language.as_str())
        && (4..=200).contains(&preferences.chat_context_message_limit)
}

const VAULT_KEYS: &[&str] = &["data", "secrets"];
const SECRETS_KEYS: &[&str] = &["providerKeys"];
const APP_DATA_KEYS: &[&str] = &[
    "version",
    "providers",
    "conversations",
    "skills",
    "skillSettings",
    "sync",
    "preferences",
    "updatedAt",
];
const PROVIDER_KEYS: &[&str] = &[
    "id",
    "name",
    "kind",
    "baseUrl",
    "proxyUrl",
    "clientRequestMode",
    "model",
    "imageModel",
    "audioSpeechModel",
    "audioTranscriptionModel",
    "embeddingModel",
    "moderationModel",
    "realtimeModel",
    "models",
    "capabilities",
    "enabled",
    "needsApiKey",
    "custom",
    "createdAt",
    "updatedAt",
];
const PROVIDER_REQUIRED_KEYS: &[&str] = &[
    "id",
    "name",
    "kind",
    "baseUrl",
    "model",
    "enabled",
    "needsApiKey",
    "createdAt",
    "updatedAt",
];
const CONVERSATION_KEYS: &[&str] = &[
    "id",
    "title",
    "providerId",
    "model",
    "messages",
    "createdAt",
    "updatedAt",
];
const MESSAGE_KEYS: &[&str] = &[
    "id",
    "role",
    "content",
    "createdAt",
    "status",
    "error",
    "attachments",
    "queuedTextRequest",
    "offlineReplayClaim",
];
const MESSAGE_REQUIRED_KEYS: &[&str] = &["id", "role", "content", "createdAt"];
const QUEUED_TEXT_REQUEST_KEYS: &[&str] = &["providerId", "model", "promptMessageId"];
const QUEUED_TEXT_REQUEST_REQUIRED_KEYS: &[&str] = &["providerId", "model"];
const OFFLINE_REPLAY_CLAIM_KEYS: &[&str] = &["claimId", "owner"];
const ATTACHMENT_KEYS: &[&str] = &[
    "id",
    "kind",
    "purpose",
    "mimeType",
    "dataUrl",
    "url",
    "alt",
    "model",
    "createdAt",
];
const ATTACHMENT_REQUIRED_KEYS: &[&str] = &["id", "kind", "mimeType", "createdAt"];
const SKILL_KEYS: &[&str] = &[
    "id",
    "name",
    "description",
    "fileName",
    "contentType",
    "sourceSize",
    "contentHash",
    "keywords",
    "chunks",
    "fixed",
    "enabled",
    "autoMatch",
    "createdAt",
    "updatedAt",
];
const SKILL_REQUIRED_KEYS: &[&str] = &[
    "id",
    "name",
    "description",
    "contentType",
    "sourceSize",
    "contentHash",
    "keywords",
    "chunks",
    "fixed",
    "enabled",
    "autoMatch",
    "createdAt",
    "updatedAt",
];
const SKILL_CHUNK_KEYS: &[&str] = &[
    "id",
    "heading",
    "content",
    "contentRef",
    "contentPreview",
    "keywords",
    "tokenEstimate",
];
const SKILL_CHUNK_REQUIRED_KEYS: &[&str] = &["id", "heading", "keywords", "tokenEstimate"];
const SKILL_SETTINGS_KEYS: &[&str] = &["autoMatch", "contextBudget", "maxAutoSkills"];
const SYNC_KEYS: &[&str] = &[
    "mode",
    "autoSync",
    "encryptionEnabled",
    "gistId",
    "gistFile",
    "workerEndpoint",
    "lastSyncAt",
    "lastSyncStatus",
];
const SYNC_REQUIRED_KEYS: &[&str] = &["mode", "autoSync", "encryptionEnabled"];
const PREFERENCES_KEYS: &[&str] = &[
    "firstRunDone",
    "theme",
    "language",
    "compactMode",
    "chatContextMessageLimit",
    "activeConversationId",
    "dismissedDangerWarnings",
    "dismissedFeatureHints",
];
const PREFERENCES_REQUIRED_KEYS: &[&str] = &["firstRunDone", "theme", "language", "compactMode"];
const LANGUAGES: &[&str] = &[
    "system", "zh-CN", "en-US", "es-ES", "hi-IN", "ar-SA", "pt-BR", "ru-RU", "ja-JP", "ko-KR",
    "fr-FR",
];

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{defaults::default_snapshot, models::ProviderSecrets};

    fn canonical_vault() -> SyncVault {
        SyncVault {
            data: default_snapshot(),
            secrets: ProviderSecrets::default(),
        }
    }

    fn queued_vault(prompt_message_id: Option<&str>) -> Value {
        let mut request = json!({
            "providerId": "openai",
            "model": "gpt-5.5"
        });
        if let Some(prompt_message_id) = prompt_message_id {
            request["promptMessageId"] = json!(prompt_message_id);
        }

        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation-queued",
            "title": "Queued",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message-queued",
                "role": "assistant",
                "content": "Queued offline",
                "createdAt": 1,
                "status": "queued",
                "queuedTextRequest": request,
                "offlineReplayClaim": {
                    "claimId": "claim-1",
                    "owner": "tab-1"
                }
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        value
    }

    #[test]
    fn canonical_vault_round_trip_preserves_advanced_provider_models_without_nulls() {
        let value = serde_json::to_value(canonical_vault()).unwrap();
        assert!(!contains_null(&value));

        let vault = decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).unwrap();
        let provider = &vault.data.providers[0];
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
    fn canonical_vault_round_trip_preserves_queued_text_request() {
        let value = queued_vault(None);

        let vault = decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(
            vault.data.conversations[0].messages[0].queued_text_request,
            Some(QueuedTextRequest {
                provider_id: "openai".to_owned(),
                model: "gpt-5.5".to_owned(),
                prompt_message_id: None,
            })
        );
        assert_eq!(
            vault.data.conversations[0].messages[0].offline_replay_claim,
            Some(OfflineReplayClaim {
                claim_id: "claim-1".to_owned(),
                owner: "tab-1".to_owned(),
            })
        );
    }

    #[test]
    fn canonical_vault_round_trip_preserves_prompt_message_id() {
        let value = queued_vault(Some("message-prompt"));

        let vault = decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).unwrap();
        let request = vault.data.conversations[0].messages[0]
            .queued_text_request
            .as_ref()
            .unwrap();
        assert_eq!(request.prompt_message_id.as_deref(), Some("message-prompt"));

        let encoded = serde_json::to_value(&vault).unwrap();
        assert_eq!(
            encoded["data"]["conversations"][0]["messages"][0]["queuedTextRequest"]["promptMessageId"],
            json!("message-prompt")
        );
    }

    #[test]
    fn canonical_vault_rejects_empty_prompt_message_id() {
        let value = queued_vault(Some(""));

        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_missing_current_field() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"].as_object_mut().unwrap().remove("preferences");
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_unknown_field() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["providers"][0]["unexpected"] = json!(true);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_duplicate_record_ids() {
        let mut duplicate_provider = serde_json::to_value(canonical_vault()).unwrap();
        let provider = duplicate_provider["data"]["providers"][0].clone();
        duplicate_provider["data"]["providers"]
            .as_array_mut()
            .unwrap()
            .push(provider);
        assert!(
            decode_validated_sync_vault(&serde_json::to_vec(&duplicate_provider).unwrap()).is_err()
        );

        let mut duplicate_conversation = queued_vault(None);
        let conversation = duplicate_conversation["data"]["conversations"][0].clone();
        duplicate_conversation["data"]["conversations"]
            .as_array_mut()
            .unwrap()
            .push(conversation);
        assert!(
            decode_validated_sync_vault(&serde_json::to_vec(&duplicate_conversation).unwrap())
                .is_err()
        );
    }

    #[test]
    fn canonical_vault_rejects_duplicate_provider_models_and_unknown_capabilities() {
        let mut duplicate_models = serde_json::to_value(canonical_vault()).unwrap();
        duplicate_models["data"]["providers"][0]["models"] = json!(["gpt-5.5", "gpt-5.5"]);
        assert!(
            decode_validated_sync_vault(&serde_json::to_vec(&duplicate_models).unwrap()).is_err()
        );

        let mut unknown_capability = serde_json::to_value(canonical_vault()).unwrap();
        unknown_capability["data"]["providers"][0]["capabilities"] =
            json!(["chat", "unknown-capability"]);
        assert!(
            decode_validated_sync_vault(&serde_json::to_vec(&unknown_capability).unwrap()).is_err()
        );
    }

    #[test]
    fn canonical_vault_rejects_invalid_nested_message_status() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message",
                "role": "assistant",
                "content": "hello",
                "createdAt": 1,
                "status": "invalid"
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_malformed_queued_text_request() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message",
                "role": "assistant",
                "content": "Queued offline",
                "createdAt": 1,
                "status": "queued",
                "queuedTextRequest": {
                    "providerId": "openai"
                }
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());

        value["data"]["conversations"][0]["messages"][0]["queuedTextRequest"] = json!({
            "model": "gpt-5.5"
        });
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_offline_replay_claim_missing_required_field() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message",
                "role": "assistant",
                "content": "Queued offline",
                "createdAt": 1,
                "status": "queued",
                "offlineReplayClaim": {
                    "claimId": "claim-1"
                }
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_offline_replay_claim_unknown_field() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message",
                "role": "assistant",
                "content": "Queued offline",
                "createdAt": 1,
                "status": "queued",
                "offlineReplayClaim": {
                    "claimId": "claim-1",
                    "owner": "tab-1",
                    "unexpected": true
                }
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn canonical_vault_rejects_offline_replay_claim_empty_owner() {
        let mut value = serde_json::to_value(canonical_vault()).unwrap();
        value["data"]["conversations"] = json!([{
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [{
                "id": "message",
                "role": "assistant",
                "content": "Queued offline",
                "createdAt": 1,
                "status": "queued",
                "offlineReplayClaim": {
                    "claimId": "claim-1",
                    "owner": ""
                }
            }],
            "createdAt": 1,
            "updatedAt": 1
        }]);
        assert!(decode_validated_sync_vault(&serde_json::to_vec(&value).unwrap()).is_err());
    }
}
