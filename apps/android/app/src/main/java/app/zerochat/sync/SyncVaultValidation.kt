package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageAttachment
import app.zerochat.data.OfflineReplayClaim
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderConfig
import app.zerochat.data.SkillSettings
import app.zerochat.data.SyncConfig
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

internal class InvalidSyncVaultFormatException(cause: Throwable? = null) :
    IllegalArgumentException("Remote snapshot payload has invalid format.", cause)

internal fun decodeValidatedSyncVault(json: Json, payload: String): SyncVault {
    val element = try {
        json.parseToJsonElement(payload)
    } catch (error: Exception) {
        throw InvalidSyncVaultFormatException(error)
    }

    if (!isCanonicalSyncVaultJson(element)) {
        throw InvalidSyncVaultFormatException()
    }

    val vault = try {
        json.decodeFromJsonElement(SyncVault.serializer(), element)
    } catch (error: Exception) {
        throw InvalidSyncVaultFormatException(error)
    }

    if (!isCanonicalSyncVault(vault)) {
        throw InvalidSyncVaultFormatException()
    }

    return vault
}

private fun isCanonicalSyncVaultJson(element: JsonElement): Boolean {
    if (element.containsNull()) {
        return false
    }

    val vault = element.objectWithShape(VAULT_KEYS, VAULT_KEYS) ?: return false
    val data = vault["data"]?.objectWithShape(APP_DATA_KEYS, APP_DATA_KEYS) ?: return false
    val secrets = vault["secrets"]?.objectWithShape(SECRETS_KEYS, SECRETS_KEYS) ?: return false
    val providerKeys = secrets["providerKeys"] as? JsonObject ?: return false

    return providerKeys.values.all { it.isStringPrimitive() } &&
        data["providers"].arrayMatches(PROVIDER_KEYS, PROVIDER_REQUIRED_KEYS) &&
        data["conversations"].arrayMatches(CONVERSATION_KEYS, CONVERSATION_KEYS) { conversation ->
            conversation["messages"].arrayMatches(MESSAGE_KEYS, MESSAGE_REQUIRED_KEYS) { message ->
                message["attachments"].optionalArrayMatches(ATTACHMENT_KEYS, ATTACHMENT_REQUIRED_KEYS) &&
                    message["queuedTextRequest"].optionalObjectMatches(
                        QUEUED_TEXT_REQUEST_KEYS,
                        QUEUED_TEXT_REQUEST_REQUIRED_KEYS,
                    ) &&
                    message["offlineReplayClaim"].optionalObjectMatches(
                        OFFLINE_REPLAY_CLAIM_KEYS,
                        OFFLINE_REPLAY_CLAIM_KEYS,
                    )
            }
        } &&
        data["skills"].arrayMatches(SKILL_KEYS, SKILL_REQUIRED_KEYS) { skill ->
            skill["chunks"].arrayMatches(SKILL_CHUNK_KEYS, SKILL_CHUNK_REQUIRED_KEYS)
        } &&
        data["skillSettings"]?.objectWithShape(SKILL_SETTINGS_KEYS, SKILL_SETTINGS_KEYS) != null &&
        data["sync"]?.objectWithShape(SYNC_KEYS, SYNC_REQUIRED_KEYS) != null &&
        data["preferences"]?.objectWithShape(PREFERENCES_KEYS, PREFERENCES_REQUIRED_KEYS) != null
}

private fun isCanonicalSyncVault(vault: SyncVault): Boolean =
    isCanonicalAppSnapshot(vault.data)

private fun isCanonicalAppSnapshot(data: AppSnapshot): Boolean =
    data.version == 1 &&
        data.updatedAt >= 0 &&
        data.providers.all(::isCanonicalProvider) &&
        data.conversations.all(::isCanonicalConversation) &&
        data.skills.all(::isCanonicalSkill) &&
        isCanonicalSkillSettings(data.skillSettings) &&
        isCanonicalSyncConfig(data.sync) &&
        isCanonicalPreferences(data.preferences)

