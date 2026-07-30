package app.zerochat.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProviderRegistryTest {
    @Test
    fun normalizeOfficialProviderContractsDoesNotLowerSnapshotUpdatedAt() {
        val futureUpdatedAt = System.currentTimeMillis() + 86_400_000L
        val snapshot = AppSnapshot(
            providers = listOf(
                ProviderConfig(
                    id = "openai",
                    name = "OpenAI",
                    kind = ProviderKind.OpenAICompatible,
                    baseUrl = "https://api.openai.com/v1",
                    model = "gpt-5.4-mini",
                    imageModel = null,
                    models = listOf("gpt-5.4-mini"),
                    capabilities = listOf("chat"),
                    enabled = true,
                    needsApiKey = false,
                    custom = false,
                    createdAt = 1L,
                    updatedAt = 1L,
                ),
            ),
            updatedAt = futureUpdatedAt,
        )

        val normalized = normalizeOfficialProviderContracts(snapshot)

        assertEquals(futureUpdatedAt, normalized.updatedAt)
        assertTrue(normalized.providers.single().updatedAt >= snapshot.providers.single().updatedAt)
        assertEquals(ProviderKind.OpenAIResponses, normalized.providers.single().kind)
    }

    @Test
    fun defaultOfficialProviderIncludesAdvancedCapabilityModels() {
        val openai = defaultProviderConfigs("Custom relay").first { it.id == "openai" }

        assertEquals("gpt-4o-mini-tts", openai.audioSpeechModel)
        assertEquals("gpt-4o-transcribe", openai.audioTranscriptionModel)
        assertEquals("text-embedding-3-large", openai.embeddingModel)
        assertEquals("omni-moderation-latest", openai.moderationModel)
        assertEquals("gpt-realtime-2", openai.realtimeModel)
        assertTrue(openai.models.containsAll(
            listOf(
                "gpt-4o-mini-tts",
                "gpt-4o-transcribe",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "gpt-realtime-2",
            ),
        ))
    }

    @Test
    fun normalizeOfficialProviderContractsPreservesValidAdvancedModels() {
        val provider = defaultProviderConfigs("Custom relay")
            .first { it.id == "openai" }
            .copy(
                audioSpeechModel = "tts-1-hd",
                audioTranscriptionModel = "whisper-1",
                embeddingModel = "text-embedding-3-small",
                moderationModel = "omni-moderation-custom",
                realtimeModel = "gpt-realtime-custom",
            )

        val normalized = normalizeOfficialProviderContracts(
            AppSnapshot(providers = listOf(provider), updatedAt = 1),
        ).providers.single()

        assertEquals("tts-1-hd", normalized.audioSpeechModel)
        assertEquals("whisper-1", normalized.audioTranscriptionModel)
        assertEquals("text-embedding-3-small", normalized.embeddingModel)
        assertEquals("omni-moderation-custom", normalized.moderationModel)
        assertEquals("gpt-realtime-custom", normalized.realtimeModel)
        assertTrue(normalized.models.containsAll(
            listOf(
                "tts-1-hd",
                "whisper-1",
                "text-embedding-3-small",
                "omni-moderation-custom",
                "gpt-realtime-custom",
            ),
        ))
    }

    @Test
    fun selectableModelsTreatFetchedListsAsAuthoritative() {
        val provider = provider(
            model = "gpt-4.1-mini",
            imageModel = "dall-e-3",
            models = listOf("gpt-5.5", "gpt-image-2"),
        )

        assertEquals(listOf("gpt-5.5"), chatModelsForProvider(provider))
        assertEquals(listOf("gpt-image-2"), imageModelsForProvider(provider))
        assertEquals("gpt-5.5", defaultChatModelForProvider(provider))
        assertEquals("gpt-image-2", imageModelForProvider(provider))
    }

    @Test
    fun modelHelpersFallBackToSavedDefaultsOnlyWhenModelListIsEmpty() {
        val provider = provider(
            model = "gpt-5.5",
            imageModel = "gpt-image-2",
            models = emptyList(),
        )

        assertEquals(listOf("gpt-5.5"), chatModelsForProvider(provider))
        assertEquals(listOf("gpt-image-2"), imageModelsForProvider(provider))
    }

    @Test
    fun dallE3RemainsGenerationOnlyWhileEditingUsesACompatibleCandidate() {
        val configured = provider(
            model = "gpt-5.5",
            imageModel = "dall-e-3",
            models = listOf("gpt-5.5", "dall-e-3", "gpt-image-1"),
        )

        assertTrue(isLikelyImageModel("dall-e-3"))
        assertFalse(isLikelyImageEditingModel("dall-e-3"))
        assertTrue(isLikelyImageEditingModel("gpt-image-1"))
        assertEquals(listOf("gpt-image-1"), imageEditingModelsForProvider(configured))
        assertEquals(
            "dall-e-3",
            modelForProviderCapability(configured, ProviderModelCapability.ImageGeneration),
        )
        assertEquals(
            "gpt-image-1",
            modelForProviderCapability(configured, ProviderModelCapability.ImageEditing),
        )
        assertFalse(
            capabilitiesForModelList(configured, listOf("dall-e-3"))
                .contains("image-editing"),
        )
    }

    @Test
    fun preferredChatModelPrefersAdvancedFetchedModelsOverCompactVariants() {
        val models = listOf(
            "gpt-5.5-openai-compact",
            "gpt-5.2",
            "gpt-5.5",
            "gpt-5.5-auto-review",
        )

        assertEquals("gpt-5.5", preferredChatModel(models))
        assertTrue(chatModelPreferenceScore("gpt-5.5") > chatModelPreferenceScore("gpt-5.2"))
        assertTrue(
            chatModelPreferenceScore("gpt-5.5") >
            chatModelPreferenceScore("gpt-5.5-openai-compact"),
        )
    }

    @Test
    fun preferredChatModelTreatsHyphenatedGptVersionsAsNewerRevisions() {
        val models = listOf(
            "auto",
            "gpt-5",
            "gpt-5-1",
            "gpt-5-2",
            "gpt-5-3",
            "gpt-5-3-mini",
            "gpt-5-5",
            "gpt-5-mini",
            "gpt-5.3-codex-spark",
            "gpt-image-2",
        )

        assertEquals("gpt-5-5", preferredChatModel(models))
        assertTrue(chatModelPreferenceScore("gpt-5-5") > chatModelPreferenceScore("gpt-5-3"))
        assertTrue(chatModelPreferenceScore("gpt-5-5") > chatModelPreferenceScore("gpt-5"))
    }

    @Test
    fun preferredChatModelPrefersHighCapabilityVariantsWithoutTreatingDatesAsRevisions() {
        val models = listOf(
            "gpt-5.5-mini",
            "gpt-5.5",
            "gpt-5.5-reasoning",
            "gpt-5.5-pro",
        )

        assertEquals("gpt-5.5-pro", preferredChatModel(models))
        assertTrue(chatModelPreferenceScore("gpt-5.5-pro") > chatModelPreferenceScore("gpt-5.5-reasoning"))
        assertTrue(chatModelPreferenceScore("gpt-5.5-reasoning") > chatModelPreferenceScore("gpt-5.5"))
        assertTrue(chatModelPreferenceScore("gpt-4.2") > chatModelPreferenceScore("gpt-4.1-2025-04-14"))
    }

    @Test
    fun preferredChatModelPrefersFrontierRelayVariantsWhenNumericRevisionsTie() {
        val models = listOf("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol")

        assertEquals("gpt-5.6-sol", preferredChatModel(models))
        assertTrue(chatModelPreferenceScore("gpt-5.6-sol") > chatModelPreferenceScore("gpt-5.6-terra"))
        assertTrue(chatModelPreferenceScore("gpt-5.6-terra") > chatModelPreferenceScore("gpt-5.6-luna"))
    }

    @Test
    fun chatModelForConversationUsesStrongestFetchedModelWhenSavedDefaultsAreStale() {
        val provider = provider(
            model = "gpt-4.1-mini",
            models = listOf("gpt-image-2", "gpt-5.5-openai-compact", "gpt-5.5"),
        )
        val conversation = Conversation(
            id = "conversation",
            title = "Conversation",
            providerId = provider.id,
            model = "gpt-4o-mini",
            messages = emptyList(),
            createdAt = 1,
            updatedAt = 1,
        )

        assertEquals("gpt-5.5", chatModelForConversation(conversation, provider))
    }

    @Test
    fun capabilitiesForModelListInfersProviderCapabilitiesFromFetchedModelFamilies() {
        val provider = provider(
            capabilities = listOf("chat", "model-list"),
            models = emptyList(),
        )

        assertEquals(
            listOf(
                "chat",
                "model-list",
                "image-generation",
                "image-editing",
                "embeddings",
                "audio",
                "realtime",
                "moderation",
            ),
            capabilitiesForModelList(
                provider,
                listOf(
                    "gpt-image-2",
                    "text-embedding-3-large",
                    "gpt-4o-audio-preview",
                    "gpt-realtime",
                    "omni-moderation-latest",
                ),
            ),
        )
    }

    @Test
    fun preferredCapabilityModelsPickStrongFetchedModelFamilies() {
        val models = listOf(
            "embedding-lite",
            "text-embedding-3-large",
            "tts-1",
            "gpt-4o-transcribe",
            "gpt-audio-1.5",
            "gpt-4o-realtime-preview",
            "gpt-realtime-2",
            "gpt-realtime",
            "moderation-latest",
            "omni-moderation-latest",
        )

        assertTrue(isLikelyEmbeddingModel("text-embedding-3-large"))
        assertTrue(isLikelyAudioModel("gpt-4o-transcribe"))
        assertTrue(isLikelyAudioModel("gpt-4o-audio-preview"))
        assertTrue(isLikelyChatModel("gpt-4o-audio-preview"))
        assertTrue(isLikelyAudioSpeechModel("tts-1"))
        assertFalse(isLikelyAudioSpeechModel("gpt-4o-transcribe"))
        assertFalse(isLikelyAudioSpeechModel("gpt-4o-audio-preview"))
        assertTrue(isLikelyAudioTranscriptionModel("gpt-4o-transcribe"))
        assertFalse(isLikelyAudioTranscriptionModel("tts-1"))
        assertFalse(isLikelyAudioTranscriptionModel("gpt-4o-audio-preview"))
        assertTrue(isLikelyRealtimeModel("gpt-realtime"))
        assertTrue(isLikelyRealtimeModel("gpt-realtime-2"))
        assertTrue(isLikelyRealtimeModel("gpt-audio-1.5"))
        assertFalse(isLikelyRealtimeModel("gpt-4o-audio-preview"))
        assertTrue(isLikelyModerationModel("omni-moderation-latest"))
        assertEquals("text-embedding-3-large", preferredEmbeddingModel(models))
        assertEquals("gpt-4o-transcribe", preferredAudioModel(models))
        assertEquals("tts-1", preferredAudioSpeechModel(models))
        assertEquals("gpt-4o-transcribe", preferredAudioTranscriptionModel(models))
        assertEquals("gpt-4o-audio-preview", preferredAudioModel(listOf("gpt-4o-audio-preview")))
        assertEquals("", preferredAudioSpeechModel(listOf("gpt-4o-audio-preview")))
        assertEquals("", preferredAudioTranscriptionModel(listOf("gpt-4o-audio-preview")))
        assertEquals("gpt-realtime-2", preferredRealtimeModel(models))
        assertEquals("omni-moderation-latest", preferredModerationModel(models))
    }

    @Test
    fun modelForProviderCapabilityUsesCapabilitySpecificModelFamilies() {
        val provider = provider(
            model = "gpt-5.4-mini",
            imageModel = "gpt-image-1",
            models = listOf(
                "gpt-5.5",
                "gpt-5.4-mini",
                "gpt-image-2",
                "gpt-image-1",
                "embedding-lite",
                "text-embedding-3-large",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-4o-audio-preview",
                "gpt-audio-1.5",
                "gpt-4o-realtime-preview",
                "gpt-realtime-2",
                "gpt-realtime",
                "moderation-latest",
                "omni-moderation-latest",
            ),
        )

        assertEquals("gpt-5.4-mini", modelForProviderCapability(provider, ProviderModelCapability.Chat))
        assertEquals(
            "gpt-image-1",
            modelForProviderCapability(provider, ProviderModelCapability.ImageGeneration),
        )
        assertEquals(
            "text-embedding-3-large",
            modelForProviderCapability(provider, ProviderModelCapability.Embeddings),
        )
        assertEquals("gpt-4o-transcribe", modelForProviderCapability(provider, ProviderModelCapability.Audio))
        assertEquals("tts-1", modelForProviderAudioSpeech(provider))
        assertEquals("gpt-4o-transcribe", modelForProviderAudioTranscription(provider))
        assertEquals(
            listOf("tts-1", "gpt-4o-transcribe", "gpt-4o-audio-preview", "gpt-audio-1.5"),
            modelsForProviderCapability(provider, ProviderModelCapability.Audio),
        )
        assertEquals("gpt-realtime-2", modelForProviderCapability(provider, ProviderModelCapability.Realtime))
        assertEquals(
            "omni-moderation-latest",
            modelForProviderCapability(provider, ProviderModelCapability.Moderation),
        )
        assertEquals(
            listOf("embedding-lite", "text-embedding-3-large"),
            modelsForProviderCapability(provider, ProviderModelCapability.Embeddings),
        )
    }

    @Test
    fun configuredModelsTreatListedCatalogAsAuthoritative() {
        val provider = provider(
            models = listOf("gpt-5.5"),
        ).copy(
            imageModel = "gpt-image-1",
            audioSpeechModel = "tts-1",
            audioTranscriptionModel = "whisper-1",
            embeddingModel = "text-embedding-3-large",
            moderationModel = "omni-moderation-latest",
            realtimeModel = "gpt-realtime-2",
        )

        assertEquals(listOf("gpt-5.5"), configuredModelsForProvider(provider))
        assertEquals(
            listOf(
                "gpt-4o",
                "gpt-image-1",
                "tts-1",
                "whisper-1",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "gpt-realtime-2",
            ),
            configuredModelsForProvider(provider.copy(models = emptyList())),
        )
    }

    @Test
    fun audioResolversRejectStaleConfiguredModelsWhenCatalogIsAuthoritative() {
        val provider = provider(
            models = listOf("tts-1", "whisper-1"),
        ).copy(
            audioSpeechModel = "removed-tts",
            audioTranscriptionModel = "removed-transcription",
        )

        assertEquals("tts-1", modelForProviderAudioSpeech(provider))
        assertEquals("whisper-1", modelForProviderAudioTranscription(provider))
    }

    private fun provider(
        model: String = "gpt-4o",
        imageModel: String? = null,
        models: List<String> = listOf(model),
        capabilities: List<String> = emptyList(),
    ): ProviderConfig =
        ProviderConfig(
            id = "provider",
            name = "Provider",
            kind = ProviderKind.OpenAICompatible,
            baseUrl = "https://api.example.com/v1",
            model = model,
            imageModel = imageModel,
            models = models,
            capabilities = capabilities,
            enabled = true,
            needsApiKey = true,
            createdAt = 1,
            updatedAt = 1,
        )
}
