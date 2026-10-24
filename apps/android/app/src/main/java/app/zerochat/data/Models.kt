package app.zerochat.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonElement

@Serializable
enum class ProviderKind {
    @SerialName("openai-compatible")
    OpenAICompatible,
    @SerialName("openai-responses")
    OpenAIResponses,
    @SerialName("anthropic")
    Anthropic,
}

enum class ProviderModelCapability {
    Chat,
    ImageGeneration,
    ImageEditing,
    Embeddings,
    Audio,
    Realtime,
    Moderation,
}

@Serializable
data class ModelMetadata(
    val id: String,
    val displayName: String? = null,
    val contextWindowTokens: Long? = null,
    val maxInputTokens: Long? = null,
    val maxOutputTokens: Long? = null,
    val capabilities: List<String> = emptyList(),
    val source: String = "provider-api",
    val verifiedAt: Long? = null,
)

@Serializable
enum class MessageRole {
    @SerialName("system")
    System,
    @SerialName("user")
    User,
    @SerialName("assistant")
    Assistant,
}
@Serializable
data class ProviderConfig(
    val id: String,
    val name: String,
    val kind: ProviderKind,
    val baseUrl: String,
    val proxyUrl: String? = null,
    val clientRequestMode: Boolean = false,
    val model: String,
    val imageModel: String? = null,
    val audioSpeechModel: String? = null,
    val audioTranscriptionModel: String? = null,
    val embeddingModel: String? = null,
    val moderationModel: String? = null,
    val realtimeModel: String? = null,
    val models: List<String> = emptyList(),
    val modelMetadata: Map<String, ModelMetadata> = emptyMap(),
    val capabilities: List<String> = emptyList(),
    val enabled: Boolean,
    val needsApiKey: Boolean,
    val custom: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long,
)

@Serializable
data class MessageAttachment(
    val id: String,
    val kind: String,
    val purpose: String? = null,
    val mimeType: String,
    val dataUrl: String? = null,
    val url: String? = null,
    val alt: String? = null,
    val model: String? = null,
    val createdAt: Long,
)

@Serializable
data class QueuedTextRequest(
    val providerId: String,
    val model: String,
    val promptMessageId: String? = null,
)

@Serializable
data class OfflineReplayClaim(
    val claimId: String,
    val owner: String,
)

@Serializable
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val createdAt: Long,
    val status: String = "done",
    val error: String? = null,
    val attachments: List<MessageAttachment> = emptyList(),
    val queuedTextRequest: QueuedTextRequest? = null,
    val offlineReplayClaim: OfflineReplayClaim? = null,
)

@Serializable
data class ConversationContextCompaction(
    val source: String,
    val summary: String? = null,
    val items: List<JsonElement>? = null,
    val compactedThroughMessageId: String,
    val model: String,
    val inputTokens: Long? = null,
    val createdAt: Long,
)

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val providerId: String,
    val model: String,
    val messages: List<ChatMessage>,
    val createdAt: Long,
    val updatedAt: Long,
    val contextCompaction: ConversationContextCompaction? = null,
)

@Serializable
data class SyncConfig(
    val mode: String = "local",
    val autoSync: Boolean = false,
    val encryptionEnabled: Boolean = true,
    val gistId: String? = null,
    val gistFile: String = "zerochat-sync.json",
    val workerEndpoint: String? = null,
    val lastSyncAt: Long? = null,
    val lastSyncStatus: String? = null,
)

@Serializable
data class Preferences(
    val firstRunDone: Boolean = false,
    val theme: String = "system",
    val language: String = "system",
    val compactMode: Boolean = false,
    val chatContextMessageLimit: Int = 24,
    val activeConversationId: String? = null,
    val dismissedDangerWarnings: List<String> = emptyList(),
    val dismissedFeatureHints: List<String> = emptyList(),
)

@Serializable
data class UserSkillChunk(
    val id: String,
    val heading: String,
    val content: String = "",
    val contentRef: String? = null,
    val contentPreview: String? = null,
    val keywords: List<String> = emptyList(),
    val tokenEstimate: Int,
)

@Serializable
data class UserSkill(
    val id: String,
    val name: String,
    val description: String = "",
    val fileName: String? = null,
    val contentType: String = "text",
    val sourceSize: Int = 0,
    val contentHash: String = "",
    val keywords: List<String> = emptyList(),
    val chunks: List<UserSkillChunk> = emptyList(),
    val fixed: Boolean = false,
    val enabled: Boolean = true,
    val autoMatch: Boolean = true,
    val createdAt: Long,
    val updatedAt: Long,
)