private fun isCanonicalProvider(provider: ProviderConfig): Boolean =
    provider.id.isNotEmpty() &&
        provider.name.isNotEmpty() &&
        provider.baseUrl.isNotEmpty() &&
        provider.models.all { it.isNotEmpty() } &&
        provider.models.distinct().size == provider.models.size &&
        provider.capabilities.all(PROVIDER_CAPABILITIES::contains) &&
        provider.capabilities.distinct().size == provider.capabilities.size &&
        provider.createdAt >= 0 &&
        provider.updatedAt >= 0

private fun isCanonicalConversation(conversation: Conversation): Boolean =
    conversation.id.isNotEmpty() &&
        conversation.providerId.isNotEmpty() &&
        conversation.createdAt >= 0 &&
        conversation.updatedAt >= 0 &&
        conversation.messages.all(::isCanonicalMessage)

private fun isCanonicalMessage(message: ChatMessage): Boolean =
    message.id.isNotEmpty() &&
        message.createdAt >= 0 &&
        message.status in MESSAGE_STATUSES &&
        message.attachments.all(::isCanonicalAttachment) &&
        (message.queuedTextRequest == null || isCanonicalQueuedTextRequest(message.queuedTextRequest)) &&
        (message.offlineReplayClaim == null || isCanonicalOfflineReplayClaim(message.offlineReplayClaim))

private fun isCanonicalQueuedTextRequest(request: app.zerochat.data.QueuedTextRequest): Boolean =
    request.providerId.isNotEmpty() &&
        request.model.isNotEmpty() &&
        (request.promptMessageId == null || request.promptMessageId.isNotEmpty())

private fun isCanonicalOfflineReplayClaim(claim: OfflineReplayClaim): Boolean =
    claim.claimId.isNotEmpty() && claim.owner.isNotEmpty()

private fun isCanonicalAttachment(attachment: MessageAttachment): Boolean =
    attachment.id.isNotEmpty() &&
        attachment.kind == "image" &&
        attachment.purpose in ATTACHMENT_PURPOSES &&
        attachment.mimeType.isNotEmpty() &&
        attachment.createdAt >= 0

private fun isCanonicalSkill(skill: UserSkill): Boolean =
    skill.id.isNotEmpty() &&
        skill.name.isNotEmpty() &&
        skill.contentType in SKILL_CONTENT_TYPES &&
        skill.sourceSize >= 0 &&
        skill.contentHash.isNotEmpty() &&
        skill.keywords.all { it.isNotEmpty() } &&
        skill.chunks.isNotEmpty() &&
        skill.chunks.all(::isCanonicalSkillChunk) &&
        skill.createdAt >= 0 &&
        skill.updatedAt >= 0

private fun isCanonicalSkillChunk(chunk: UserSkillChunk): Boolean =
    chunk.id.isNotEmpty() &&
        (chunk.content.isNotEmpty() || !chunk.contentRef.isNullOrEmpty()) &&
        chunk.keywords.all { it.isNotEmpty() } &&
        chunk.tokenEstimate >= 1

private fun isCanonicalSkillSettings(settings: SkillSettings): Boolean =
    settings.contextBudget in 600..8_000 && settings.maxAutoSkills in 1..8

private fun isCanonicalSyncConfig(sync: SyncConfig): Boolean =
    sync.mode in SYNC_MODES && (sync.lastSyncAt == null || sync.lastSyncAt >= 0)

private fun isCanonicalPreferences(preferences: Preferences): Boolean =
    preferences.theme in THEMES &&
        preferences.language in LANGUAGES &&
        preferences.chatContextMessageLimit in 4..200

private fun JsonElement.containsNull(): Boolean = when (this) {
    JsonNull -> true
    is JsonArray -> any(JsonElement::containsNull)
    is JsonObject -> values.any(JsonElement::containsNull)
    else -> false
}

private fun JsonElement.objectWithShape(
    allowedKeys: Set<String>,
    requiredKeys: Set<String>,
): JsonObject? {
    val value = this as? JsonObject ?: return null
    return value.takeIf { value.keys.all(allowedKeys::contains) && value.keys.containsAll(requiredKeys) }
}

private fun JsonElement?.arrayMatches(
    allowedKeys: Set<String>,
    requiredKeys: Set<String>,
    nestedCheck: (JsonObject) -> Boolean = { true },
): Boolean {
    val values = this as? JsonArray ?: return false
    return values.all { item ->
        val value = item.objectWithShape(allowedKeys, requiredKeys) ?: return@all false
        nestedCheck(value)
    }
}

