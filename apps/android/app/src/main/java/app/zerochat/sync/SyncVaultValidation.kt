package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ModelMetadata
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
import kotlinx.serialization.json.longOrNull

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
        data["providers"].arrayMatches(PROVIDER_KEYS, PROVIDER_REQUIRED_KEYS) { provider ->
            provider["modelMetadata"].modelMetadataMapMatches()
        } &&
        data["conversations"].arrayMatches(CONVERSATION_KEYS, CONVERSATION_REQUIRED_KEYS) { conversation ->
            conversation["contextCompaction"].let { value ->
                value == null || isCanonicalCompactionJson(value)
            } &&
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
private fun JsonElement.isNonEmptyStringPrimitive(): Boolean =
    this is JsonPrimitive && isString && content.isNotEmpty()

private fun JsonElement.isNonNegativeInteger(): Boolean {
    val value = this as? JsonPrimitive ?: return false
    val number = value.longOrNull ?: return false
    return number >= 0
}

private fun JsonElement.isPositiveInteger(): Boolean {
    val value = this as? JsonPrimitive ?: return false
    val number = value.longOrNull ?: return false
    return number > 0
}

private fun isCanonicalModelMetadata(metadata: ModelMetadata): Boolean =
    metadata.id.isNotEmpty() &&
        metadata.source in MODEL_METADATA_SOURCES &&
        (metadata.contextWindowTokens == null || metadata.contextWindowTokens > 0) &&
        (metadata.maxInputTokens == null || metadata.maxInputTokens > 0) &&
        (metadata.maxOutputTokens == null || metadata.maxOutputTokens > 0) &&
        metadata.capabilities.all(PROVIDER_CAPABILITIES::contains) &&
        metadata.capabilities.distinct().size == metadata.capabilities.size &&
        (metadata.verifiedAt == null || metadata.verifiedAt >= 0)

private fun JsonElement?.isNonEmptyStringArray(allowed: Set<String>? = null): Boolean {
    val values = this as? JsonArray ?: return false
    return values.all {
        it.isNonEmptyStringPrimitive() &&
            (allowed == null || (it as JsonPrimitive).content in allowed)
    }
}

private fun isCanonicalModelMetadataJson(value: JsonElement): Boolean {
    val metadata = value as? JsonObject ?: return false
    if (!metadata.keys.all(MODEL_METADATA_KEYS::contains) ||
        !metadata.keys.containsAll(MODEL_METADATA_REQUIRED_KEYS)) {
        return false
    }
    return metadata["id"]?.isNonEmptyStringPrimitive() == true &&
        (metadata["displayName"] == null || metadata["displayName"]?.isStringPrimitive() == true) &&
        (metadata["contextWindowTokens"] == null || metadata["contextWindowTokens"]?.isPositiveInteger() == true) &&
        (metadata["maxInputTokens"] == null || metadata["maxInputTokens"]?.isPositiveInteger() == true) &&
        (metadata["maxOutputTokens"] == null || metadata["maxOutputTokens"]?.isPositiveInteger() == true) &&
        (metadata["capabilities"] == null ||
            metadata["capabilities"].isNonEmptyStringArray(PROVIDER_CAPABILITIES)) &&
        metadata["source"]?.isNonEmptyStringPrimitive() == true &&
        (metadata["source"]?.let { (it as JsonPrimitive).content } in MODEL_METADATA_SOURCES) &&
        (metadata["verifiedAt"] == null || metadata["verifiedAt"]?.isNonNegativeInteger() == true)
}

private fun JsonElement?.modelMetadataMapMatches(): Boolean {
    if (this == null) return true
    val values = this as? JsonObject ?: return false
    return values.values.all(::isCanonicalModelMetadataJson)
}

private fun isCanonicalCompactionJson(value: JsonElement): Boolean {
    val compaction = value as? JsonObject ?: return false
    if (!compaction.keys.all(COMPACTION_KEYS::contains) ||
        !compaction.keys.containsAll(COMPACTION_REQUIRED_KEYS)) {
        return false
    }
    return compaction["source"]?.isNonEmptyStringPrimitive() == true &&
        (compaction["source"]?.let { (it as JsonPrimitive).content } in COMPACTION_SOURCES) &&
        (compaction["summary"] == null || compaction["summary"]?.isStringPrimitive() == true) &&
        (compaction["items"] == null || compaction["items"] is JsonArray) &&
        compaction["compactedThroughMessageId"]?.isNonEmptyStringPrimitive() == true &&
        compaction["model"]?.isNonEmptyStringPrimitive() == true &&
        (compaction["inputTokens"] == null || compaction["inputTokens"]?.isPositiveInteger() == true) &&
        compaction["createdAt"]?.isNonNegativeInteger() == true
}

private fun isCanonicalCompaction(compaction: app.zerochat.data.ConversationContextCompaction): Boolean =
    compaction.source in COMPACTION_SOURCES &&
        (compaction.source != "local-summary" || !compaction.summary.isNullOrEmpty()) &&
        compaction.compactedThroughMessageId.isNotEmpty() &&
        compaction.model.isNotEmpty() &&
        (compaction.inputTokens == null || compaction.inputTokens > 0) &&
        compaction.createdAt >= 0
private fun isCanonicalConversation(conversation: Conversation): Boolean =
    conversation.id.isNotEmpty() &&
        conversation.providerId.isNotEmpty() &&
        conversation.createdAt >= 0 &&
        conversation.updatedAt >= 0 &&
        (conversation.contextCompaction == null ||
            isCanonicalCompaction(conversation.contextCompaction)) &&
        conversation.messages.all(::isCanonicalMessage)
private fun isCanonicalProvider(provider: ProviderConfig): Boolean =
    provider.id.isNotEmpty() &&
        provider.name.isNotEmpty() &&
        provider.baseUrl.isNotEmpty() &&
        provider.models.all { it.isNotEmpty() } &&
        provider.models.distinct().size == provider.models.size &&
        provider.modelMetadata.all { (modelId, metadata) ->
            modelId.isNotEmpty() && isCanonicalModelMetadata(metadata)
        } &&
        provider.capabilities.all(PROVIDER_CAPABILITIES::contains) &&
        provider.capabilities.distinct().size == provider.capabilities.size &&
        provider.createdAt >= 0 &&
        provider.updatedAt >= 0


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
private val MODEL_METADATA_SOURCES = setOf(
    "models-dev",
    "provider-api",
    "provider-docs",
    "manual",
    "heuristic",
)
private val MODEL_METADATA_KEYS = setOf(
    "id",
    "displayName",
    "contextWindowTokens",
    "maxInputTokens",
    "maxOutputTokens",
    "capabilities",
    "source",
    "verifiedAt",
)
private val MODEL_METADATA_REQUIRED_KEYS = setOf("id", "source")
private val COMPACTION_SOURCES = setOf("remote-compaction", "local-summary")
private val COMPACTION_KEYS = setOf(
    "source",
    "summary",
    "items",
    "compactedThroughMessageId",
    "model",
    "inputTokens",
    "createdAt",
)
private val COMPACTION_REQUIRED_KEYS = setOf("source", "compactedThroughMessageId", "model", "createdAt")


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
    "modelMetadata",
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
private val CONVERSATION_KEYS = setOf(
    "id",
    "title",
    "providerId",
    "model",
    "messages",
    "contextCompaction",
    "createdAt",
    "updatedAt",
)
private val CONVERSATION_REQUIRED_KEYS = setOf("id", "title", "providerId", "model", "messages", "createdAt", "updatedAt")
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
