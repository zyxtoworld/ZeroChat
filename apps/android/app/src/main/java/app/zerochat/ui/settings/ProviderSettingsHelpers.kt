package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.ProviderModelCapability
import app.zerochat.data.modelForProviderAudioSpeech
import app.zerochat.data.modelForProviderAudioTranscription
import app.zerochat.data.modelForProviderCapability

private val providerSettingsCapabilityOrder = listOf(
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list",
)

private val providerSettingsFullCapabilityChecks = listOf(
    "embeddings",
    "moderation",
    "audio-speech",
    "audio-transcription",
    "realtime",
)

fun providerSettingsIsConnected(provider: ProviderConfig, apiKey: String): Boolean =
    provider.enabled && (!provider.needsApiKey || apiKey.isNotBlank())

internal fun providerSettingsExpandedProviderId(
    sortedProviders: List<ProviderConfig>,
    visibleProviders: List<ProviderConfig>,
    requestedProviderId: String,
): String {
    if (visibleProviders.any { it.id == requestedProviderId }) {
        return requestedProviderId
    }

    return sortedProviders.firstOrNull { it.enabled }?.id
        ?: sortedProviders.firstOrNull()?.id.orEmpty()
}

fun providerSettingsConnectivityBlockerKey(
    provider: ProviderConfig,
    apiKey: String,
): String? =
    if (provider.needsApiKey && apiKey.isBlank()) {
        "error.providerKeyRequired"
    } else {
        null
    }

fun providerSettingsReplaceProvider(
    providers: List<ProviderConfig>,
    updated: ProviderConfig,
): List<ProviderConfig> = providers.map { if (it.id == updated.id) updated else it }

fun providerSettingsCanDisableProvider(
    snapshot: AppSnapshot,
    providerId: String,
): Boolean {
    val provider = snapshot.providers.firstOrNull { it.id == providerId } ?: return false
    return !provider.enabled || snapshot.providers.count { it.enabled } > 1
}

fun providerSettingsApplyProviderChange(
    snapshot: AppSnapshot,
    updated: ProviderConfig,
    fallbackModelForProvider: (ProviderConfig) -> String,
    now: Long,
): AppSnapshot {
    val previous = snapshot.providers.firstOrNull { it.id == updated.id }
        ?: return snapshot
    val fallbackProvider = if (previous.enabled && !updated.enabled) {
        snapshot.providers.firstOrNull { it.id != updated.id && it.enabled }
    } else {
        null
    }

    return snapshot.copy(
        providers = providerSettingsReplaceProvider(snapshot.providers, updated),
        conversations = if (fallbackProvider == null) {
            snapshot.conversations
        } else {
            snapshot.conversations.map { conversation ->
                conversation.afterProviderUnavailable(
                    providerId = updated.id,
                    fallbackProvider = fallbackProvider,
                    fallbackModel = fallbackModelForProvider(fallbackProvider),
                    now = now,
                )
            }
        },
    )
}

fun providerSettingsApplyConnectivityModels(
    provider: ProviderConfig,
    models: List<String>,
    modelMetadata: Map<String, app.zerochat.data.ModelMetadata> = emptyMap(),
    now: Long,
): ProviderConfig = modelSettingsApplyFetchedModels(
    provider = provider,
    models = models,
    now = now,
    modelMetadata = modelMetadata,
)

internal fun providerSettingsApplyConnectivityModelsToSnapshot(
    snapshot: AppSnapshot,
    providerId: String,
    models: List<String>,
    modelMetadata: Map<String, app.zerochat.data.ModelMetadata> = emptyMap(),
    now: Long,
    expectedOwner: ModelSettingsFetchOwner,
    currentOwner: ModelSettingsFetchOwner?,
): AppSnapshot {
    val provider = snapshot.providers.firstOrNull { it.id == providerId } ?: return snapshot
    if (currentOwner == null || !modelSettingsFetchOwnerMatches(expectedOwner, currentOwner)) {
        return snapshot
    }
    return snapshot.copy(
        providers = providerSettingsReplaceProvider(
            snapshot.providers,
            providerSettingsApplyConnectivityModels(
                provider = provider,
                models = models,
                modelMetadata = modelMetadata,
                now = now,
            ),
        ),
    )
}

fun providerSettingsCapabilities(provider: ProviderConfig): List<String> {
    val capabilities = provider.capabilities.takeIf { it.isNotEmpty() }
        ?: when (provider.kind) {
            ProviderKind.Anthropic -> listOf("chat", "vision", "tools", "model-list")
            ProviderKind.OpenAIResponses -> listOf(
                "chat",
                "vision",
                "tools",
                "image-generation",
                "image-editing",
                "model-list",
            )
            ProviderKind.OpenAICompatible -> listOf("chat", "vision", "tools", "embeddings", "model-list")
        }
    val seen = LinkedHashSet<String>()
    capabilities.forEach { capability ->
        val trimmed = capability.trim()
        if (trimmed.isNotEmpty()) {
            seen.add(trimmed)
        }
    }

    return seen.sortedWith(
        compareBy(
            { capability ->
                providerSettingsCapabilityOrder.indexOf(capability).let { if (it == -1) Int.MAX_VALUE else it }
            },
            { it },
        ),
    )
}

