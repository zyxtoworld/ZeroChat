use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    OpenaiCompatible,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub proxy_url: Option<String>,
    pub model: String,
    pub enabled: bool,
    pub needs_api_key: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: i64,
    pub status: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub mode: String,
    pub auto_sync: bool,
    pub encryption_enabled: bool,
    pub gist_id: Option<String>,
    pub gist_file: Option<String>,
    pub worker_endpoint: Option<String>,
    pub last_sync_at: Option<i64>,
    pub last_sync_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub first_run_done: bool,
    pub theme: String,
    pub compact_mode: bool,
    pub active_conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub version: i32,
    pub providers: Vec<ProviderConfig>,
    pub conversations: Vec<Conversation>,
    pub sync: SyncConfig,
    pub preferences: Preferences,
    pub updated_at: i64,
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
