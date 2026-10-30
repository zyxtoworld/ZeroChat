package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageRole
import app.zerochat.data.ModelMetadata
import app.zerochat.data.OfflineReplayClaim
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.QueuedTextRequest
import app.zerochat.data.SyncVault
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SyncVaultValidationTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    @Test
    fun decodesCanonicalVault() {
        val vault = canonicalVault()
        val decoded = decodeValidatedSyncVault(json, encode(vault))
        assertEquals(vault, decoded)
        assertEquals(
            QueuedTextRequest(providerId = "provider-1", model = "chat-model"),
            decoded.data.conversations.single().messages.single().queuedTextRequest,
        )
        assertEquals(
            OfflineReplayClaim(claimId = "claim-1", owner = "tab-1"),
            decoded.data.conversations.single().messages.single().offlineReplayClaim,
        )
    }

    @Test
    fun roundTripsQueuedPromptMessageId() {
        val vault = queuedVault(
            QueuedTextRequest(
                providerId = "provider-1",
                model = "chat-model",
                promptMessageId = "message-prompt",
            ),
        )

        val decoded = decodeValidatedSyncVault(json, encode(vault))

        assertEquals(vault, decoded)
        assertEquals(
            "message-prompt",
            decoded.data.conversations.single().messages.single()
                .queuedTextRequest?.promptMessageId,
        )
    }

    @Test
    fun rejectsEmptyQueuedPromptMessageId() {
        val malformed = queuedVault(
            QueuedTextRequest(
                providerId = "provider-1",
                model = "chat-model",
                promptMessageId = "",
            ),
        )

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, encode(malformed))
        }
    }

    @Test
    fun rejectsQueuedTextRequestMissingProviderOrModel() {
        listOf(
            mapOf("providerId" to JsonPrimitive("provider-1")),
            mapOf("model" to JsonPrimitive("chat-model")),
        ).forEach { request ->
            val malformed = transformFirstMessage(canonicalVault()) { message ->
                JsonObject(message + ("queuedTextRequest" to JsonObject(request)))
            }

            assertThrows(InvalidSyncVaultFormatException::class.java) {
                decodeValidatedSyncVault(json, malformed.toString())
            }
        }
    }

    @Test
    fun rejectsVaultMissingCurrentSnapshotFields() {
        val root = json.encodeToJsonElement(SyncVault.serializer(), canonicalVault()).jsonObject
        val data = root.getValue("data").jsonObject
        val malformed = JsonObject(root + ("data" to JsonObject(data - "skillSettings")))

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, malformed.toString())
        }
    }

    @Test
    fun rejectsVaultWithUnknownFields() {
        val root = json.encodeToJsonElement(SyncVault.serializer(), canonicalVault()).jsonObject
        val malformed = JsonObject(root + ("unexpected" to JsonPrimitive(true)))

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, malformed.toString())
        }
    }

    @Test
    fun rejectsVaultWithInvalidNestedMessageStatus() {
        val provider = provider()
        val vault = SyncVault(
            data = AppSnapshot(
                providers = listOf(provider),
                conversations = listOf(
                    Conversation(
                        id = "conversation-1",
                        title = "Conversation",
                        providerId = provider.id,
                        model = provider.model,
                        messages = listOf(
                            ChatMessage(
                                id = "message-1",
                                role = MessageRole.User,
                                content = "Hello",
                                createdAt = 1,
                                status = "invalid",
                            ),
                        ),
                        createdAt = 1,
                        updatedAt = 1,
                    ),
                ),
                updatedAt = 1,
            ),
        )

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, encode(vault))
        }
    }

    @Test
    fun rejectsOfflineReplayClaimMissingRequiredField() {
        val malformed = transformFirstMessage(canonicalVault()) { message ->
            JsonObject(
                message + (
                    "offlineReplayClaim" to JsonObject(
                        mapOf("claimId" to JsonPrimitive("claim-1")),
                    )
                ),
            )
        }

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, malformed.toString())
        }
    }

    @Test
    fun rejectsOfflineReplayClaimWithUnknownField() {
        val malformed = transformFirstMessage(canonicalVault()) { message ->
            JsonObject(
                message + (
                    "offlineReplayClaim" to JsonObject(
                        mapOf(
                            "claimId" to JsonPrimitive("claim-1"),
                            "owner" to JsonPrimitive("tab-1"),
                            "unexpected" to JsonPrimitive(true),
                        ),
                    )
                ),
            )
        }

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, malformed.toString())
        }
    }

    @Test
    fun rejectsOfflineReplayClaimWithEmptyOwner() {
        val vault = canonicalVault()
        val conversation = vault.data.conversations.single()
        val message = conversation.messages.single()
        val malformed = vault.copy(
            data = vault.data.copy(
                conversations = listOf(
                    conversation.copy(
                        messages = listOf(
                            message.copy(
                                offlineReplayClaim = OfflineReplayClaim(
                                    claimId = "claim-1",
                                    owner = "",
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )

        assertThrows(InvalidSyncVaultFormatException::class.java) {
            decodeValidatedSyncVault(json, encode(malformed))
        }
    }

    @Test
    fun preservesAdvancedProviderCapabilityModels() {
        val provider = provider().copy(
            audioSpeechModel = "speech-model",
            audioTranscriptionModel = "transcription-model",
            embeddingModel = "embedding-model",
            moderationModel = "moderation-model",
            realtimeModel = "realtime-model",
        )
        val decoded = decodeValidatedSyncVault(
            json,
            encode(SyncVault(data = AppSnapshot(providers = listOf(provider), updatedAt = 1))),
        ).data.providers.single()

        assertEquals("speech-model", decoded.audioSpeechModel)
        assertEquals("transcription-model", decoded.audioTranscriptionModel)
        assertEquals("embedding-model", decoded.embeddingModel)
        assertEquals("moderation-model", decoded.moderationModel)
        assertEquals("realtime-model", decoded.realtimeModel)
    }

    @Test
    fun acceptsLegacyZeroProviderModelLimitsByClearingThem() {
        val vault = canonicalVault()
        val legacyMetadata = ModelMetadata(
            id = "chat-model",
            contextWindowTokens = 0,
            maxInputTokens = 0,
            maxOutputTokens = 0,
        )
        val legacyVault = vault.copy(
            data = vault.data.copy(
                providers = listOf(
                    vault.data.providers.single().copy(
                        modelMetadata = mapOf("chat-model" to legacyMetadata),
                    ),
                ),
            ),
        )

        val decoded = decodeValidatedSyncVault(json, encode(legacyVault))

        assertEquals(
            ModelMetadata(id = "chat-model"),
            decoded.data.providers.single().modelMetadata.getValue("chat-model"),
        )
    }

    @Test
    fun rejectsDuplicateProviderModelsAndUnknownCapabilities() {
        val invalidProviders = listOf(
            provider().copy(models = listOf("chat-model", "chat-model")),
            provider().copy(capabilities = listOf("chat", "unknown-capability")),
        )

        invalidProviders.forEach { invalidProvider ->
            val malformed = SyncVault(
                data = AppSnapshot(providers = listOf(invalidProvider), updatedAt = 1),
            )
            assertThrows(InvalidSyncVaultFormatException::class.java) {
                decodeValidatedSyncVault(json, encode(malformed))
            }
        }
    }

    private fun canonicalVault(): SyncVault {
        val provider = provider()
        return SyncVault(
            data = AppSnapshot(
                providers = listOf(provider),
                conversations = listOf(
                    Conversation(
                        id = "conversation-queued",
                        title = "Queued",
                        providerId = provider.id,
                        model = provider.model,
                        messages = listOf(
                            ChatMessage(
                                id = "message-queued",
                                role = MessageRole.Assistant,
                                content = "Queued offline",
                                createdAt = 1,
                                status = "queued",
                                queuedTextRequest = QueuedTextRequest(
                                    providerId = provider.id,
                                    model = provider.model,
                                ),
                                offlineReplayClaim = OfflineReplayClaim(
                                    claimId = "claim-1",
                                    owner = "tab-1",
                                ),
                            ),
                        ),
                        createdAt = 1,
                        updatedAt = 1,
                    ),
                ),
                updatedAt = 1,
            ),
        )
    }

    private fun queuedVault(request: QueuedTextRequest): SyncVault {
        val vault = canonicalVault()
        val conversation = vault.data.conversations.single()
        val message = conversation.messages.single()
        return vault.copy(
            data = vault.data.copy(
                conversations = listOf(
                    conversation.copy(
                        messages = listOf(message.copy(queuedTextRequest = request)),
                    ),
                ),
            ),
        )
    }

    private fun provider(): ProviderConfig = ProviderConfig(
        id = "provider-1",
        name = "Provider",
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.com/v1",
        model = "chat-model",
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )

    private fun encode(vault: SyncVault): String =
        json.encodeToString(SyncVault.serializer(), vault)

    private fun transformFirstMessage(
        vault: SyncVault,
        transform: (JsonObject) -> JsonObject,
    ): JsonObject {
        val root = json.encodeToJsonElement(SyncVault.serializer(), vault).jsonObject
        val data = root.getValue("data").jsonObject
        val conversations = data.getValue("conversations") as JsonArray
        val conversation = conversations.single().jsonObject
        val messages = conversation.getValue("messages") as JsonArray
        val updatedMessages = JsonArray(listOf(transform(messages.single().jsonObject)))
        val updatedConversation = JsonObject(conversation + ("messages" to updatedMessages))
        val updatedData = JsonObject(
            data + ("conversations" to JsonArray(listOf(updatedConversation))),
        )
        return JsonObject(root + ("data" to updatedData))
    }
}
