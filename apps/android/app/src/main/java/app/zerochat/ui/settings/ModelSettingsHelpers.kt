package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.capabilitiesForModelList
import app.zerochat.data.isLikelyAudioModel
import app.zerochat.data.isLikelyAudioSpeechModel
import app.zerochat.data.isLikelyAudioTranscriptionModel
import app.zerochat.data.isLikelyChatModel
import app.zerochat.data.isLikelyEmbeddingModel
import app.zerochat.data.isLikelyImageEditingModel
import app.zerochat.data.isLikelyImageModel
import app.zerochat.data.isLikelyModerationModel
import app.zerochat.data.isLikelyRealtimeModel
import app.zerochat.data.preferredAudioSpeechModel
import app.zerochat.data.preferredAudioTranscriptionModel
import app.zerochat.data.preferredChatModel
import app.zerochat.data.preferredEmbeddingModel
import app.zerochat.data.preferredImageModel
import app.zerochat.data.preferredModerationModel
import app.zerochat.data.preferredRealtimeModel
import app.zerochat.data.selectableModelsForProvider

fun modelSettingsReplaceProvider(
    providers: List<ProviderConfig>,
    provider: ProviderConfig,
): List<ProviderConfig> = providers.map { if (it.id == provider.id) provider else it }

fun modelSettingsStableSelectedProviderId(
    selectedProviderId: String,
    providers: List<ProviderConfig>,
): String =
    if (providers.any { it.id == selectedProviderId }) {
        selectedProviderId
    } else {
        providers.firstOrNull()?.id.orEmpty()
    }

fun modelSettingsApplyModels(
    provider: ProviderConfig,
    models: List<String>,
    now: Long,
): ProviderConfig {
    val mergedModels = modelSettingsUniqueModels(provider.models + models)
    return modelSettingsApplyConfiguredModels(
        provider = provider,
        models = mergedModels,
        now = now,
    )
}

fun modelSettingsApplyConfiguredModels(
    provider: ProviderConfig,
    models: List<String>,
    now: Long,
): ProviderConfig {
    val nextModels = modelSettingsUniqueModels(models)
    val chatModels = nextModels.filter(::isLikelyChatModel)
    val imageModels = nextModels.filter(::isLikelyImageModel)
    val audioSpeechModels = nextModels.filter(::isLikelyAudioSpeechModel)
    val audioTranscriptionModels = nextModels.filter(::isLikelyAudioTranscriptionModel)
    val embeddingModels = nextModels.filter(::isLikelyEmbeddingModel)
    val moderationModels = nextModels.filter(::isLikelyModerationModel)
    val realtimeModels = nextModels.filter(::isLikelyRealtimeModel)

    return provider.copy(
        models = nextModels,
        model = modelSettingsConfiguredOrFirstModel(
            currentModel = provider.model,
            models = chatModels,
        ),
        imageModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.imageModel,
            models = imageModels,
            preferredModel = ::preferredImageModel,
        ).takeIf { it.isNotBlank() },
        audioSpeechModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.audioSpeechModel,
            models = audioSpeechModels,
            preferredModel = ::preferredAudioSpeechModel,
        ).takeIf { it.isNotBlank() },
        audioTranscriptionModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.audioTranscriptionModel,
            models = audioTranscriptionModels,
            preferredModel = ::preferredAudioTranscriptionModel,
        ).takeIf { it.isNotBlank() },
        embeddingModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.embeddingModel,
            models = embeddingModels,
            preferredModel = ::preferredEmbeddingModel,
        ).takeIf { it.isNotBlank() },
        moderationModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.moderationModel,
            models = moderationModels,
            preferredModel = ::preferredModerationModel,
        ).takeIf { it.isNotBlank() },
        realtimeModel = modelSettingsConfiguredOrPreferredModel(
            currentModel = provider.realtimeModel,
            models = realtimeModels,
            preferredModel = ::preferredRealtimeModel,
        ).takeIf { it.isNotBlank() },
        capabilities = capabilitiesForModelList(provider, nextModels),
        updatedAt = now,
    )
}

