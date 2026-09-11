package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.NativeI18n
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModelSettingsHelpersTest {
    @Test
    fun modelsFetchFailureNoticeDoesNotExposeRawExceptionText() {
        val sentinel =
            "C:\\private\\models\\secret.json /home/runner/.config/token " +
                "https://provider.invalid/v1 sk-test-not-a-real-key"

        val notice = modelsFetchFailureNotice(
            NativeI18n.forMode("en-US"),
            IllegalStateException(sentinel),
        )

        assertFalse(notice.contains(sentinel))
        assertFalse(notice.contains("C:\\private"))
        assertFalse(notice.contains("/home/runner"))
        assertFalse(notice.contains("provider.invalid"))
        assertFalse(notice.contains("sk-test-not-a-real-key"))
    }

    @Test
    fun modelSettingsManualModelsSplitsWhitespaceAndDropsEmptyEntries() {
        assertEquals(
            listOf("gpt-4o", "claude-3-5-sonnet", "gpt-image-2"),
            modelSettingsManualModels("  gpt-4o\nclaude-3-5-sonnet\t gpt-image-2  "),
        )
    }

    @Test
    fun modelSettingsModelCapabilitySummaryDescribesSingleModelFamilies() {
        val labels = mapOf(
            "capability.chat" to "Chat",
            "capability.image-generation" to "Image generation",
            "capability.image-editing" to "Image editing",
            "capability.audio" to "Audio",
            "capability.audio-speech" to "Text to speech",
            "capability.audio-transcription" to "Audio transcription",
            "capability.embeddings" to "Embeddings",
            "capability.realtime" to "Realtime voice",
            "capability.moderation" to "Moderation",
        )

        assertEquals(
            listOf("capability.image-generation", "capability.image-editing"),
            modelSettingsModelCapabilityKeys("gpt-image-2"),
        )
        assertEquals(
            listOf("capability.image-generation"),
            modelSettingsModelCapabilityKeys("dall-e-3"),
        )
        assertEquals(
            "Audio transcription",
            modelSettingsModelCapabilitySummary("gpt-4o-transcribe") { labels.getValue(it) },
        )
        assertEquals(
            "Chat / Audio",
            modelSettingsModelCapabilitySummary("gpt-4o-audio-preview") { labels.getValue(it) },
        )
        assertEquals(
            "Embeddings",
            modelSettingsModelCapabilitySummary("text-embedding-3-large") { labels.getValue(it) },
        )
        assertEquals(
            "Realtime voice",
            modelSettingsModelCapabilitySummary("gpt-realtime") { labels.getValue(it) },
        )
        assertEquals(
            "Moderation",
            modelSettingsModelCapabilitySummary("omni-moderation-latest") { labels.getValue(it) },
        )
        val provider = provider(
            "openai",
            model = "gpt-5.5",
            models = listOf(
                "gpt-image-2",
                "text-embedding-3-large",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-4o-audio-preview",
                "gpt-realtime",
                "omni-moderation-latest",
                "gpt-image-2",
            ),
        )
        assertEquals(
            listOf(
                "capability.chat",
                "capability.image-generation",
                "capability.image-editing",
                "capability.audio",
                "capability.audio-speech",
                "capability.audio-transcription",
                "capability.embeddings",
                "capability.moderation",
                "capability.realtime",
            ),
            modelSettingsProviderCapabilityKeys(provider),
        )
        assertEquals(
            "Chat / Image generation / Image editing / Audio / Text to speech / Audio transcription / Embeddings / Moderation / Realtime voice",
            modelSettingsProviderCapabilitySummary(provider) { labels.getValue(it) },
        )
    }

    @Test
    fun modelSettingsProviderCapabilityKeysIgnoreStaleFieldsOutsideCatalog() {
        val provider = provider(
            "openai",
            model = "gpt-5.5",
            models = listOf("gpt-5.5"),
            imageModel = "gpt-image-2",
        )

        assertEquals(
            listOf("capability.chat"),
            modelSettingsProviderCapabilityKeys(provider),
        )
    }

    @Test
    fun modelSettingsApplyModelsDeduplicatesAndFillsBlankDefaultModel() {
        val provider = provider("openai", model = "", models = listOf("gpt-4o"))

        val updated = modelSettingsApplyModels(
            provider,
            models = listOf("gpt-4o", "gpt-4.1", "gpt-4.1-mini"),
            now = 42,
        )

        assertEquals(listOf("gpt-4o", "gpt-4.1", "gpt-4.1-mini"), updated.models)
        assertEquals("gpt-4o", updated.model)
        assertEquals(42, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyModelsFillsBlankDefaultFromExistingModelsWhenFetchIsEmpty() {
        val provider = provider("openai", model = "", models = listOf("gpt-4o", "gpt-4.1"))

        val updated = modelSettingsApplyModels(provider, models = emptyList(), now = 43)

        assertEquals(listOf("gpt-4o", "gpt-4.1"), updated.models)
        assertEquals("gpt-4o", updated.model)
        assertEquals(43, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyConfiguredModelsRepairsRemovedCapabilityDefaults() {
        val provider = provider(
            "openai",
            model = "gpt-5.4-mini",
            models = listOf(
                "gpt-5.4-mini",
                "gpt-image-1",
                "tts-1",
                "whisper-1",
                "text-embedding-3-small",
                "moderation-latest",
                "gpt-realtime",
            ),
            imageModel = "gpt-image-1",
        ).copy(
            audioSpeechModel = "tts-1",
            audioTranscriptionModel = "whisper-1",
            embeddingModel = "text-embedding-3-small",
            moderationModel = "moderation-latest",
            realtimeModel = "gpt-realtime",
        )

        val updated = modelSettingsApplyConfiguredModels(
            provider,
            models = listOf(
                "gpt-5.5",
                "gpt-image-2",
                "gpt-4o-mini-tts",
                "gpt-4o-transcribe",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "gpt-realtime-2",
            ),
            now = 49,
        )

        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals("gpt-4o-mini-tts", updated.audioSpeechModel)
        assertEquals("gpt-4o-transcribe", updated.audioTranscriptionModel)
        assertEquals("text-embedding-3-large", updated.embeddingModel)
        assertEquals("omni-moderation-latest", updated.moderationModel)
        assertEquals("gpt-realtime-2", updated.realtimeModel)
        assertEquals(49, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyFetchedModelsReplacesStaleCatalogAndInfersDefaults() {
        val provider = provider(
            "openai",
            model = "gpt-4.1-mini",
            models = listOf("legacy-model", "gpt-4.1-mini"),
            imageModel = "dall-e-3",
        ).copy(capabilities = listOf("chat", "model-list"))

        val updated = modelSettingsApplyFetchedModels(
            provider,
            models = listOf(
                "gpt-5.5-openai-compact",
                "gpt-5.5",
                "gpt-image-2",
                "text-embedding-3-large",
                "gpt-realtime",
            ),
            now = 44,
        )

        assertEquals(
            listOf(
                "gpt-5.5-openai-compact",
                "gpt-5.5",
                "gpt-image-2",
                "text-embedding-3-large",
                "gpt-realtime",
            ),
            updated.models,
        )
        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals(
            listOf(
                "chat",
                "model-list",
                "image-generation",
                "image-editing",
                "embeddings",
                "realtime",
            ),
            updated.capabilities,
        )
        assertEquals(44, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyFetchedModelsToSnapshotRejectsResultAfterProviderEndpointReplacement() {
        val fetchedFor = provider(
            "openai",
            model = "legacy-model",
            models = listOf("legacy-model"),
        )
        val latest = fetchedFor.copy(baseUrl = "https://edited.example/v1")
        val current = AppSnapshot(providers = listOf(latest))

        val updated = modelSettingsApplyFetchedModelsToSnapshot(
            current,
            providerId = fetchedFor.id,
            models = listOf("gpt-5.5"),
            now = 46,
            expectedOwner = ModelSettingsFetchOwner(fetchedFor, "old-key", "old-proxy"),
            currentOwner = ModelSettingsFetchOwner(latest, "old-key", "old-proxy"),
        )

        assertEquals(current, updated)
    }

    @Test
    fun modelSettingsFetchOwnerRejectsCredentialRotation() {
        val provider = provider("openai", model = "legacy-model")
        val owner = ModelSettingsFetchOwner(provider, "old-key", "old-proxy")

        assertFalse(
            modelSettingsFetchOwnerMatches(
                owner,
                owner.copy(apiKey = "new-key"),
            ),
        )
        assertFalse(
            modelSettingsFetchOwnerMatches(
                owner,
                owner.copy(proxyToken = "new-proxy"),
            ),
        )
    }

    @Test
    fun modelSettingsFetchOwnerRejectsSameIdProviderRecreationButIgnoresDisplayOnlyEdits() {
        val provider = provider("openai", model = "legacy-model")
        val owner = ModelSettingsFetchOwner(provider, "key", "proxy")

        assertFalse(
            modelSettingsFetchOwnerMatches(
                owner,
                owner.copy(requestProvider = provider.copy(createdAt = 2)),
            ),
        )
        assertTrue(
            modelSettingsFetchOwnerMatches(
                owner,
                owner.copy(
                    requestProvider = provider.copy(
                        name = "Renamed",
                        model = "new-selection",
                        updatedAt = provider.updatedAt + 1,
                    ),
                ),
            ),
        )
    }

    @Test
    fun modelSettingsApplyFetchedModelsRefreshesAdvancedCapabilityDefaults() {
        val provider = provider(
            "openai",
            model = "gpt-5.4-mini",
            models = listOf(
                "gpt-5.4-mini",
                "gpt-image-1",
                "tts-1",
                "gpt-4o-transcribe",
                "whisper-1",
                "text-embedding-3-small",
                "moderation-latest",
                "gpt-realtime",
            ),
            imageModel = "gpt-image-1",
        ).copy(
            audioSpeechModel = "tts-1",
            audioTranscriptionModel = "whisper-1",
            embeddingModel = "text-embedding-3-small",
            moderationModel = "moderation-latest",
            realtimeModel = "gpt-realtime",
        )

        val updated = modelSettingsApplyFetchedModels(
            provider,
            models = listOf(
                "gpt-5.5",
                "gpt-image-2",
                "gpt-4o-mini-tts",
                "gpt-4o-transcribe",
                "whisper-1",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "gpt-realtime-2",
            ),
            now = 48,
        )

        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals("gpt-4o-mini-tts", updated.audioSpeechModel)
        assertEquals("whisper-1", updated.audioTranscriptionModel)
        assertEquals("text-embedding-3-large", updated.embeddingModel)
        assertEquals("omni-moderation-latest", updated.moderationModel)
        assertEquals("gpt-realtime-2", updated.realtimeModel)
        assertEquals(48, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyFetchedModelsKeepsExistingCatalogWhenFetchIsEmpty() {
        val provider = provider(
            "openai",
            model = "",
            models = listOf("gpt-5.5", "gpt-image-2"),
            imageModel = null,
        )

        val updated = modelSettingsApplyFetchedModels(provider, models = emptyList(), now = 45)

        assertEquals(listOf("gpt-5.5", "gpt-image-2"), updated.models)
        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals(45, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyFetchedModelsUpgradesAutomaticDefaultsToBestFetchedModels() {
        val provider = provider(
            "openai",
            model = "gpt-5.4-mini",
            models = listOf("gpt-5.4-mini", "gpt-image-1"),
            imageModel = "gpt-image-1",
        )

        val updated = modelSettingsApplyFetchedModels(
            provider,
            models = listOf("gpt-5.4-mini", "gpt-5.5", "gpt-image-1", "gpt-image-2"),
            now = 46,
        )

        assertEquals(listOf("gpt-5.4-mini", "gpt-5.5", "gpt-image-1", "gpt-image-2"), updated.models)
        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals(46, updated.updatedAt)
    }

    @Test
    fun modelSettingsApplyFetchedModelsPreservesExplicitLightweightSelections() {
        val provider = provider(
            "openai",
            model = "gpt-5.4-mini",
            models = listOf("gpt-5.5", "gpt-5.4-mini", "gpt-image-2", "gpt-image-1"),
            imageModel = "gpt-image-1",
        )

        val updated = modelSettingsApplyFetchedModels(
            provider,
            models = listOf("gpt-5.6", "gpt-5.4-mini", "gpt-image-2", "gpt-image-1"),
            now = 47,
        )

        assertEquals(listOf("gpt-5.6", "gpt-5.4-mini", "gpt-image-2", "gpt-image-1"), updated.models)
        assertEquals("gpt-5.4-mini", updated.model)
        assertEquals("gpt-image-1", updated.imageModel)
        assertEquals(47, updated.updatedAt)
    }

    @Test
    fun modelSettingsFetchBlockerRequiresProviderKeyBeforeNetworkFetch() {
        val keyedProvider = provider("keyed", model = "gpt-4o")
        val keylessProvider = provider("keyless", model = "relay-model").copy(needsApiKey = false)

        assertEquals(
            "error.providerKeyRequired",
            modelSettingsFetchBlockerKey(keyedProvider, ""),
        )
        assertNull(modelSettingsFetchBlockerKey(keyedProvider, "sk-test"))
        assertNull(modelSettingsFetchBlockerKey(keylessProvider, ""))
        assertNotNull(modelSettingsFetchBlockerKey(keyedProvider, "   "))
    }

    @Test
    fun modelSettingsMoveModelReordersOnlyValidIndexes() {
        val models = listOf("a", "b", "c")

        assertEquals(listOf("b", "a", "c"), modelSettingsMoveModel(models, 1, 0))
        assertSame(models, modelSettingsMoveModel(models, -1, 0))
        assertSame(models, modelSettingsMoveModel(models, 0, 4))
    }

    @Test
    fun modelSettingsRemoveModelRepairsChatAndImageDefaults() {
        val provider = provider(
            "openai",
            model = "b",
            models = listOf("a", "b", "c"),
            imageModel = "b",
        )

        val updated = modelSettingsRemoveModel(provider, "b", now = 77)

        assertEquals(listOf("a", "c"), updated.models)
        assertEquals("a", updated.model)
        assertNull(updated.imageModel)
        assertEquals(77, updated.updatedAt)
    }

    @Test
    fun modelSettingsSelectionHelpersPersistChatAndOptionalImageModel() {
        val provider = provider("openai", model = "a", models = listOf("a", "b"))

        val chat = modelSettingsSelectChatModel(provider, "b", now = 12)
        val image = modelSettingsSelectImageModel(provider, "gpt-image-2", now = 13)
        val clearedImage = modelSettingsSelectImageModel(provider.copy(imageModel = "gpt-image-2"), "", now = 14)

        assertEquals("b", chat.model)
        assertEquals(12, chat.updatedAt)
        assertEquals("gpt-image-2", image.imageModel)
        assertEquals(13, image.updatedAt)
        assertNull(clearedImage.imageModel)
        assertEquals(14, clearedImage.updatedAt)
    }

    @Test
    fun modelSettingsReplaceProviderTouchesOnlyTheMatchingProvider() {
        val old = provider("old", model = "old-model")
        val current = provider("current", model = "current-model")
        val replacement = current.copy(model = "new-model")

        val providers = modelSettingsReplaceProvider(listOf(old, current), replacement)

        assertSame(old, providers.first())
        assertEquals("new-model", providers.last().model)
    }

    @Test
    fun modelSettingsStableSelectedProviderIdSurvivesProviderListReplacement() {
        val old = provider("old", model = "old-model")
        val selected = provider("selected", model = "current-model")
        val refreshedSelected = selected.copy(model = "new-model", updatedAt = 99)

        assertEquals(
            "selected",
            modelSettingsStableSelectedProviderId("selected", listOf(old, refreshedSelected)),
        )
        assertEquals(
            "old",
            modelSettingsStableSelectedProviderId("deleted", listOf(old, refreshedSelected)),
        )
        assertEquals("", modelSettingsStableSelectedProviderId("deleted", emptyList()))
    }

    private fun provider(
        id: String,
        model: String,
        models: List<String> = listOf(model),
        imageModel: String? = null,
    ): ProviderConfig = ProviderConfig(
        id = id,
        name = id,
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.com/v1",
        model = model,
        imageModel = imageModel,
        models = models,
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )
}
