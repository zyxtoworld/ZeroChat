package app.zerochat.data

import java.util.UUID

private val customOpenAiRelayCapabilities = listOf(
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

private const val officialOpenAiChatModel = "gpt-5.5"
private const val officialOpenAiImageModel = "gpt-image-2"
private const val officialOpenAiAudioSpeechModel = "gpt-4o-mini-tts"
private const val officialOpenAiAudioTranscriptionModel = "gpt-4o-transcribe"
private const val officialOpenAiEmbeddingModel = "text-embedding-3-large"
private const val officialOpenAiModerationModel = "omni-moderation-latest"
private const val officialOpenAiRealtimeModel = "gpt-realtime-2"

private val officialOpenAiCapabilities = listOf(
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

internal fun defaultProviderConfigs(customOpenAiRelayName: String): List<ProviderConfig> {
    val now = providerRegistryNowMillis()
    fun provider(
        id: String,
        name: String,
        kind: ProviderKind,
        baseUrl: String,
        model: String,
        imageModel: String? = null,
        audioSpeechModel: String? = null,
        audioTranscriptionModel: String? = null,
        embeddingModel: String? = null,
        moderationModel: String? = null,
        realtimeModel: String? = null,
        capabilities: List<String> = listOf("chat", "model-list"),
    ) = ProviderConfig(
        id = id,
        name = name,
        kind = kind,
        baseUrl = baseUrl,
        model = model,
        imageModel = imageModel,
        audioSpeechModel = audioSpeechModel,
        audioTranscriptionModel = audioTranscriptionModel,
        embeddingModel = embeddingModel,
        moderationModel = moderationModel,
        realtimeModel = realtimeModel,
        models = uniqueModels(
            listOf(
                model,
                imageModel.orEmpty(),
                audioSpeechModel.orEmpty(),
                audioTranscriptionModel.orEmpty(),
                embeddingModel.orEmpty(),
                moderationModel.orEmpty(),
                realtimeModel.orEmpty(),
            ),
        ),
        capabilities = capabilities,
        enabled = id == "openai",
        needsApiKey = true,
        custom = id.startsWith("custom") ||
            id == "azure-openai" ||
            id == "cloudflare-ai-gateway-openai",
        createdAt = now,
        updatedAt = now,
    )

    return listOf(
        provider(
            id = "openai",
            name = "OpenAI",
            kind = ProviderKind.OpenAIResponses,
            baseUrl = "https://api.openai.com/v1",
            model = officialOpenAiChatModel,
            imageModel = officialOpenAiImageModel,
            audioSpeechModel = officialOpenAiAudioSpeechModel,
            audioTranscriptionModel = officialOpenAiAudioTranscriptionModel,
            embeddingModel = officialOpenAiEmbeddingModel,
            moderationModel = officialOpenAiModerationModel,
            realtimeModel = officialOpenAiRealtimeModel,
            capabilities = officialOpenAiCapabilities,
        ),
        provider("anthropic", "Anthropic", ProviderKind.Anthropic, "https://api.anthropic.com/v1", ""),
        provider("gemini", "Google Gemini", ProviderKind.OpenAICompatible, "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash"),
        provider("deepseek", "DeepSeek", ProviderKind.OpenAICompatible, "https://api.deepseek.com", "deepseek-chat"),
        provider("xai", "xAI", ProviderKind.OpenAIResponses, "https://api.x.ai/v1", ""),
        provider("openrouter", "OpenRouter", ProviderKind.OpenAICompatible, "https://openrouter.ai/api/v1", "openai/gpt-4.1-mini"),
        provider("mistral", "Mistral AI", ProviderKind.OpenAICompatible, "https://api.mistral.ai/v1", "mistral-small-latest"),
        provider("groq", "Groq", ProviderKind.OpenAICompatible, "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        provider("together", "Together AI", ProviderKind.OpenAICompatible, "https://api.together.xyz/v1", ""),
        provider("fireworks", "Fireworks AI", ProviderKind.OpenAICompatible, "https://api.fireworks.ai/inference/v1", ""),
        provider("cerebras", "Cerebras", ProviderKind.OpenAICompatible, "https://api.cerebras.ai/v1", ""),
        provider("nvidia", "NVIDIA NIM", ProviderKind.OpenAICompatible, "https://integrate.api.nvidia.com/v1", ""),
        provider("deepinfra", "DeepInfra", ProviderKind.OpenAICompatible, "https://api.deepinfra.com/v1/openai", ""),
        provider("novita", "Novita AI", ProviderKind.OpenAICompatible, "https://api.novita.ai/v3/openai", ""),
        provider("siliconflow", "SiliconFlow", ProviderKind.OpenAICompatible, "https://api.siliconflow.cn/v1", "Qwen/Qwen2.5-7B-Instruct"),
        provider("modelscope", "ModelScope 魔搭", ProviderKind.OpenAICompatible, "https://api-inference.modelscope.cn/v1", ""),
        provider("dashscope", "阿里云百炼", ProviderKind.OpenAICompatible, "https://dashscope.aliyuncs.com/compatible-mode/v1", ""),
        provider("moonshot", "Moonshot", ProviderKind.OpenAICompatible, "https://api.moonshot.cn/v1", "moonshot-v1-8k"),
        provider("zhipu", "智谱 GLM", ProviderKind.OpenAICompatible, "https://open.bigmodel.cn/api/paas/v4", ""),
        provider("qianfan", "百度千帆", ProviderKind.OpenAICompatible, "https://qianfan.baidubce.com/v2", ""),
        provider("hunyuan", "腾讯混元", ProviderKind.OpenAICompatible, "https://api.hunyuan.cloud.tencent.com/v1", ""),
        provider("minimax", "MiniMax", ProviderKind.OpenAICompatible, "https://api.minimax.io/v1", "MiniMax-Text-01"),
        provider("azure-openai", "Azure OpenAI", ProviderKind.OpenAICompatible, "https://your-resource.openai.azure.com/openai/v1", ""),
        provider("volcengine", "火山方舟", ProviderKind.OpenAICompatible, "https://ark.cn-beijing.volces.com/api/v3", ""),
        provider("cloudflare-ai-gateway-openai", "Cloudflare AI Gateway", ProviderKind.OpenAICompatible, "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai", ""),
        provider("custom-openai", customOpenAiRelayName, ProviderKind.OpenAICompatible, "https://relay.example.com/v1", "", capabilities = customOpenAiRelayCapabilities),
        provider("custom-responses-relay", "Custom relay (OpenAI Responses)", ProviderKind.OpenAIResponses, "https://relay.example.com/v1", ""),
        provider("custom-anthropic-relay", "Custom relay (Anthropic / Claude)", ProviderKind.Anthropic, "https://relay.example.com/v1", ""),
    )
}

internal fun defaultProviderIds(): Set<String> =
    defaultProviderConfigs("").mapTo(linkedSetOf()) { it.id }

internal fun normalizeOfficialProviderContracts(snapshot: AppSnapshot): AppSnapshot {
    var changed = false
    val now = providerRegistryNowMillis()
    val normalizedSnapshotUpdatedAt = maxOf(snapshot.updatedAt, now)
    val providers = snapshot.providers.map { provider ->
        if (!isOfficialOpenAiProvider(provider)) {
            return@map provider
        }

        val imageModel = provider.imageModel
            ?.trim()
            ?.takeIf { it.isNotBlank() && isLikelyImageModel(it) }
            ?: officialOpenAiImageModel
        val audioSpeechModel = validCapabilityModel(
            provider.audioSpeechModel,
            officialOpenAiAudioSpeechModel,
            ::isLikelyAudioSpeechModel,
        )
        val audioTranscriptionModel = validCapabilityModel(
            provider.audioTranscriptionModel,
            officialOpenAiAudioTranscriptionModel,
            ::isLikelyAudioTranscriptionModel,
        )
        val embeddingModel = validCapabilityModel(
            provider.embeddingModel,
            officialOpenAiEmbeddingModel,
            ::isLikelyEmbeddingModel,
        )
        val moderationModel = validCapabilityModel(
            provider.moderationModel,
            officialOpenAiModerationModel,
            ::isLikelyModerationModel,
        )
        val realtimeModel = validCapabilityModel(
            provider.realtimeModel,
            officialOpenAiRealtimeModel,
            ::isLikelyRealtimeModel,
        )
        val model = provider.model.trim().let {
            if (it.isBlank() || it == "gpt-5.4-mini") officialOpenAiChatModel else provider.model
        }
        val models = uniqueModels(
            provider.models + listOf(
                model,
                provider.model,
                imageModel,
                audioSpeechModel,
                audioTranscriptionModel,
                embeddingModel,
                moderationModel,
                realtimeModel,
                officialOpenAiChatModel,
                officialOpenAiImageModel,
                officialOpenAiAudioSpeechModel,
                officialOpenAiAudioTranscriptionModel,
                officialOpenAiEmbeddingModel,
                officialOpenAiModerationModel,
                officialOpenAiRealtimeModel,
            ),
        )
        val providerChanged =
            provider.kind != ProviderKind.OpenAIResponses ||
                provider.model != model ||
                provider.needsApiKey != true ||
                provider.imageModel != imageModel ||
                provider.audioSpeechModel != audioSpeechModel ||
                provider.audioTranscriptionModel != audioTranscriptionModel ||
                provider.embeddingModel != embeddingModel ||
                provider.moderationModel != moderationModel ||
                provider.realtimeModel != realtimeModel ||
                provider.models != models ||
                provider.capabilities != officialOpenAiCapabilities

        if (!providerChanged) {
            provider
        } else {
            changed = true
            provider.copy(
                kind = ProviderKind.OpenAIResponses,
                model = model,
                imageModel = imageModel,
                audioSpeechModel = audioSpeechModel,
                audioTranscriptionModel = audioTranscriptionModel,
                embeddingModel = embeddingModel,
                moderationModel = moderationModel,
                realtimeModel = realtimeModel,
                models = models,
                capabilities = officialOpenAiCapabilities,
                needsApiKey = true,
                updatedAt = maxOf(provider.updatedAt, now),
            )
        }
    }

    return if (changed) snapshot.copy(providers = providers, updatedAt = normalizedSnapshotUpdatedAt) else snapshot
}

private fun validCapabilityModel(
    value: String?,
    fallback: String,
    predicate: (String) -> Boolean,
): String = value?.trim()?.takeIf { it.isNotEmpty() && predicate(it) } ?: fallback

fun customProvider(name: String): ProviderConfig {
    val now = providerRegistryNowMillis()
    return ProviderConfig(
        id = UUID.randomUUID().toString(),
        name = name,
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://relay.example.com/v1",
        proxyUrl = null,
        model = "",
        imageModel = null,
        models = emptyList(),
        capabilities = customOpenAiRelayCapabilities,
        enabled = true,
        needsApiKey = true,
        custom = true,
        createdAt = now,
        updatedAt = now,
    )
}

internal fun uniqueModels(models: List<String>): List<String> {
    val seen = LinkedHashSet<String>()
    models.forEach { raw ->
        val model = raw.trim()
        if (model.isNotEmpty()) {
            seen.add(model)
        }
    }
    return seen.toList()
}

internal fun configuredModelsForProvider(provider: ProviderConfig?): List<String> =
    selectableModelsForProvider(provider)

internal fun selectableModelsForProvider(provider: ProviderConfig?): List<String> {
    if (provider == null) {
        return emptyList()
    }

    val listedModels = uniqueModels(provider.models)
    if (listedModels.isNotEmpty()) {
        return listedModels
    }

    return uniqueModels(
        listOf(
            provider.model,
            provider.imageModel.orEmpty(),
            provider.audioSpeechModel.orEmpty(),
            provider.audioTranscriptionModel.orEmpty(),
            provider.embeddingModel.orEmpty(),
            provider.moderationModel.orEmpty(),
            provider.realtimeModel.orEmpty(),
        ),
    )
}

private val imageModelMarkers = listOf(
    "dall-e",
    "flux",
    "gpt-image",
    "image",
    "imagen",
    "midjourney",
    "stable-diffusion",
)

private val nonChatModelMarkers = listOf(
    "audio",
    "dall-e",
    "embed",
    "embedding",
    "flux",
    "gpt-image",
    "image",
    "imagen",
    "kling",
    "midjourney",
    "moderation",
    "rerank",
    "realtime",
    "speech",
    "stable-diffusion",
    "transcribe",
    "tts",
    "upscale",
    "whisper",
)

fun isLikelyChatModel(model: String): Boolean {
    val normalized = model.lowercase()

    if (normalized.contains("audio-preview")) {
        return true
    }

    return nonChatModelMarkers.none { normalized.contains(it) }
}

internal fun chatModelsForProvider(provider: ProviderConfig?): List<String> =
    selectableModelsForProvider(provider).filter(::isLikelyChatModel)

private fun modelVersionScore(model: String, family: String): Int {
    val match = Regex("$family[-_ ]?(\\d+(?:[._-]\\d+)*)", RegexOption.IGNORE_CASE)
        .find(model)
        ?: return 0
    val version = match.groupValues.getOrNull(1).orEmpty()

    return version
        .split(Regex("[._-]"))
        .take(3)
        .foldIndexed(0) { index, score, part ->
            val value = part.toIntOrNull() ?: 0
            if (index >= 2 && value > 99) {
                return@foldIndexed score
            }
            score + value * when (index) {
                0 -> 10_000
                1 -> 100
                else -> 1
            }
        }
}

private fun modelVariantPreferenceScore(model: String): Int {
    val variants = model.lowercase().split(Regex("[^a-z0-9]+"))

    return when {
        variants.contains("sol") -> 1_200
        variants.contains("terra") -> 800
        variants.contains("luna") -> 400
        else -> 0
    }
}

internal fun chatModelPreferenceScore(model: String): Int {
    val normalized = model.lowercase()
    var score = 0

    if (normalized.contains("gpt-")) {
        score += 100_000 + modelVersionScore(normalized, "gpt") + modelVariantPreferenceScore(normalized)
    }

    if (Regex("\\bo[34]\\b").containsMatchIn(normalized)) {
        score += if (normalized.contains("o4")) 94_000 else 93_000
    }

    if (normalized.contains("claude") && normalized.contains("opus")) {
        score += 92_000
    } else if (normalized.contains("claude") && normalized.contains("sonnet")) {
        score += 90_000
    }

    if (normalized.contains("gemini") && normalized.contains("pro")) {
        score += 88_000
    }

    if (normalized.contains("grok")) {
        score += 86_000
    }

    if (normalized.contains("deepseek") && normalized.contains("r1")) {
        score += 84_000
    }

    if (normalized.contains("qwen") && Regex("max|plus|coder").containsMatchIn(normalized)) {
        score += 82_000
    }

    if (Regex("\\bpro\\b").containsMatchIn(normalized)) score += 900
    if (Regex("\\bmax\\b").containsMatchIn(normalized)) score += 850
    if (Regex("\\breasoning\\b").containsMatchIn(normalized)) score += 780
    if (Regex("\\bthinking\\b").containsMatchIn(normalized)) score += 740
    if (Regex("\\blarge\\b").containsMatchIn(normalized)) score += 650
    if (Regex("\\blatest\\b").containsMatchIn(normalized)) score += 500

    if (normalized.contains("mini")) score -= 1_200
    if (normalized.contains("nano")) score -= 1_800
    if (normalized.contains("lite")) score -= 1_600
    if (normalized.contains("small")) score -= 1_300
    if (normalized.contains("flash")) score -= 1_000
    if (normalized.contains("spark")) score -= 800
    if (normalized.contains("compact")) score -= 700
    if (normalized.contains("auto-review")) score -= 2_500

    return score
}

fun preferredChatModel(models: List<String>): String =
    models
        .filter(::isLikelyChatModel)
        .sortedWith(
            compareByDescending<String> { chatModelPreferenceScore(it) }
                .thenBy { it },
        )
        .firstOrNull()
        .orEmpty()

internal fun defaultChatModelForProvider(provider: ProviderConfig?): String {
    return modelForProviderCapability(provider, ProviderModelCapability.Chat)
}

internal fun chatModelForConversation(
    conversation: Conversation?,
    provider: ProviderConfig?,
): String {
    val models = chatModelsForProvider(provider)
    if (models.isEmpty()) {
        return ""
    }

    val conversationModel = conversation?.model?.trim().orEmpty()
    if (conversationModel.isNotEmpty() && models.contains(conversationModel)) {
        return conversationModel
    }

    return defaultChatModelForProvider(provider)
}

fun isLikelyImageModel(model: String): Boolean {
  val normalized = model.lowercase()

  return imageModelMarkers.any { normalized.contains(it) }
}

fun isLikelyImageEditingModel(model: String): Boolean =
    isLikelyImageModel(model) && !model.lowercase().contains("dall-e-3")

fun isLikelyEmbeddingModel(model: String): Boolean {
    val normalized = model.lowercase()

    return normalized.contains("embed") || normalized.contains("embedding")
}

fun isLikelyAudioModel(model: String): Boolean {
    return model.lowercase().contains("audio") ||
        isLikelyAudioSpeechModel(model) ||
        isLikelyAudioTranscriptionModel(model)
}

fun isLikelyAudioSpeechModel(model: String): Boolean {
    val normalized = model.lowercase()

    return Regex("tts|speech").containsMatchIn(normalized)
}

fun isLikelyAudioTranscriptionModel(model: String): Boolean {
    val normalized = model.lowercase()

    return Regex("whisper|transcri").containsMatchIn(normalized)
}

fun isLikelyRealtimeModel(model: String): Boolean {
    val normalized = model.lowercase()

    return normalized.contains("realtime") || Regex("^gpt-audio(?:-|$)").containsMatchIn(normalized)
}

fun isLikelyModerationModel(model: String): Boolean =
    model.lowercase().contains("moderation")

internal fun imageModelsForProvider(provider: ProviderConfig?): List<String> {
    if (provider == null || provider.kind == ProviderKind.Anthropic) {
        return emptyList()
    }

    return selectableModelsForProvider(provider).filter(::isLikelyImageModel)
}

internal fun imageEditingModelsForProvider(provider: ProviderConfig?): List<String> {
    if (provider == null || provider.kind == ProviderKind.Anthropic) {
        return emptyList()
    }

    return selectableModelsForProvider(provider).filter(::isLikelyImageEditingModel)
}

private fun preferredModelByMarkers(
    models: List<String>,
    markers: List<String>,
    isLikelyModel: (String) -> Boolean,
): String {
    markers.forEach { marker ->
        val match = models.firstOrNull { it.lowercase().contains(marker) }
        if (match != null) {
            return match
        }
    }

    return models.firstOrNull(isLikelyModel).orEmpty()
}

fun preferredImageModel(models: List<String>): String {
    val preferredMarkers = listOf(
        "gpt-image-2",
        "gpt-image-1",
        "dall-e-3",
        "dall-e-2",
        "imagen",
        "flux",
    )

    preferredMarkers.forEach { marker ->
        val match = models.firstOrNull { it.lowercase().contains(marker) }
        if (match != null) {
            return match
        }
    }

    return models.firstOrNull().orEmpty()
}

internal fun preferredEmbeddingModel(models: List<String>): String =
    preferredModelByMarkers(
        models,
        listOf("text-embedding-3-large", "text-embedding-3-small", "embedding", "embed"),
        ::isLikelyEmbeddingModel,
    )

internal fun preferredAudioSpeechModel(models: List<String>): String =
    preferredModelByMarkers(
        models,
        listOf(
            "gpt-4o-mini-tts",
            "tts-1-hd",
            "tts-1",
            "speech",
        ),
        ::isLikelyAudioSpeechModel,
    )

internal fun preferredAudioTranscriptionModel(models: List<String>): String =
    preferredModelByMarkers(
        models,
        listOf(
            "gpt-4o-transcribe",
            "gpt-4o-mini-transcribe",
            "whisper-1",
            "transcribe",
            "whisper",
        ),
        ::isLikelyAudioTranscriptionModel,
    )

internal fun preferredAudioModel(models: List<String>): String =
    preferredAudioTranscriptionModel(models)
        .ifEmpty { preferredAudioSpeechModel(models) }
        .ifEmpty { preferredModelByMarkers(models, listOf("audio"), ::isLikelyAudioModel) }

internal fun modelForProviderAudioSpeech(provider: ProviderConfig?): String {
    val models = selectableModelsForProvider(provider).filter(::isLikelyAudioSpeechModel)
    val configured = provider?.audioSpeechModel?.trim().orEmpty()
    return configured.takeIf(models::contains) ?: preferredAudioSpeechModel(models)
}

internal fun modelForProviderAudioTranscription(provider: ProviderConfig?): String {
    val models = selectableModelsForProvider(provider).filter(::isLikelyAudioTranscriptionModel)
    val configured = provider?.audioTranscriptionModel?.trim().orEmpty()
    return configured.takeIf(models::contains) ?: preferredAudioTranscriptionModel(models)
}

internal fun preferredRealtimeModel(models: List<String>): String =
    preferredModelByMarkers(
        models,
        listOf(
            "gpt-realtime-2",
            "gpt-audio-1.5",
            "gpt-realtime",
            "gpt-audio-mini",
            "gpt-realtime-mini",
            "gpt-4o-realtime",
            "realtime",
        ),
        ::isLikelyRealtimeModel,
    )

internal fun preferredModerationModel(models: List<String>): String =
    preferredModelByMarkers(
        models,
        listOf("omni-moderation-latest", "omni-moderation", "moderation-latest", "moderation"),
        ::isLikelyModerationModel,
    )

internal fun modelsForProviderCapability(
    provider: ProviderConfig?,
    capability: ProviderModelCapability,
): List<String> {
    if (provider == null) {
        return emptyList()
    }

    return when (capability) {
        ProviderModelCapability.Chat -> chatModelsForProvider(provider)
        ProviderModelCapability.ImageGeneration -> imageModelsForProvider(provider)
        ProviderModelCapability.ImageEditing -> imageEditingModelsForProvider(provider)
        ProviderModelCapability.Embeddings -> selectableModelsForProvider(provider)
            .filter(::isLikelyEmbeddingModel)
        ProviderModelCapability.Audio -> selectableModelsForProvider(provider)
            .filter(::isLikelyAudioModel)
        ProviderModelCapability.Realtime -> selectableModelsForProvider(provider)
            .filter(::isLikelyRealtimeModel)
        ProviderModelCapability.Moderation -> selectableModelsForProvider(provider)
            .filter(::isLikelyModerationModel)
    }
}

internal fun preferredModelForCapability(
    models: List<String>,
    capability: ProviderModelCapability,
): String =
    when (capability) {
        ProviderModelCapability.Chat -> preferredChatModel(models)
        ProviderModelCapability.ImageGeneration,
        ProviderModelCapability.ImageEditing,
        -> preferredImageModel(models)
        ProviderModelCapability.Embeddings -> preferredEmbeddingModel(models)
        ProviderModelCapability.Audio -> preferredAudioModel(models)
        ProviderModelCapability.Realtime -> preferredRealtimeModel(models)
        ProviderModelCapability.Moderation -> preferredModerationModel(models)
    }

internal fun modelForProviderCapability(
    provider: ProviderConfig?,
    capability: ProviderModelCapability,
): String {
    if (provider == null) {
        return ""
    }

    val models = modelsForProviderCapability(provider, capability)
    val configuredModel = when (capability) {
        ProviderModelCapability.Chat -> provider.model.trim()
        ProviderModelCapability.ImageGeneration,
        ProviderModelCapability.ImageEditing,
        -> provider.imageModel?.trim().orEmpty()
        ProviderModelCapability.Embeddings -> provider.embeddingModel?.trim().orEmpty()
        ProviderModelCapability.Audio -> provider.audioSpeechModel?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: provider.audioTranscriptionModel?.trim().orEmpty()
        ProviderModelCapability.Realtime -> provider.realtimeModel?.trim().orEmpty()
        ProviderModelCapability.Moderation -> provider.moderationModel?.trim().orEmpty()
    }

    if (configuredModel.isNotBlank() && models.contains(configuredModel)) {
        return configuredModel
    }

    return preferredModelForCapability(models, capability)
}

internal fun imageModelForProvider(provider: ProviderConfig?): String {
    return modelForProviderCapability(provider, ProviderModelCapability.ImageGeneration)
}

fun capabilitiesForModelList(
    provider: ProviderConfig,
    models: List<String>,
): List<String> {
    val capabilities = LinkedHashSet(
        provider.capabilities.takeIf { it.isNotEmpty() }
            ?: when (provider.kind) {
                ProviderKind.Anthropic -> listOf("chat", "vision", "tools", "model-list")
                ProviderKind.OpenAIResponses ->
                    listOf("chat", "vision", "tools", "image-generation", "image-editing", "model-list")
                ProviderKind.OpenAICompatible -> listOf("chat", "vision", "tools", "embeddings", "model-list")
            },
    )

    if (models.any(::isLikelyImageModel)) {
        capabilities.add("image-generation")
    }

    if (models.any(::isLikelyImageEditingModel)) {
        capabilities.add("image-editing")
    }

    models.forEach { model ->
        if (isLikelyEmbeddingModel(model)) {
            capabilities.add("embeddings")
        }

        if (isLikelyAudioModel(model)) {
            capabilities.add("audio")
        }

        if (isLikelyRealtimeModel(model)) {
            capabilities.add("realtime")
        }

        if (isLikelyModerationModel(model)) {
            capabilities.add("moderation")
        }
    }

    return capabilities.toList()
}

private fun isOfficialOpenAiProvider(provider: ProviderConfig): Boolean =
    !provider.custom &&
        provider.name == "OpenAI" &&
        provider.baseUrl == "https://api.openai.com/v1"

private fun providerRegistryNowMillis(): Long = System.currentTimeMillis()