private fun JsonElement?.optionalArrayMatches(
    allowedKeys: Set<String>,
    requiredKeys: Set<String>,
): Boolean = this == null || arrayMatches(allowedKeys, requiredKeys)

private fun JsonElement?.optionalObjectMatches(
    allowedKeys: Set<String>,
    requiredKeys: Set<String>,
): Boolean = this == null || this.objectWithShape(allowedKeys, requiredKeys) != null

private fun JsonElement.isStringPrimitive(): Boolean =
    this is JsonPrimitive && isString

private val VAULT_KEYS = setOf("data", "secrets")
private val PROVIDER_CAPABILITIES = setOf(
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
)
private val SECRETS_KEYS = setOf("providerKeys")
private val APP_DATA_KEYS = setOf(
    "version",
    "providers",
    "conversations",
    "skills",
    "skillSettings",
    "sync",
    "preferences",
    "updatedAt",
)
private val PROVIDER_KEYS = setOf(
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
)
private val PROVIDER_REQUIRED_KEYS = setOf(
    "id",
    "name",
    "kind",
    "baseUrl",
    "model",
    "enabled",
    "needsApiKey",
    "createdAt",
    "updatedAt",
)
private val CONVERSATION_KEYS = setOf("id", "title", "providerId", "model", "messages", "createdAt", "updatedAt")
private val MESSAGE_KEYS = setOf(
    "id",
    "role",
    "content",
    "createdAt",
    "status",
    "error",
    "attachments",
    "queuedTextRequest",
    "offlineReplayClaim",
)
private val MESSAGE_REQUIRED_KEYS = setOf("id", "role", "content", "createdAt")
private val QUEUED_TEXT_REQUEST_KEYS = setOf("providerId", "model", "promptMessageId")
private val QUEUED_TEXT_REQUEST_REQUIRED_KEYS = setOf("providerId", "model")
private val OFFLINE_REPLAY_CLAIM_KEYS = setOf("claimId", "owner")
private val ATTACHMENT_KEYS = setOf("id", "kind", "purpose", "mimeType", "dataUrl", "url", "alt", "model", "createdAt")
private val ATTACHMENT_REQUIRED_KEYS = setOf("id", "kind", "mimeType", "createdAt")
private val SKILL_KEYS = setOf(
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
)
private val SKILL_REQUIRED_KEYS = setOf(
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
)
private val SKILL_CHUNK_KEYS = setOf("id", "heading", "content", "contentRef", "contentPreview", "keywords", "tokenEstimate")
private val SKILL_CHUNK_REQUIRED_KEYS = setOf("id", "heading", "keywords", "tokenEstimate")
private val SKILL_SETTINGS_KEYS = setOf("autoMatch", "contextBudget", "maxAutoSkills")
private val SYNC_KEYS = setOf(
    "mode",
    "autoSync",
    "encryptionEnabled",
    "gistId",
    "gistFile",
    "workerEndpoint",
    "lastSyncAt",
    "lastSyncStatus",
)
private val SYNC_REQUIRED_KEYS = setOf("mode", "autoSync", "encryptionEnabled")
private val PREFERENCES_KEYS = setOf(
    "firstRunDone",
    "theme",
    "language",
    "compactMode",
    "chatContextMessageLimit",
    "activeConversationId",
    "dismissedDangerWarnings",
    "dismissedFeatureHints",
)
private val PREFERENCES_REQUIRED_KEYS = setOf("firstRunDone", "theme", "language", "compactMode")
private val MESSAGE_STATUSES = setOf("queued", "streaming", "done", "error")
private val ATTACHMENT_PURPOSES = setOf(null, "generated", "source", "mask")
private val SKILL_CONTENT_TYPES = setOf("markdown", "text", "json")
private val SYNC_MODES = setOf("local", "gist", "cloudflare")
private val THEMES = setOf("system", "light", "dark")
private val LANGUAGES = setOf(
    "system",
    "zh-CN",
    "en-US",
    "es-ES",
    "hi-IN",
    "ar-SA",
    "pt-BR",
    "ru-RU",
    "ja-JP",
    "ko-KR",
    "fr-FR",
)