@Serializable
data class SkillSettings(
    val autoMatch: Boolean = true,
    val contextBudget: Int = 2400,
    val maxAutoSkills: Int = 3,
)

@Serializable
data class AppSnapshot(
    val version: Int = 1,
    val providers: List<ProviderConfig> = emptyList(),
    val conversations: List<Conversation> = emptyList(),
    val skills: List<UserSkill> = emptyList(),
    val skillSettings: SkillSettings = SkillSettings(),
    val sync: SyncConfig = SyncConfig(),
    val preferences: Preferences = Preferences(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Serializable
data class ProviderSecrets(
    val providerKeys: Map<String, String> = emptyMap(),
)

@Serializable
data class SyncVault(
    val data: AppSnapshot,
    val secrets: ProviderSecrets = ProviderSecrets(),
)

@Serializable
data class EncryptedSnapshotEnvelope(
    val kind: String = "zerochat.encryptedSnapshot",
    val version: Int = 1,
    val encryptedAt: Long,
    val updatedAt: Long,
    val crypto: EnvelopeCrypto,
    val payload: String,
)

@Serializable
data class EnvelopeCrypto(
    val cipher: String = "AES-256-GCM",
    val kdf: String = "PBKDF2-SHA256",
    val iterations: Int,
    val salt: String,
    val iv: String,
    val aad: String,
)

@Serializable
data class EncryptedObjectEnvelope(
    val kind: String = "zerochat.encryptedObject",
    val version: Int = 1,
    val objectType: String,
    val encryptedAt: Long,
    val updatedAt: Long,
    val crypto: ObjectEnvelopeCrypto,
    val payload: String,
)

@Serializable
data class ObjectEnvelopeCrypto(
    val cipher: String = "AES-256-GCM",
    val kdf: String = "PBKDF2-SHA256",
    val iterations: Int,
    val salt: String,
    val iv: String,
    val aad: String,
    val compression: String = "none",
)

@Serializable
data class IncrementalSyncHead(
    val kind: String = "zerochat.incrementalHead",
    val version: Int = 1,
    val manifestKey: String,
    val updatedAt: Long,
)

@Serializable
data class IncrementalChunkRef(
    val conversationId: String,
    val index: Int,
    val key: String,
    val objectType: String,
    val fingerprint: String,
    val messageCount: Int,
    val updatedAt: Long,
)

@Serializable
data class IncrementalSkillRef(
    val skillId: String,
    val chunkId: String,
    val key: String,
    val objectType: String,
    val fingerprint: String,
    val updatedAt: Long,
)

@Serializable
data class IncrementalAttachmentRef(
    val conversationId: String,
    val messageId: String,
    val attachmentId: String,
    val index: Int,
    val chunkCount: Int,
    val key: String,
    val objectType: String,
    val fingerprint: String,
    val updatedAt: Long,
)

@Serializable
data class IncrementalManifest(
    val kind: String = "zerochat.incrementalManifest",
    val version: Int = 1,
    val updatedAt: Long,
    val data: AppSnapshot,
    val secrets: ProviderSecrets = ProviderSecrets(),
    val chunks: List<IncrementalChunkRef> = emptyList(),
    val skillChunks: List<IncrementalSkillRef> = emptyList(),
    val attachmentChunks: List<IncrementalAttachmentRef> = emptyList(),
)

@Serializable
data class ConversationChunk(
    val kind: String = "zerochat.conversationChunk",
    val version: Int = 1,
    val conversationId: String,
    val index: Int,
    val messages: List<ChatMessage>,
    val updatedAt: Long,
    val fingerprint: String,
)

@Serializable
data class SkillContentChunk(
    val kind: String = "zerochat.skillChunk",
    val version: Int = 1,
    val skillId: String,
    val chunkId: String,
    val content: String,
    val updatedAt: Long,
    val fingerprint: String,
)

@Serializable
data class AttachmentContentChunk(
    val kind: String = "zerochat.attachmentChunk",
    val version: Int = 1,
    val conversationId: String,
    val messageId: String,
    val attachmentId: String,
    val index: Int,
    val chunkCount: Int,
    val content: String,
    val updatedAt: Long,
    val fingerprint: String,
)