fun modelSettingsApplyFetchedModels(
    provider: ProviderConfig,
    models: List<String>,
    now: Long,
): ProviderConfig {
    val fetchedModels = modelSettingsUniqueModels(models)
    val previousModels = modelSettingsUniqueModels(provider.models)
    val nextModels = fetchedModels.ifEmpty {
        provider.models.ifEmpty {
            modelSettingsUniqueModels(listOf(provider.model, provider.imageModel.orEmpty()))
        }
    }
    val chatModels = nextModels.filter(::isLikelyChatModel)
    val imageModels = nextModels.filter(::isLikelyImageModel)
    val audioSpeechModels = nextModels.filter(::isLikelyAudioSpeechModel)
    val audioTranscriptionModels = nextModels.filter(::isLikelyAudioTranscriptionModel)
    val embeddingModels = nextModels.filter(::isLikelyEmbeddingModel)
    val moderationModels = nextModels.filter(::isLikelyModerationModel)
    val realtimeModels = nextModels.filter(::isLikelyRealtimeModel)

    return provider.copy(
        models = nextModels,
        model = modelSettingsPreferredFetchedModel(
            currentModel = provider.model,
            previousModels = previousModels.filter(::isLikelyChatModel),
            fetchedModels = chatModels,
            preferredModel = ::preferredChatModel,
        ),
        imageModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.imageModel,
            previousModels = previousModels.filter(::isLikelyImageModel),
            fetchedModels = imageModels,
            preferredModel = ::preferredImageModel,
        ).takeIf { it.isNotBlank() },
        audioSpeechModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.audioSpeechModel,
            previousModels = previousModels.filter(::isLikelyAudioSpeechModel),
            fetchedModels = audioSpeechModels,
            preferredModel = ::preferredAudioSpeechModel,
        ).takeIf { it.isNotBlank() },
        audioTranscriptionModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.audioTranscriptionModel,
            previousModels = previousModels.filter(::isLikelyAudioTranscriptionModel),
            fetchedModels = audioTranscriptionModels,
            preferredModel = ::preferredAudioTranscriptionModel,
        ).takeIf { it.isNotBlank() },
        embeddingModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.embeddingModel,
            previousModels = previousModels.filter(::isLikelyEmbeddingModel),
            fetchedModels = embeddingModels,
            preferredModel = ::preferredEmbeddingModel,
        ).takeIf { it.isNotBlank() },
        moderationModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.moderationModel,
            previousModels = previousModels.filter(::isLikelyModerationModel),
            fetchedModels = moderationModels,
            preferredModel = ::preferredModerationModel,
        ).takeIf { it.isNotBlank() },
        realtimeModel = modelSettingsPreferredFetchedModel(
            currentModel = provider.realtimeModel,
            previousModels = previousModels.filter(::isLikelyRealtimeModel),
            fetchedModels = realtimeModels,
            preferredModel = ::preferredRealtimeModel,
        ).takeIf { it.isNotBlank() },
        capabilities = capabilitiesForModelList(provider, nextModels),
        updatedAt = now,
    )
}

fun modelSettingsApplyFetchedModelsToSnapshot(
    snapshot: AppSnapshot,
    providerId: String,
    models: List<String>,
    now: Long,
): AppSnapshot {
    val provider = snapshot.providers.firstOrNull { it.id == providerId } ?: return snapshot
    return snapshot.copy(
        providers = modelSettingsReplaceProvider(
            snapshot.providers,
            modelSettingsApplyFetchedModels(provider, models, now),
        ),
    )
}

private fun modelSettingsPreferredFetchedModel(
    currentModel: String?,
    previousModels: List<String>,
    fetchedModels: List<String>,
    preferredModel: (List<String>) -> String,
): String {
    val current = currentModel?.trim().orEmpty()
    if (fetchedModels.isEmpty()) {
        return ""
    }

    if (current.isBlank() || !fetchedModels.contains(current)) {
        return preferredModel(fetchedModels)
    }

    val previousPreferred = preferredModel(previousModels)
    return if (previousPreferred.isNotBlank() && current == previousPreferred) {
        preferredModel(fetchedModels)
    } else {
        current
    }
}

