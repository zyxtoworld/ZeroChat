package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.NativeI18n
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProviderSettingsHelpersTest {
    @Test
    fun providerEditActionDescriptionDistinguishesProviderButtons() {
        assertEquals(
            "Edit provider: OpenAI",
            providerEditActionDescription("Edit provider", "OpenAI"),
        )
        assertEquals(
            "Editar proveedor: OpenAI",
            providerEditActionDescription(" Editar proveedor ", " OpenAI "),
        )
    }

    @Test
    fun providerSettingsIsConnectedRequiresEnabledProviderAndKeyOnlyWhenNeeded() {
        val keyedProvider = provider("keyed", needsApiKey = true)
        val keylessProvider = provider("keyless", needsApiKey = false)

        assertFalse(providerSettingsIsConnected(keyedProvider, ""))
        assertTrue(providerSettingsIsConnected(keyedProvider, "sk-test"))
        assertTrue(providerSettingsIsConnected(keylessProvider, ""))
        assertFalse(providerSettingsIsConnected(keylessProvider.copy(enabled = false), "sk-test"))
    }

    @Test
    fun providerSettingsExpandedProviderIdKeepsVisibleRequestAndFallsBackToEnabledProvider() {
        val enabled = provider("enabled")
        val visible = provider("visible")
        val hiddenDisabled = provider("hidden-disabled", enabled = false)
        val sortedProviders = listOf(enabled, visible, hiddenDisabled)

        assertEquals(
            visible.id,
            providerSettingsExpandedProviderId(
                sortedProviders = sortedProviders,
                visibleProviders = listOf(enabled, visible),
                requestedProviderId = visible.id,
            ),
        )
        assertEquals(
            enabled.id,
            providerSettingsExpandedProviderId(
                sortedProviders = sortedProviders,
                visibleProviders = listOf(enabled, visible),
                requestedProviderId = hiddenDisabled.id,
            ),
        )
        assertEquals(
            hiddenDisabled.id,
            providerSettingsExpandedProviderId(
                sortedProviders = listOf(hiddenDisabled),
                visibleProviders = emptyList(),
                requestedProviderId = "missing",
            ),
        )
        assertEquals(
            "",
            providerSettingsExpandedProviderId(
                sortedProviders = emptyList(),
                visibleProviders = emptyList(),
                requestedProviderId = "missing",
            ),
        )
    }

    @Test
    fun providerSettingsConnectivityBlockerRequiresProviderKeyBeforeNetworkChecks() {
        val keyedProvider = provider("keyed", needsApiKey = true)
        val keylessProvider = provider("keyless", needsApiKey = false)

        assertEquals(
            "error.providerKeyRequired",
            providerSettingsConnectivityBlockerKey(keyedProvider, ""),
        )
        assertNull(providerSettingsConnectivityBlockerKey(keyedProvider, "sk-test"))
        assertNull(providerSettingsConnectivityBlockerKey(keylessProvider, ""))
    }

    @Test
    fun providerSettingsReplaceProviderTouchesOnlyTheMatchingProvider() {
        val old = provider("old")
        val current = provider("current", model = "old-model")
        val replacement = current.copy(model = "new-model")

        val providers = providerSettingsReplaceProvider(listOf(old, current), replacement)

        assertSame(old, providers.first())
        assertEquals("new-model", providers.last().model)
    }

    @Test
    fun providerSettingsCanDisableProviderProtectsFinalEnabledProvider() {
        val enabled = provider("enabled")
        val disabled = provider("disabled", enabled = false)

        assertFalse(providerSettingsCanDisableProvider(AppSnapshot(providers = listOf(enabled)), enabled.id))
        assertTrue(
            providerSettingsCanDisableProvider(
                AppSnapshot(providers = listOf(enabled, provider("fallback"))),
                enabled.id,
            ),
        )
        assertTrue(
            providerSettingsCanDisableProvider(
                AppSnapshot(providers = listOf(enabled, disabled)),
                disabled.id,
            ),
        )
    }

    @Test
    fun providerSettingsApplyProviderChangeMigratesConversationsWhenProviderIsDisabled() {
        val disabled = provider("disabled", enabled = false)
        val fallback = provider("fallback", model = "fallback-model")
        val current = provider("current", model = "current-model")
        val kept = conversation("kept", providerId = fallback.id, model = fallback.model, updatedAt = 4)
        val repaired = conversation("repaired", providerId = current.id, model = current.model, updatedAt = 5)
        val snapshot = AppSnapshot(
            providers = listOf(current, disabled, fallback),
            conversations = listOf(kept, repaired),
        )

        val updated = providerSettingsApplyProviderChange(
            snapshot = snapshot,
            updated = current.copy(enabled = false, updatedAt = 99),
            fallbackModelForProvider = { "${it.id}-chat" },
            now = 99,
        )

        assertEquals(listOf(current.copy(enabled = false, updatedAt = 99), disabled, fallback), updated.providers)
        assertSame(kept, updated.conversations.first())
        assertEquals("fallback", updated.conversations.last().providerId)
        assertEquals("fallback-chat", updated.conversations.last().model)
        assertEquals(99, updated.conversations.last().updatedAt)
    }

    @Test
    fun providerSettingsApplyConnectivityModelsUsesFetchedListAsAuthoritative() {
        val provider = provider(
            "custom",
            model = "legacy-model",
            models = listOf("legacy-model", "gpt-4o"),
        )

        val updated = providerSettingsApplyConnectivityModels(
            provider = provider,
            models = listOf("gpt-4o", "gpt-5.5", "gpt-image-2"),
            now = 42,
        )

        assertEquals(listOf("gpt-4o", "gpt-5.5", "gpt-image-2"), updated.models)
        assertEquals("gpt-5.5", updated.model)
        assertEquals("gpt-image-2", updated.imageModel)
        assertEquals(42, updated.updatedAt)
    }

    @Test
    fun providerSettingsApplyConnectivityModelsToSnapshotUsesTheLatestProviderRecordWhenOwnerMatches() {
        val fetchedFor = provider(
            "custom",
            model = "legacy-model",
            models = listOf("legacy-model"),
        )
        val latest = fetchedFor.copy(name = "Renamed provider")
        val current = AppSnapshot(providers = listOf(latest))

        val updated = providerSettingsApplyConnectivityModelsToSnapshot(
            snapshot = current,
            providerId = fetchedFor.id,
            models = listOf("gpt-5.5"),
            now = 43,
            expectedOwner = ModelSettingsFetchOwner(
                requestProvider = fetchedFor,
                apiKey = "old-key",
                proxyToken = "old-proxy",
            ),
            currentOwner = ModelSettingsFetchOwner(
                requestProvider = latest,
                apiKey = "old-key",
                proxyToken = "old-proxy",
            ),
        )

        assertEquals("Renamed provider", updated.providers.single().name)
        assertEquals(listOf("gpt-5.5"), updated.providers.single().models)
        assertEquals(43, updated.providers.single().updatedAt)
    }

    @Test
    fun providerSettingsConnectivityResultIsRejectedAfterEndpointReplacement() {
        val fetchedFor = provider(
            "custom",
            model = "legacy-model",
            models = listOf("legacy-model"),
        )
        val latest = fetchedFor.copy(baseUrl = "https://edited.example/v1")
        val current = AppSnapshot(providers = listOf(latest))

        val updated = providerSettingsApplyConnectivityModelsToSnapshot(
            snapshot = current,
            providerId = fetchedFor.id,
            models = listOf("gpt-5.5"),
            now = 43,
            expectedOwner = ModelSettingsFetchOwner(
                requestProvider = fetchedFor,
                apiKey = "old-key",
                proxyToken = "old-proxy",
            ),
            currentOwner = ModelSettingsFetchOwner(
                requestProvider = latest,
                apiKey = "old-key",
                proxyToken = "old-proxy",
            ),
        )

        assertEquals(current, updated)
    }

    @Test
    fun providerConnectivityFailureNoticeDoesNotExposeRawExceptionText() {
        val sentinel =
            "C:\\private\\provider\\config.json /home/runner/.config/token " +
                "https://provider.invalid/v1 sk-test-not-a-real-key"

        val notice = providerConnectivityFailureNotice(
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
    fun providerSettingsCapabilitySummaryOrdersLabelsAndKeepsUnknownCapabilities() {
        val provider = provider(
            "custom",
            capabilities = listOf(
                "model-list",
                "audio",
                "unknown-preview",
                "chat",
                "audio",
                "image-generation",
            ),
        )
        val labels = mapOf(
            "capability.audio" to "Audio",
            "capability.chat" to "Chat",
            "capability.image-generation" to "Image generation",
            "capability.model-list" to "Model list",
        )

        assertEquals(
            listOf("chat", "image-generation", "audio", "model-list", "unknown-preview"),
            providerSettingsCapabilities(provider),
        )
        assertEquals(
            "Chat / Image generation / Audio / Model list / unknown-preview",
            providerSettingsCapabilitySummary(provider) { key -> labels[key] ?: key },
        )
    }

    @Test
    fun providerSettingsEndpointSummaryMirrorsProviderCapabilities() {
        val fullProvider = provider(
            "full",
            kind = ProviderKind.OpenAIResponses,
            models = listOf(
                "gpt-5.4-mini",
                "gpt-image-2",
                "tts-1",
                "gpt-4o-transcribe",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "gpt-realtime",
            ),
            capabilities = listOf(
                "chat",
                "image-generation",
                "image-editing",
                "audio",
                "realtime",
                "embeddings",
                "moderation",
                "model-list",
            ),
        )
        val anthropicProvider = provider("anthropic", kind = ProviderKind.Anthropic)
        val compatibleProvider = provider("compatible", capabilities = emptyList())
        val capabilityOnlyProvider = provider(
            "capability-only",
            models = listOf("gpt-5.4-mini"),
            capabilities = listOf(
                "chat",
                "image-generation",
                "image-editing",
                "embeddings",
                "moderation",
                "realtime",
                "model-list",
            ),
        )
        val imageProvider = provider(
            "image",
            models = listOf("gpt-5.4-mini", "gpt-image-2"),
            capabilities = listOf("chat", "image-generation", "image-editing", "model-list"),
        )
        val genericAudioProvider = provider(
            "generic-audio",
            models = listOf("gpt-5.4-mini", "gpt-4o-audio-preview"),
            capabilities = listOf("chat", "audio", "model-list"),
        )
        val speechOnlyProvider = provider(
            "speech",
            models = listOf("gpt-5.4-mini", "tts-1"),
            capabilities = listOf("chat", "audio", "model-list"),
        )
        val transcriptionOnlyProvider = provider(
            "transcription",
            models = listOf("gpt-5.4-mini", "gpt-4o-transcribe"),
            capabilities = listOf("chat", "audio", "model-list"),
        )

        assertEquals(
            listOf(
                "/responses",
                "/models",
                "/images/generations",
                "/images/edits",
                "/audio/speech",
                "/audio/transcriptions",
                "/realtime",
                "/realtime/client_secrets",
                "/embeddings",
                "/moderations",
            ),
            providerSettingsEndpointLabels(fullProvider),
        )
        assertEquals("/messages / /models", providerSettingsEndpointSummary(anthropicProvider))
        assertEquals(
            "/chat/completions / /models",
            providerSettingsEndpointSummary(compatibleProvider),
        )
        assertEquals(
            listOf("/chat/completions", "/models"),
            providerSettingsEndpointLabels(capabilityOnlyProvider),
        )
        assertEquals(
            listOf("/chat/completions", "/models", "/images/generations", "/images/edits"),
            providerSettingsEndpointLabels(imageProvider),
        )
        assertEquals(
            listOf("/chat/completions", "/models"),
            providerSettingsEndpointLabels(genericAudioProvider),
        )
        assertEquals(
            listOf("/chat/completions", "/models", "/audio/speech"),
            providerSettingsEndpointLabels(speechOnlyProvider),
        )
        assertEquals(
            listOf("/chat/completions", "/models", "/audio/transcriptions"),
            providerSettingsEndpointLabels(transcriptionOnlyProvider),
        )
    }

    @Test
    fun providerSettingsCapabilityReadinessReportsMissingEndpointModels() {
        val missingModelsProvider = provider(
            "missing",
            models = listOf("gpt-5.4-mini"),
            capabilities = listOf(
                "chat",
                "audio",
                "embeddings",
                "moderation",
                "realtime",
                "model-list",
            ),
        )
        val readyProvider = missingModelsProvider.copy(
            models = listOf(
                "gpt-5.4-mini",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-realtime",
            ),
        )
        val labels = mapOf(
            "capability.embeddings" to "Embeddings",
            "capability.moderation" to "Moderation",
            "capability.audio-speech" to "Speech",
            "capability.audio-transcription" to "Transcription",
            "capability.realtime" to "Realtime",
            "settings.capabilityReadinessMissing" to "Missing: {capabilities}",
            "settings.capabilityReadinessReady" to "Models covered",
        )

        assertEquals(
            listOf("embeddings", "moderation", "audio-speech", "audio-transcription", "realtime"),
            providerSettingsCapabilityChecks(missingModelsProvider),
        )
        assertEquals(
            listOf("embeddings", "moderation", "audio-speech", "audio-transcription", "realtime"),
            providerSettingsMissingCapabilityModelKeys(missingModelsProvider),
        )
        assertEquals(
            "Missing: Embeddings / Moderation / Speech / Transcription / Realtime",
            providerSettingsCapabilityReadinessSummary(missingModelsProvider) { key -> labels[key] ?: key },
        )
        assertEquals(emptyList<String>(), providerSettingsMissingCapabilityModelKeys(readyProvider))
        assertEquals(
            "Models covered",
            providerSettingsCapabilityReadinessSummary(readyProvider) { key -> labels[key] ?: key },
        )
    }

    @Test
    fun providerSettingsDeleteProviderRemovesProviderAndRepairsDeletedConversations() {
        val deleted = provider("deleted", model = "deleted-model")
        val fallback = provider("fallback", model = "fallback-model")
        val kept = conversation("kept", providerId = fallback.id, model = fallback.model, updatedAt = 4)
        val repaired = conversation("repaired", providerId = deleted.id, model = deleted.model, updatedAt = 5)

        val snapshot = AppSnapshot(
            providers = listOf(deleted, fallback),
            conversations = listOf(kept, repaired),
        )

        val updated = providerSettingsDeleteProvider(
            snapshot = snapshot,
            deletedProviderId = deleted.id,
            fallbackModelForProvider = { "${it.id}-chat" },
            now = 99,
        )

        assertEquals(listOf(fallback), updated.providers)
        assertSame(kept, updated.conversations.first())
        assertEquals("fallback", updated.conversations.last().providerId)
        assertEquals("fallback-chat", updated.conversations.last().model)
        assertEquals(99, updated.conversations.last().updatedAt)
    }

    @Test
    fun providerSettingsDeleteProviderPrefersEnabledFallbackProvider() {
        val deleted = provider("deleted", model = "deleted-model")
        val disabledFallback = provider("disabled", model = "disabled-model", enabled = false)
        val enabledFallback = provider("enabled", model = "enabled-model")
        val repaired = conversation("repaired", providerId = deleted.id, model = deleted.model, updatedAt = 5)

        val snapshot = AppSnapshot(
            providers = listOf(deleted, disabledFallback, enabledFallback),
            conversations = listOf(repaired),
        )

        val updated = providerSettingsDeleteProvider(
            snapshot = snapshot,
            deletedProviderId = deleted.id,
            fallbackModelForProvider = { "${it.id}-chat" },
            now = 99,
        )

        assertEquals(listOf(disabledFallback, enabledFallback), updated.providers)
        assertEquals("enabled", updated.conversations.single().providerId)
        assertEquals("enabled-chat", updated.conversations.single().model)
        assertEquals(99, updated.conversations.single().updatedAt)
    }

    @Test
    fun providerSettingsDeleteProviderKeepsSnapshotWhenNoFallbackProviderExists() {
        val onlyProvider = provider("only")
        val snapshot = AppSnapshot(providers = listOf(onlyProvider))

        val updated = providerSettingsDeleteProvider(
            snapshot = snapshot,
            deletedProviderId = onlyProvider.id,
            fallbackModelForProvider = { it.model },
            now = 10,
        )

        assertSame(snapshot, updated)
    }

    private fun provider(
        id: String,
        model: String = "$id-model",
        models: List<String> = listOf(model),
        kind: ProviderKind = ProviderKind.OpenAICompatible,
        capabilities: List<String> = emptyList(),
        needsApiKey: Boolean = true,
        enabled: Boolean = true,
    ): ProviderConfig = ProviderConfig(
        id = id,
        name = id,
        kind = kind,
        baseUrl = "https://api.example.com/v1",
        model = model,
        models = models,
        capabilities = capabilities,
        enabled = enabled,
        needsApiKey = needsApiKey,
        createdAt = 1,
        updatedAt = 1,
    )

    private fun conversation(
        id: String,
        providerId: String,
        model: String,
        updatedAt: Long,
    ): Conversation = Conversation(
        id = id,
        title = id,
        providerId = providerId,
        model = model,
        messages = emptyList(),
        createdAt = 1,
        updatedAt = updatedAt,
    )
}
