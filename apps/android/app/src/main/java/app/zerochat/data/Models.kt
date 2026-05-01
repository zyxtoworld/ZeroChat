package app.zerochat.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
enum class ProviderKind {
    @SerialName("openai-compatible")
    OpenAICompatible,
    @SerialName("anthropic")
    Anthropic,
}

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
    val model: String,
    val enabled: Boolean,
    val needsApiKey: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
)

@Serializable
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val createdAt: Long,
    val status: String = "done",
    val error: String? = null,
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
)

@Serializable
data class SyncConfig(
    val mode: String = "local",
    val autoSync: Boolean = false,
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
    val compactMode: Boolean = false,
    val activeConversationId: String? = null,
)

@Serializable
data class AppSnapshot(
    val version: Int = 1,
    val providers: List<ProviderConfig> = emptyList(),
    val conversations: List<Conversation> = emptyList(),
    val sync: SyncConfig = SyncConfig(),
    val preferences: Preferences = Preferences(),
    val updatedAt: Long = System.currentTimeMillis(),
)