private fun modelSettingsConfiguredOrPreferredModel(
    currentModel: String?,
    models: List<String>,
    preferredModel: (List<String>) -> String,
): String {
    val current = currentModel?.trim().orEmpty()
    return current.takeIf(models::contains) ?: preferredModel(models)
}

private fun modelSettingsConfiguredOrFirstModel(
    currentModel: String?,
    models: List<String>,
): String {
    val current = currentModel?.trim().orEmpty()
    return current.takeIf(models::contains) ?: models.firstOrNull().orEmpty()
}

fun modelSettingsFetchBlockerKey(
    provider: ProviderConfig,
    apiKey: String,
): String? =
    if (provider.needsApiKey && apiKey.isBlank()) {
        "error.providerKeyRequired"
    } else {
        null
    }

fun modelSettingsManualModels(input: String): List<String> =
    input.split(Regex("\\s+")).filter { it.isNotBlank() }

fun modelSettingsModelCapabilityKeys(model: String): List<String> = buildList {
    val audioSpeech = isLikelyAudioSpeechModel(model)
    val audioTranscription = isLikelyAudioTranscriptionModel(model)
    if (isLikelyChatModel(model)) {
        add("capability.chat")
    }
    if (isLikelyImageModel(model)) {
        add("capability.image-generation")
    }
    if (isLikelyImageEditingModel(model)) {
        add("capability.image-editing")
    }
    if (isLikelyAudioModel(model) && !audioSpeech && !audioTranscription) {
        add("capability.audio")
    }
    if (audioSpeech) {
        add("capability.audio-speech")
    }
    if (audioTranscription) {
        add("capability.audio-transcription")
    }
    if (isLikelyEmbeddingModel(model)) {
        add("capability.embeddings")
    }
    if (isLikelyRealtimeModel(model)) {
        add("capability.realtime")
    }
    if (isLikelyModerationModel(model)) {
        add("capability.moderation")
    }
}

fun modelSettingsProviderCapabilityKeys(provider: ProviderConfig): List<String> {
    val models = selectableModelsForProvider(provider)
    val capabilityKeys = models
        .flatMap(::modelSettingsModelCapabilityKeys)
        .toSet()

    return listOf(
        "capability.chat",
        "capability.image-generation",
        "capability.image-editing",
        "capability.audio",
        "capability.audio-speech",
        "capability.audio-transcription",
        "capability.embeddings",
        "capability.moderation",
        "capability.realtime",
    ).filter(capabilityKeys::contains)
}

fun modelSettingsModelCapabilitySummary(
    model: String,
    translate: (String) -> String,
): String = modelSettingsModelCapabilityKeys(model).joinToString(" / ", transform = translate)

fun modelSettingsProviderCapabilitySummary(
    provider: ProviderConfig,
    translate: (String) -> String,
): String = modelSettingsProviderCapabilityKeys(provider).joinToString(" / ", transform = translate)

fun modelSettingsMoveModel(models: List<String>, from: Int, to: Int): List<String> {
    if (from !in models.indices || to !in models.indices) {
        return models
    }

    val copy = models.toMutableList()
    val item = copy.removeAt(from)
    copy.add(to, item)
    return copy
}

fun modelSettingsRemoveModel(
    provider: ProviderConfig,
    model: String,
    now: Long,
): ProviderConfig {
    val nextModels = provider.models.filterNot { it == model }
    return modelSettingsApplyConfiguredModels(
        provider = provider,
        models = nextModels,
        now = now,
    )
}

fun modelSettingsSelectChatModel(
    provider: ProviderConfig,
    model: String,
    now: Long,
): ProviderConfig = provider.copy(model = model, updatedAt = now)

fun modelSettingsSelectImageModel(
    provider: ProviderConfig,
    model: String,
    now: Long,
): ProviderConfig = provider.copy(imageModel = model.ifBlank { null }, updatedAt = now)

private fun modelSettingsUniqueModels(models: List<String>): List<String> {
    val seen = LinkedHashSet<String>()
    models.forEach { raw ->
        val model = raw.trim()
        if (model.isNotEmpty()) {
            seen.add(model)
        }
    }
    return seen.toList()
}