fun providerSettingsCapabilitySummary(
    provider: ProviderConfig,
    translate: (String) -> String,
): String =
    providerSettingsCapabilities(provider)
        .joinToString(" / ") { capability ->
            val key = "capability.$capability"
            translate(key).takeUnless { it == key } ?: capability
        }

fun providerSettingsCapabilityChecks(provider: ProviderConfig): List<String> {
    val capabilities = providerSettingsCapabilities(provider).toSet()
    return providerSettingsFullCapabilityChecks.filter { capability ->
        when (capability) {
            "audio-speech", "audio-transcription" -> "audio" in capabilities
            "embeddings", "moderation", "realtime" -> capability in capabilities
            else -> false
        }
    }
}

fun providerSettingsMissingCapabilityModelKeys(provider: ProviderConfig): List<String> =
    providerSettingsCapabilityChecks(provider).filter { capability ->
        when (capability) {
            "audio-speech" -> modelForProviderAudioSpeech(provider).isBlank()
            "audio-transcription" -> modelForProviderAudioTranscription(provider).isBlank()
            "embeddings" -> modelForProviderCapability(provider, ProviderModelCapability.Embeddings).isBlank()
            "moderation" -> modelForProviderCapability(provider, ProviderModelCapability.Moderation).isBlank()
            "realtime" -> modelForProviderCapability(provider, ProviderModelCapability.Realtime).isBlank()
            else -> false
        }
    }

fun providerSettingsCapabilityReadinessSummary(
    provider: ProviderConfig,
    translate: (String) -> String,
): String {
    val missingCapabilityLabels = providerSettingsMissingCapabilityModelKeys(provider)
        .joinToString(" / ") { capability ->
            val key = "capability.$capability"
            translate(key).takeUnless { it == key } ?: capability
        }

    return if (missingCapabilityLabels.isBlank()) {
        translate("settings.capabilityReadinessReady")
    } else {
        translate("settings.capabilityReadinessMissing")
            .replace("{capabilities}", missingCapabilityLabels)
    }
}

fun providerSettingsEndpointLabels(provider: ProviderConfig): List<String> {
    val capabilities = providerSettingsCapabilities(provider).toSet()
    val endpoints = LinkedHashSet<String>()
    when (provider.kind) {
        ProviderKind.Anthropic -> {
            endpoints.add("/messages")
            endpoints.add("/models")
        }
        ProviderKind.OpenAIResponses -> {
            endpoints.add("/responses")
            endpoints.add("/models")
        }
        ProviderKind.OpenAICompatible -> {
            endpoints.add("/chat/completions")
            endpoints.add("/models")
        }
    }

    if ("image-generation" in capabilities && modelForProviderCapability(provider, ProviderModelCapability.ImageGeneration).isNotBlank()) {
        endpoints.add("/images/generations")
    }
    if ("image-editing" in capabilities && modelForProviderCapability(provider, ProviderModelCapability.ImageEditing).isNotBlank()) {
        endpoints.add("/images/edits")
    }
    if ("audio" in capabilities && modelForProviderAudioSpeech(provider).isNotBlank()) {
        endpoints.add("/audio/speech")
    }
    if ("audio" in capabilities && modelForProviderAudioTranscription(provider).isNotBlank()) {
        endpoints.add("/audio/transcriptions")
    }
    if ("realtime" in capabilities && modelForProviderCapability(provider, ProviderModelCapability.Realtime).isNotBlank()) {
        endpoints.add("/realtime")
        endpoints.add("/realtime/client_secrets")
    }
    if ("embeddings" in capabilities && modelForProviderCapability(provider, ProviderModelCapability.Embeddings).isNotBlank()) {
        endpoints.add("/embeddings")
    }
    if ("moderation" in capabilities && modelForProviderCapability(provider, ProviderModelCapability.Moderation).isNotBlank()) {
        endpoints.add("/moderations")
    }

    return endpoints.toList()
}

fun providerSettingsEndpointSummary(provider: ProviderConfig): String =
    providerSettingsEndpointLabels(provider).joinToString(" / ")

internal fun providerSettingsDeleteProvider(
    snapshot: AppSnapshot,
    deletedProviderId: String,
    fallbackModelForProvider: (ProviderConfig) -> String,
    now: Long,
): AppSnapshot {
    val fallbackProvider = snapshot.providers.firstOrNull {
        it.id != deletedProviderId && it.enabled
    } ?: snapshot.providers.firstOrNull { it.id != deletedProviderId }
        ?: return snapshot
    val fallbackModel = fallbackModelForProvider(fallbackProvider)
    return snapshot.copy(
        providers = snapshot.providers.filterNot { it.id == deletedProviderId },
        conversations = snapshot.conversations.map { conversation ->
            conversation.afterProviderUnavailable(
                providerId = deletedProviderId,
                fallbackProvider = fallbackProvider,
                fallbackModel = fallbackModel,
                now = now,
            )
        },
    )
}

private fun Conversation.afterProviderUnavailable(
    providerId: String,
    fallbackProvider: ProviderConfig,
    fallbackModel: String,
    now: Long,
): Conversation =
    if (this.providerId == providerId) {
        copy(
            providerId = fallbackProvider.id,
            model = fallbackModel,
            updatedAt = now,
        )
    } else {
        this
    }
