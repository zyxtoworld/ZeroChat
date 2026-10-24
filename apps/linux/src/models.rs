use serde::{Deserialize, Serialize};

fn default_chat_context_message_limit() -> i32 {
    24
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    OpenaiCompatible,
    OpenaiResponses,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetadata {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<i64>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub client_request_mode: bool,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_speech_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_transcription_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub moderation_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realtime_model: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub model_metadata: std::collections::BTreeMap<String, ModelMetadata>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub enabled: bool,
    pub needs_api_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<bool>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedTextRequest {
    pub provider_id: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineReplayClaim {
    pub claim_id: String,
    pub owner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub attachments: Vec<MessageAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_text_request: Option<QueuedTextRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_replay_claim: Option<OfflineReplayClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationContextCompaction {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<serde_json::Value>>,
    pub compacted_through_message_id: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_compaction: Option<ConversationContextCompaction>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub mode: String,
    pub auto_sync: bool,
    pub encryption_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gist_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub first_run_done: bool,
    pub theme: String,
    pub language: String,
    pub compact_mode: bool,
    #[serde(default = "default_chat_context_message_limit")]
    pub chat_context_message_limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_danger_warnings: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_feature_hints: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSkillChunk {
    pub id: String,
    pub heading: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_preview: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    pub token_estimate: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSkill {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default = "default_skill_content_type")]
    pub content_type: String,
    #[serde(default)]
    pub source_size: i32,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub chunks: Vec<UserSkillChunk>,
    #[serde(default)]
    pub fixed: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub auto_match: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSettings {
    #[serde(default = "default_true")]
    pub auto_match: bool,
    #[serde(default = "default_skill_context_budget")]
    pub context_budget: i32,
    #[serde(default = "default_max_auto_skills")]
    pub max_auto_skills: i32,
}

fn default_true() -> bool {
    true
}

fn default_skill_content_type() -> String {
    "text".to_owned()
}

fn default_skill_context_budget() -> i32 {
    2400
}

fn default_max_auto_skills() -> i32 {
    3
}

fn default_skill_settings() -> SkillSettings {
    SkillSettings {
        auto_match: true,
        context_budget: default_skill_context_budget(),
        max_auto_skills: default_max_auto_skills(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub version: i32,
    pub providers: Vec<ProviderConfig>,
    pub conversations: Vec<Conversation>,
    #[serde(default)]
    pub skills: Vec<UserSkill>,
    #[serde(default = "default_skill_settings")]
    pub skill_settings: SkillSettings,
    pub sync: SyncConfig,
    pub preferences: Preferences,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecrets {
    #[serde(default)]
    pub provider_keys: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncVault {
    pub data: AppSnapshot,
    #[serde(default)]
    pub secrets: ProviderSecrets,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedSnapshotEnvelope {
    pub kind: String,
    pub version: i32,
    pub encrypted_at: i64,
    pub updated_at: i64,
    pub crypto: EnvelopeCrypto,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeCrypto {
    pub cipher: String,
    pub kdf: String,
    pub iterations: i32,
    pub salt: String,
    pub iv: String,
    pub aad: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedObjectEnvelope {
    pub kind: String,
    pub version: i32,
    pub object_type: String,
    pub encrypted_at: i64,
    pub updated_at: i64,
    pub crypto: ObjectEnvelopeCrypto,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectEnvelopeCrypto {
    pub cipher: String,
    pub kdf: String,
    pub iterations: i32,
    pub salt: String,
    pub iv: String,
    pub aad: String,
    pub compression: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncrementalSyncHead {
    pub kind: String,
    pub version: i32,
    pub manifest_key: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncrementalChunkRef {
    pub conversation_id: String,
    pub index: i32,
    pub key: String,
    pub object_type: String,
    pub fingerprint: String,
    pub message_count: i32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncrementalSkillRef {
    pub skill_id: String,
    pub chunk_id: String,
    pub key: String,
    pub object_type: String,
    pub fingerprint: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncrementalAttachmentRef {
    pub conversation_id: String,
    pub message_id: String,
    pub attachment_id: String,
    pub index: i32,
    pub chunk_count: i32,
    pub key: String,
    pub object_type: String,
    pub fingerprint: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncrementalManifest {
    pub kind: String,
    pub version: i32,
    pub updated_at: i64,
    pub data: AppSnapshot,
    #[serde(default)]
    pub secrets: ProviderSecrets,
    #[serde(default)]
    pub chunks: Vec<IncrementalChunkRef>,
    #[serde(default)]
    pub skill_chunks: Vec<IncrementalSkillRef>,
    #[serde(default)]
    pub attachment_chunks: Vec<IncrementalAttachmentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationChunk {
    pub kind: String,
    pub version: i32,
    pub conversation_id: String,
    pub index: i32,
    pub messages: Vec<ChatMessage>,
    pub updated_at: i64,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContentChunk {
    pub kind: String,
    pub version: i32,
    pub skill_id: String,
    pub chunk_id: String,
    pub content: String,
    pub updated_at: i64,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContentChunk {
    pub kind: String,
    pub version: i32,
    pub conversation_id: String,
    pub message_id: String,
    pub attachment_id: String,
    pub index: i32,
    pub chunk_count: i32,
    pub content: String,
    pub updated_at: i64,
    pub fingerprint: String,
}
