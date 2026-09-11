import Foundation

public let defaultCustomOpenAiRelayNames: Set<String> = Set([
    "自定义中转（OpenAI 兼容）",
    "自定OpenAI 兼容中转",
    "Custom relay (OpenAI compatible)",
    "Custom " + "OpenAI-compatible relay",
    "Relé personalizado (OpenAI compatible)",
    "Retransmisión personalizada (OpenAI compatible)",
    "कस्टम रिले (OpenAI compatible)",
    "مرحل مخصص (OpenAI compatible)",
    "مرحل مخصص (متوافق مع OpenAI)",
    "Relé personalizado (OpenAI compatible)",
    "Relay personalizado (compatível com OpenAI)",
    "Пользовательское реле (OpenAI compatible)",
    "Пользовательский ретранслятор (совместимый с OpenAI)",
    "カスタム リレー (OpenAI compatible)",
    "カスタムリレー（OpenAI 互換）",
    "맞춤형 릴레이(OpenAI compatible)",
    "사용자 지정 릴레이(OpenAI 호환)",
    "Relais personnalisé (OpenAI compatible)",
].map(normalizeProviderDisplayName))

public func normalizeProviderDisplayName(_ name: String) -> String {
    name
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .lowercased()
}

public enum ProviderModelCapability {
    case chat
    case imageGeneration
    case imageEditing
    case embeddings
    case audio
    case realtime
    case moderation
}

private let generationOnlyImageModelMarker = "dall-e-3"
private let standardEmbeddingModelFallbacks = [
    "text-embedding-3-large",
    "text-embedding-3-small"
]
private let standardAudioSpeechModelFallbacks = [
    "gpt-4o-mini-tts",
    "tts-1-hd",
    "tts-1"
]
private let standardAudioTranscriptionModelFallbacks = [
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "whisper-1"
]
private let standardRealtimeModelFallbacks = [
    "gpt-realtime-2",
    "gpt-audio-1.5",
    "gpt-realtime",
    "gpt-audio-mini",
    "gpt-realtime-mini",
    "gpt-4o-realtime-preview",
    "gpt-4o-realtime"
]
private let standardModerationModelFallbacks = [
    "omni-moderation-latest",
    "omni-moderation",
    "moderation-latest"
]

public func isDefaultCustomOpenAiRelay(_ provider: ProviderConfig) -> Bool {
    provider.custom == true &&
        provider.kind == .openAICompatible &&
        defaultCustomOpenAiRelayNames.contains(normalizeProviderDisplayName(provider.name))
}

public let customOpenAiRelayCapabilities = [
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list"
]

private let officialOpenAiChatModel = "gpt-5.5"
private let officialOpenAiImageModel = "gpt-image-2"
private let officialOpenAiAudioSpeechModel = "gpt-4o-mini-tts"
private let officialOpenAiAudioTranscriptionModel = "gpt-4o-transcribe"
private let officialOpenAiEmbeddingModel = "text-embedding-3-large"
private let officialOpenAiModerationModel = "omni-moderation-latest"
private let officialOpenAiRealtimeModel = "gpt-realtime-2"

private let officialOpenAiCapabilities = [
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list"
]

public func defaultProviders(customOpenAiRelayName: String) -> [ProviderConfig] {
    let now = providerRegistryNowMillis()
    func provider(
        _ id: String,
        _ name: String,
        _ kind: ProviderKind,
        _ baseUrl: String,
        _ model: String,
        imageModel: String? = nil,
        audioSpeechModel: String? = nil,
        audioTranscriptionModel: String? = nil,
        embeddingModel: String? = nil,
        moderationModel: String? = nil,
        realtimeModel: String? = nil,
        capabilities: [String] = ["chat", "model-list"]
    ) -> ProviderConfig {
        ProviderConfig(
            id: id,
            name: name,
            kind: kind,
            baseUrl: baseUrl,
            model: model,
            imageModel: imageModel,
            audioSpeechModel: audioSpeechModel,
            audioTranscriptionModel: audioTranscriptionModel,
            embeddingModel: embeddingModel,
            moderationModel: moderationModel,
            realtimeModel: realtimeModel,
            models: uniqueModels([
                model,
                imageModel ?? "",
                audioSpeechModel ?? "",
                audioTranscriptionModel ?? "",
                embeddingModel ?? "",
                moderationModel ?? "",
                realtimeModel ?? ""
            ]),
            capabilities: capabilities,
            enabled: id == "openai",
            needsApiKey: true,
            custom: id.hasPrefix("custom") ||
                id == "azure-openai" ||
                id == "cloudflare-ai-gateway-openai",
            createdAt: now,
            updatedAt: now
        )
    }

    return [
        provider(
            "openai",
            "OpenAI",
            .openAIResponses,
            "https://api.openai.com/v1",
            officialOpenAiChatModel,
            imageModel: officialOpenAiImageModel,
            audioSpeechModel: officialOpenAiAudioSpeechModel,
            audioTranscriptionModel: officialOpenAiAudioTranscriptionModel,
            embeddingModel: officialOpenAiEmbeddingModel,
            moderationModel: officialOpenAiModerationModel,
            realtimeModel: officialOpenAiRealtimeModel,
            capabilities: officialOpenAiCapabilities
        ),
        provider("anthropic", "Anthropic", .anthropic, "https://api.anthropic.com/v1", ""),
        provider("gemini", "Google Gemini", .openAICompatible, "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash"),
        provider("deepseek", "DeepSeek", .openAICompatible, "https://api.deepseek.com", "deepseek-chat"),
        provider("xai", "xAI", .openAIResponses, "https://api.x.ai/v1", ""),
        provider("openrouter", "OpenRouter", .openAICompatible, "https://openrouter.ai/api/v1", "openai/gpt-4.1-mini"),
        provider("mistral", "Mistral AI", .openAICompatible, "https://api.mistral.ai/v1", "mistral-small-latest"),
        provider("groq", "Groq", .openAICompatible, "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        provider("together", "Together AI", .openAICompatible, "https://api.together.xyz/v1", ""),
        provider("fireworks", "Fireworks AI", .openAICompatible, "https://api.fireworks.ai/inference/v1", ""),
        provider("cerebras", "Cerebras", .openAICompatible, "https://api.cerebras.ai/v1", ""),
        provider("nvidia", "NVIDIA NIM", .openAICompatible, "https://integrate.api.nvidia.com/v1", ""),
        provider("deepinfra", "DeepInfra", .openAICompatible, "https://api.deepinfra.com/v1/openai", ""),
        provider("novita", "Novita AI", .openAICompatible, "https://api.novita.ai/v3/openai", ""),
        provider("siliconflow", "SiliconFlow", .openAICompatible, "https://api.siliconflow.cn/v1", "Qwen/Qwen2.5-7B-Instruct"),
        provider("modelscope", "ModelScope 魔搭", .openAICompatible, "https://api-inference.modelscope.cn/v1", ""),
        provider("dashscope", "阿里云百炼", .openAICompatible, "https://dashscope.aliyuncs.com/compatible-mode/v1", ""),
        provider("moonshot", "Moonshot", .openAICompatible, "https://api.moonshot.cn/v1", "moonshot-v1-8k"),
        provider("zhipu", "智谱 GLM", .openAICompatible, "https://open.bigmodel.cn/api/paas/v4", ""),
        provider("qianfan", "百度千帆", .openAICompatible, "https://qianfan.baidubce.com/v2", ""),
        provider("hunyuan", "腾讯混元", .openAICompatible, "https://api.hunyuan.cloud.tencent.com/v1", ""),
        provider("minimax", "MiniMax", .openAICompatible, "https://api.minimax.io/v1", "MiniMax-Text-01"),
        provider("azure-openai", "Azure OpenAI", .openAICompatible, "https://your-resource.openai.azure.com/openai/v1", ""),
        provider("volcengine", "火山方舟", .openAICompatible, "https://ark.cn-beijing.volces.com/api/v3", ""),
        provider("cloudflare-ai-gateway-openai", "Cloudflare AI Gateway", .openAICompatible, "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai", ""),
        provider("custom-openai", customOpenAiRelayName, .openAICompatible, "https://relay.example.com/v1", "", capabilities: customOpenAiRelayCapabilities),
        provider("custom-responses-relay", "Custom relay (OpenAI Responses)", .openAIResponses, "https://relay.example.com/v1", ""),
        provider("custom-anthropic-relay", "Custom relay (Anthropic / Claude)", .anthropic, "https://relay.example.com/v1", "")
    ]
}

public func normalizeOfficialProviderContracts(_ snapshot: AppSnapshot) -> (snapshot: AppSnapshot, changed: Bool) {
    let now = providerRegistryNowMillis()
    let normalizedSnapshotUpdatedAt = max(snapshot.updatedAt, now)
    var changed = false
    var copy = snapshot

    copy.providers = snapshot.providers.map { provider in
        guard isOfficialOpenAIProvider(provider) else {
            return provider
        }

        let currentImageModel = provider.imageModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let imageModel = !currentImageModel.isEmpty && isLikelyImageModelName(currentImageModel)
            ? currentImageModel
            : officialOpenAiImageModel
        let audioSpeechModel = validCapabilityModel(
            provider.audioSpeechModel,
            fallback: officialOpenAiAudioSpeechModel,
            predicate: isLikelyAudioSpeechModelName
        )
        let audioTranscriptionModel = validCapabilityModel(
            provider.audioTranscriptionModel,
            fallback: officialOpenAiAudioTranscriptionModel,
            predicate: isLikelyAudioTranscriptionModelName
        )
        let embeddingModel = validCapabilityModel(
            provider.embeddingModel,
            fallback: officialOpenAiEmbeddingModel,
            predicate: isLikelyEmbeddingModelName
        )
        let moderationModel = validCapabilityModel(
            provider.moderationModel,
            fallback: officialOpenAiModerationModel,
            predicate: isLikelyModerationModelName
        )
        let realtimeModel = validCapabilityModel(
            provider.realtimeModel,
            fallback: officialOpenAiRealtimeModel,
            predicate: isLikelyRealtimeModelName
        )
        let currentModel = provider.model.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = currentModel.isEmpty || currentModel == "gpt-5.4-mini"
            ? officialOpenAiChatModel
            : provider.model
        let listedModels = uniqueModels(provider.models ?? [])
        let models = uniqueModels(listedModels + [
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
            officialOpenAiRealtimeModel
        ])
        let providerChanged =
            provider.kind != .openAIResponses ||
            provider.model != model ||
            provider.needsApiKey != true ||
            provider.imageModel != imageModel ||
            provider.audioSpeechModel != audioSpeechModel ||
            provider.audioTranscriptionModel != audioTranscriptionModel ||
            provider.embeddingModel != embeddingModel ||
            provider.moderationModel != moderationModel ||
            provider.realtimeModel != realtimeModel ||
            (provider.models ?? []) != models ||
            (provider.capabilities ?? []) != officialOpenAiCapabilities

        guard providerChanged else {
            return provider
        }

        changed = true
        var updated = provider
        updated.kind = .openAIResponses
        updated.model = model
        updated.imageModel = imageModel
        updated.audioSpeechModel = audioSpeechModel
        updated.audioTranscriptionModel = audioTranscriptionModel
        updated.embeddingModel = embeddingModel
        updated.moderationModel = moderationModel
        updated.realtimeModel = realtimeModel
        updated.models = models
        updated.capabilities = officialOpenAiCapabilities
        updated.needsApiKey = true
        updated.updatedAt = max(provider.updatedAt, now)
        return updated
    }

    if changed {
        copy.updatedAt = normalizedSnapshotUpdatedAt
    }

    return (copy, changed)
}

private func validCapabilityModel(
    _ value: String?,
    fallback: String,
    predicate: (String) -> Bool
) -> String {
    let model = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !model.isEmpty && predicate(model) ? model : fallback
}

public func isOfficialOpenAIProvider(_ provider: ProviderConfig) -> Bool {
    provider.custom != true &&
        provider.name == "OpenAI" &&
        provider.baseUrl == "https://api.openai.com/v1"
}

public func isLikelyImageModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    return [
        "dall-e",
        "flux",
        "gpt-image",
        "image",
        "imagen",
        "midjourney",
        "stable-diffusion"
    ].contains { normalized.contains($0) }
}

public func isLikelyImageEditingModelName(_ model: String) -> Bool {
    isLikelyImageModelName(model) && !model.lowercased().contains("dall-e-3")
}

public func isLikelyChatModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    if normalized.contains("audio-preview") {
        return true
    }

    return [
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
    ].allSatisfy { !normalized.contains($0) }
}

public func selectableModelsForProvider(_ provider: ProviderConfig?) -> [String] {
    guard let provider else { return [] }

    let listedModels = uniqueModels(provider.models ?? [])
    if !listedModels.isEmpty {
        return listedModels
    }

    return uniqueModels([
        provider.model,
        provider.imageModel ?? "",
        provider.audioSpeechModel ?? "",
        provider.audioTranscriptionModel ?? "",
        provider.embeddingModel ?? "",
        provider.moderationModel ?? "",
        provider.realtimeModel ?? ""
    ])
}

public func chatModelsForProvider(_ provider: ProviderConfig?) -> [String] {
    selectableModelsForProvider(provider).filter(isLikelyChatModelName)
}

private func modelVersionScore(_ model: String, family: String) -> Int {
    // Dated model ids such as gpt-5-2025-08-07 are snapshots, not revisions.
    let versionSource = model.replacingOccurrences(
        of: "[-_]\\d{4}[-_]\\d{2}[-_]\\d{2}",
        with: "",
        options: .regularExpression
    )

    guard let familyRange = versionSource.range(of: family, options: [.caseInsensitive]) else {
        return 0
    }

    var index = familyRange.upperBound
    while index < versionSource.endIndex,
          versionSource[index] == "-" || versionSource[index] == "_" || versionSource[index] == " " {
        index = versionSource.index(after: index)
    }

    var parts: [Int] = []
    var current = ""

    while index < versionSource.endIndex {
        let character = versionSource[index]

        if character.wholeNumberValue != nil {
            current.append(character)
            index = versionSource.index(after: index)
            continue
        }

        if character == "." || character == "-" || character == "_" {
            let next = versionSource.index(after: index)
            if !current.isEmpty,
               next < versionSource.endIndex,
               versionSource[next].wholeNumberValue != nil {
                parts.append(Int(current) ?? 0)
                current = ""
                index = next
                continue
            }
        }

        break
    }

    if !current.isEmpty {
        parts.append(Int(current) ?? 0)
    }

    return parts
        .prefix(3)
        .enumerated()
        .reduce(0) { score, item in
            let value = item.element
            if item.offset >= 2, value > 99 {
                return score
            }
            switch item.offset {
            case 0:
                return score + value * 10_000
            case 1:
                return score + value * 100
            default:
                return score + value
            }
        }
}

private func modelVariantPreferenceScore(_ model: String) -> Int {
    let variants = model.lowercased().split { character in
        !character.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) }
    }

    if variants.contains("sol") { return 1_200 }
    if variants.contains("terra") { return 800 }
    if variants.contains("luna") { return 400 }
    return 0
}

public func chatModelPreferenceScore(_ model: String) -> Int {
    let normalized = model.lowercased()
    let parts = normalized.split { character in
        !character.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) }
    }
    var score = 0

    if normalized.contains("gpt-") {
        score += 100_000 + modelVersionScore(normalized, family: "gpt") + modelVariantPreferenceScore(normalized)
    }

    if parts.contains(where: { $0 == "o4" }) {
        score += 94_000
    } else if parts.contains(where: { $0 == "o3" }) {
        score += 93_000
    }

    if normalized.contains("claude"), normalized.contains("opus") {
        score += 92_000
    } else if normalized.contains("claude"), normalized.contains("sonnet") {
        score += 90_000
    }

    if normalized.contains("gemini"), normalized.contains("pro") {
        score += 88_000
    }
    if normalized.contains("grok") {
        score += 86_000
    }
    if normalized.contains("deepseek"), normalized.contains("r1") {
        score += 84_000
    }
    if normalized.contains("qwen"),
       ["max", "plus", "coder"].contains(where: { normalized.contains($0) }) {
        score += 82_000
    }

    if normalized.range(of: #"\bpro\b"#, options: .regularExpression) != nil { score += 900 }
    if normalized.range(of: #"\bmax\b"#, options: .regularExpression) != nil { score += 850 }
    if normalized.range(of: #"\breasoning\b"#, options: .regularExpression) != nil { score += 780 }
    if normalized.range(of: #"\bthinking\b"#, options: .regularExpression) != nil { score += 740 }
    if normalized.range(of: #"\blarge\b"#, options: .regularExpression) != nil { score += 650 }
    if normalized.range(of: #"\blatest\b"#, options: .regularExpression) != nil { score += 500 }

    if normalized.contains("mini") { score -= 1_200 }
    if normalized.contains("nano") { score -= 1_800 }
    if normalized.contains("lite") { score -= 1_600 }
    if normalized.contains("small") { score -= 1_300 }
    if normalized.contains("flash") { score -= 1_000 }
    if normalized.contains("spark") { score -= 800 }
    if normalized.contains("compact") { score -= 700 }
    if normalized.contains("auto-review") { score -= 2_500 }

    return score
}

public func preferredChatModel(_ models: [String]) -> String {
    models
        .filter(isLikelyChatModelName)
        .sorted {
            let leftScore = chatModelPreferenceScore($0)
            let rightScore = chatModelPreferenceScore($1)
            return leftScore == rightScore ? $0 < $1 : leftScore > rightScore
        }
        .first ?? ""
}

public func defaultChatModelForProvider(_ provider: ProviderConfig?) -> String {
    modelForProviderCapability(provider, capability: .chat)
}

public func chatModelForConversation(_ conversation: Conversation?, provider: ProviderConfig?) -> String {
    let models = chatModelsForProvider(provider)
    let conversationModel = conversation?.model.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    if !conversationModel.isEmpty, models.contains(conversationModel) {
        return conversationModel
    }

    return defaultChatModelForProvider(provider)
}

private func declaredProviderCapabilities(_ provider: ProviderConfig) -> [String] {
    if let capabilities = provider.capabilities, !capabilities.isEmpty {
        return capabilities
    }

    switch provider.kind {
    case .anthropic:
        return ["chat", "vision", "tools", "model-list"]
    case .openAIResponses:
        return ["chat", "vision", "tools", "image-generation", "image-editing", "model-list"]
    case .openAICompatible:
        return ["chat", "vision", "tools", "embeddings", "model-list"]
    }
}

private func providerDeclaresCapability(
    _ provider: ProviderConfig?,
    _ capability: ProviderModelCapability
) -> Bool {
    guard let provider, provider.kind != .anthropic else { return false }

    let capabilities = declaredProviderCapabilities(provider)
    switch capability {
    case .audio:
        return capabilities.contains("audio")
    case .chat:
        return capabilities.contains("chat")
    case .imageGeneration:
        return capabilities.contains("image-generation")
    case .imageEditing:
        return capabilities.contains("image-editing")
    case .embeddings:
        return capabilities.contains("embeddings")
    case .realtime:
        return capabilities.contains("realtime")
    case .moderation:
        return capabilities.contains("moderation")
    }
}

private func hasAuthoritativeModelCatalog(_ provider: ProviderConfig?) -> Bool {
    guard let provider else { return false }
    return !uniqueModels(provider.models ?? []).isEmpty
}

private func standardFallbackModelsForCapability(
    _ provider: ProviderConfig?,
    capability: ProviderModelCapability,
    models: [String]
) -> [String] {
    if !models.isEmpty {
        return models
    }

    guard providerDeclaresCapability(provider, capability) else { return [] }

    if hasAuthoritativeModelCatalog(provider) {
        return selectableModelsForProvider(provider).filter {
            !$0.lowercased().contains(generationOnlyImageModelMarker)
        }
    }

    switch capability {
    case .embeddings:
        return standardEmbeddingModelFallbacks
    case .audio:
        return standardAudioTranscriptionModelFallbacks + standardAudioSpeechModelFallbacks
    case .realtime:
        return standardRealtimeModelFallbacks
    case .moderation:
        return standardModerationModelFallbacks
    default:
        return []
    }
}

private func audioModelsForProvider(
    _ provider: ProviderConfig?,
    transcription: Bool
) -> [String] {
    let models = selectableModelsForProvider(provider).filter {
        transcription
            ? isLikelyAudioTranscriptionModelName($0)
            : isLikelyAudioSpeechModelName($0)
    }
    if !models.isEmpty {
        return models
    }

    guard providerDeclaresCapability(provider, .audio) else { return [] }
    if hasAuthoritativeModelCatalog(provider) {
        return selectableModelsForProvider(provider).filter {
            !$0.lowercased().contains(generationOnlyImageModelMarker)
        }
    }

    return transcription
        ? standardAudioTranscriptionModelFallbacks
        : standardAudioSpeechModelFallbacks
}

public func imageModelsForProvider(_ provider: ProviderConfig?) -> [String] {
    guard let provider, provider.kind != .anthropic else { return [] }
    return standardFallbackModelsForCapability(
        provider,
        capability: .imageGeneration,
        models: selectableModelsForProvider(provider).filter(isLikelyImageModelName)
    )
}

public func imageEditingModelsForProvider(_ provider: ProviderConfig?) -> [String] {
    guard let provider, provider.kind != .anthropic else { return [] }
    return standardFallbackModelsForCapability(
        provider,
        capability: .imageEditing,
        models: selectableModelsForProvider(provider).filter(isLikelyImageEditingModelName)
    )
}

public func preferredImageModel(_ models: [String]) -> String {
    for marker in ["gpt-image-2", "gpt-image-1", "dall-e-3", "dall-e-2", "imagen", "flux"] {
        if let match = models.first(where: { $0.lowercased().contains(marker) }) {
            return match
        }
    }

    return models.first(where: isLikelyImageModelName) ?? ""
}

public func isLikelyEmbeddingModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    return normalized.contains("embed") || normalized.contains("embedding")
}

public func isLikelyAudioModelName(_ model: String) -> Bool {
    model.lowercased().contains("audio") ||
        isLikelyAudioSpeechModelName(model) ||
        isLikelyAudioTranscriptionModelName(model)
}

public func isLikelyAudioSpeechModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    return ["tts", "speech"].contains { normalized.contains($0) }
}

public func isLikelyAudioTranscriptionModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    return ["whisper", "transcri"].contains { normalized.contains($0) }
}

public func isLikelyRealtimeModelName(_ model: String) -> Bool {
    let normalized = model.lowercased()
    return normalized.contains("realtime") || normalized.range(of: #"^gpt-audio(?:-|$)"#, options: .regularExpression) != nil
}

public func isLikelyModerationModelName(_ model: String) -> Bool {
    model.lowercased().contains("moderation")
}

public func modelCapabilityKeysForModel(_ model: String) -> [String] {
    var keys: [String] = []
    let audioSpeech = isLikelyAudioSpeechModelName(model)
    let audioTranscription = isLikelyAudioTranscriptionModelName(model)

    if isLikelyChatModelName(model) {
        keys.append("capability.chat")
    }
    if isLikelyImageModelName(model) {
        keys.append("capability.image-generation")
    }
    if isLikelyImageEditingModelName(model) {
        keys.append("capability.image-editing")
    }
    if isLikelyAudioModelName(model), !audioSpeech, !audioTranscription {
        keys.append("capability.audio")
    }
    if audioSpeech {
        keys.append("capability.audio-speech")
    }
    if audioTranscription {
        keys.append("capability.audio-transcription")
    }
    if isLikelyEmbeddingModelName(model) {
        keys.append("capability.embeddings")
    }
    if isLikelyRealtimeModelName(model) {
        keys.append("capability.realtime")
    }
    if isLikelyModerationModelName(model) {
        keys.append("capability.moderation")
    }

    return keys
}

private func preferredModelByMarkers(
    _ models: [String],
    markers: [String],
    isLikelyModel: (String) -> Bool
) -> String {
    for marker in markers {
        if let match = models.first(where: { $0.lowercased().contains(marker) }) {
            return match
        }
    }

    return models.first(where: isLikelyModel) ?? ""
}

public func preferredEmbeddingModel(_ models: [String]) -> String {
    preferredModelByMarkers(
        models,
        markers: ["text-embedding-3-large", "text-embedding-3-small", "embedding", "embed"],
        isLikelyModel: isLikelyEmbeddingModelName
    )
}

public func preferredAudioSpeechModel(_ models: [String]) -> String {
    preferredModelByMarkers(
        models,
        markers: [
            "gpt-4o-mini-tts",
            "tts-1-hd",
            "tts-1",
            "speech"
        ],
        isLikelyModel: isLikelyAudioSpeechModelName
    )
}

public func preferredAudioTranscriptionModel(_ models: [String]) -> String {
    preferredModelByMarkers(
        models,
        markers: [
            "gpt-4o-transcribe",
            "gpt-4o-mini-transcribe",
            "whisper-1",
            "transcribe",
            "whisper"
        ],
        isLikelyModel: isLikelyAudioTranscriptionModelName
    )
}

public func preferredAudioModel(_ models: [String]) -> String {
    let transcriptionModel = preferredAudioTranscriptionModel(models)
    if !transcriptionModel.isEmpty {
        return transcriptionModel
    }

    let speechModel = preferredAudioSpeechModel(models)
    if !speechModel.isEmpty {
        return speechModel
    }

    return preferredModelByMarkers(models, markers: ["audio"], isLikelyModel: isLikelyAudioModelName)
}

public func modelForProviderAudioSpeech(_ provider: ProviderConfig?) -> String {
    let models = audioModelsForProvider(provider, transcription: false)
    let configured = provider?.audioSpeechModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !configured.isEmpty, models.contains(configured) { return configured }
    return preferredAudioSpeechModel(models)
}

public func modelForProviderAudioTranscription(_ provider: ProviderConfig?) -> String {
    let models = audioModelsForProvider(provider, transcription: true)
    let configured = provider?.audioTranscriptionModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !configured.isEmpty, models.contains(configured) { return configured }
    return preferredAudioTranscriptionModel(models)
}

public func preferredRealtimeModel(_ models: [String]) -> String {
    preferredModelByMarkers(
        models,
        markers: [
            "gpt-realtime-2",
            "gpt-audio-1.5",
            "gpt-realtime",
            "gpt-audio-mini",
            "gpt-realtime-mini",
            "gpt-4o-realtime",
            "realtime"
        ],
        isLikelyModel: isLikelyRealtimeModelName
    )
}

public func preferredModerationModel(_ models: [String]) -> String {
    preferredModelByMarkers(
        models,
        markers: ["omni-moderation-latest", "omni-moderation", "moderation-latest", "moderation"],
        isLikelyModel: isLikelyModerationModelName
    )
}

public func modelsForProviderCapability(_ provider: ProviderConfig?, capability: ProviderModelCapability) -> [String] {
    guard let provider else { return [] }

    switch capability {
    case .chat:
        return chatModelsForProvider(provider)
    case .imageGeneration:
        return imageModelsForProvider(provider)
    case .imageEditing:
        return imageEditingModelsForProvider(provider)
    case .embeddings:
        return standardFallbackModelsForCapability(
            provider,
            capability: capability,
            models: selectableModelsForProvider(provider).filter(isLikelyEmbeddingModelName)
        )
    case .audio:
        return standardFallbackModelsForCapability(
            provider,
            capability: capability,
            models: selectableModelsForProvider(provider).filter(isLikelyAudioModelName)
        )
    case .realtime:
        return standardFallbackModelsForCapability(
            provider,
            capability: capability,
            models: selectableModelsForProvider(provider).filter(isLikelyRealtimeModelName)
        )
    case .moderation:
        return standardFallbackModelsForCapability(
            provider,
            capability: capability,
            models: selectableModelsForProvider(provider).filter(isLikelyModerationModelName)
        )
    }
}

public func preferredModelForCapability(_ models: [String], capability: ProviderModelCapability) -> String {
    switch capability {
    case .chat:
        return preferredChatModel(models)
    case .imageGeneration, .imageEditing:
        return preferredImageModel(models)
    case .embeddings:
        return preferredEmbeddingModel(models)
    case .audio:
        return preferredAudioModel(models)
    case .realtime:
        return preferredRealtimeModel(models)
    case .moderation:
        return preferredModerationModel(models)
    }
}

public func modelForProviderCapability(_ provider: ProviderConfig?, capability: ProviderModelCapability) -> String {
    guard let provider else { return "" }

    let models = modelsForProviderCapability(provider, capability: capability)
    let configuredModel: String
    switch capability {
    case .chat:
        configuredModel = provider.model.trimmingCharacters(in: .whitespacesAndNewlines)
    case .imageGeneration, .imageEditing:
        configuredModel = provider.imageModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    case .embeddings:
        configuredModel = provider.embeddingModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    case .audio:
        let speechModel = provider.audioSpeechModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        configuredModel = !speechModel.isEmpty
            ? speechModel
            : provider.audioTranscriptionModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    case .realtime:
        configuredModel = provider.realtimeModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    case .moderation:
        configuredModel = provider.moderationModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    if !configuredModel.isEmpty, models.contains(configuredModel) {
        return configuredModel
    }

    return preferredModelForCapability(models, capability: capability)
}

public func imageModelForProvider(_ provider: ProviderConfig?) -> String {
    modelForProviderCapability(provider, capability: .imageGeneration)
}

private func addCapability(_ capabilities: inout [String], _ capability: String) {
    if !capabilities.contains(capability) {
        capabilities.append(capability)
    }
}

public func capabilitiesForModelList(_ provider: ProviderConfig, models: [String]) -> [String] {
    var capabilities = provider.capabilities ?? []
    if capabilities.isEmpty {
        switch provider.kind {
        case .anthropic:
            capabilities = ["chat", "vision", "tools", "model-list"]
        case .openAIResponses:
            capabilities = ["chat", "vision", "tools", "image-generation", "image-editing", "model-list"]
        case .openAICompatible:
            capabilities = ["chat", "vision", "tools", "embeddings", "model-list"]
        }
    }

    if models.contains(where: isLikelyImageModelName) {
        addCapability(&capabilities, "image-generation")
    }
    if models.contains(where: isLikelyImageEditingModelName) {
        addCapability(&capabilities, "image-editing")
    }

    for model in models {
        if isLikelyEmbeddingModelName(model) {
            addCapability(&capabilities, "embeddings")
        }
        if isLikelyAudioModelName(model) {
            addCapability(&capabilities, "audio")
        }
        if isLikelyRealtimeModelName(model) {
            addCapability(&capabilities, "realtime")
        }
        if isLikelyModerationModelName(model) {
            addCapability(&capabilities, "moderation")
        }
    }

    return capabilities
}

public func applyFetchedProviderModels(_ provider: inout ProviderConfig, models: [String]) {
    let nextModels = uniqueModels(models)
    guard !nextModels.isEmpty else { return }

    let previousModels = uniqueModels(provider.models ?? [])
    let chatModels = nextModels.filter(isLikelyChatModelName)
    let imageModels = nextModels.filter(isLikelyImageModelName)
    let audioSpeechModels = nextModels.filter(isLikelyAudioSpeechModelName)
    let audioTranscriptionModels = nextModels.filter(isLikelyAudioTranscriptionModelName)
    let embeddingModels = nextModels.filter(isLikelyEmbeddingModelName)
    let moderationModels = nextModels.filter(isLikelyModerationModelName)
    let realtimeModels = nextModels.filter(isLikelyRealtimeModelName)

    provider.models = nextModels
    provider.model = preferredFetchedModel(
        currentModel: provider.model,
        previousModels: previousModels.filter(isLikelyChatModelName),
        fetchedModels: chatModels,
        preferredModel: preferredChatModel
    )
    let imageModel = preferredFetchedModel(
        currentModel: provider.imageModel,
        previousModels: previousModels.filter(isLikelyImageModelName),
        fetchedModels: imageModels,
        preferredModel: preferredImageModel
    )
    provider.imageModel = imageModel.isEmpty ? nil : imageModel
    let audioSpeechModel = preferredFetchedModel(
        currentModel: provider.audioSpeechModel,
        previousModels: previousModels.filter(isLikelyAudioSpeechModelName),
        fetchedModels: audioSpeechModels,
        preferredModel: preferredAudioSpeechModel
    )
    provider.audioSpeechModel = audioSpeechModel.isEmpty ? nil : audioSpeechModel
    let audioTranscriptionModel = preferredFetchedModel(
        currentModel: provider.audioTranscriptionModel,
        previousModels: previousModels.filter(isLikelyAudioTranscriptionModelName),
        fetchedModels: audioTranscriptionModels,
        preferredModel: preferredAudioTranscriptionModel
    )
    provider.audioTranscriptionModel = audioTranscriptionModel.isEmpty ? nil : audioTranscriptionModel
    let embeddingModel = preferredFetchedModel(
        currentModel: provider.embeddingModel,
        previousModels: previousModels.filter(isLikelyEmbeddingModelName),
        fetchedModels: embeddingModels,
        preferredModel: preferredEmbeddingModel
    )
    provider.embeddingModel = embeddingModel.isEmpty ? nil : embeddingModel
    let moderationModel = preferredFetchedModel(
        currentModel: provider.moderationModel,
        previousModels: previousModels.filter(isLikelyModerationModelName),
        fetchedModels: moderationModels,
        preferredModel: preferredModerationModel
    )
    provider.moderationModel = moderationModel.isEmpty ? nil : moderationModel
    let realtimeModel = preferredFetchedModel(
        currentModel: provider.realtimeModel,
        previousModels: previousModels.filter(isLikelyRealtimeModelName),
        fetchedModels: realtimeModels,
        preferredModel: preferredRealtimeModel
    )
    provider.realtimeModel = realtimeModel.isEmpty ? nil : realtimeModel
    provider.capabilities = capabilitiesForModelList(provider, models: nextModels)
}

public func applyConfiguredProviderModels(_ provider: inout ProviderConfig, models: [String]) {
    let nextModels = uniqueModels(models)
    let chatModels = nextModels.filter(isLikelyChatModelName)
    let imageModels = nextModels.filter(isLikelyImageModelName)
    let audioSpeechModels = nextModels.filter(isLikelyAudioSpeechModelName)
    let audioTranscriptionModels = nextModels.filter(isLikelyAudioTranscriptionModelName)
    let embeddingModels = nextModels.filter(isLikelyEmbeddingModelName)
    let moderationModels = nextModels.filter(isLikelyModerationModelName)
    let realtimeModels = nextModels.filter(isLikelyRealtimeModelName)

    provider.models = nextModels
    provider.model = configuredOrPreferredModel(
        currentModel: provider.model,
        models: chatModels,
        preferredModel: preferredChatModel
    )
    let imageModel = configuredOrPreferredModel(
        currentModel: provider.imageModel,
        models: imageModels,
        preferredModel: preferredImageModel
    )
    provider.imageModel = imageModel.isEmpty ? nil : imageModel
    let audioSpeechModel = configuredOrPreferredModel(
        currentModel: provider.audioSpeechModel,
        models: audioSpeechModels,
        preferredModel: preferredAudioSpeechModel
    )
    provider.audioSpeechModel = audioSpeechModel.isEmpty ? nil : audioSpeechModel
    let audioTranscriptionModel = configuredOrPreferredModel(
        currentModel: provider.audioTranscriptionModel,
        models: audioTranscriptionModels,
        preferredModel: preferredAudioTranscriptionModel
    )
    provider.audioTranscriptionModel = audioTranscriptionModel.isEmpty ? nil : audioTranscriptionModel
    let embeddingModel = configuredOrPreferredModel(
        currentModel: provider.embeddingModel,
        models: embeddingModels,
        preferredModel: preferredEmbeddingModel
    )
    provider.embeddingModel = embeddingModel.isEmpty ? nil : embeddingModel
    let moderationModel = configuredOrPreferredModel(
        currentModel: provider.moderationModel,
        models: moderationModels,
        preferredModel: preferredModerationModel
    )
    provider.moderationModel = moderationModel.isEmpty ? nil : moderationModel
    let realtimeModel = configuredOrPreferredModel(
        currentModel: provider.realtimeModel,
        models: realtimeModels,
        preferredModel: preferredRealtimeModel
    )
    provider.realtimeModel = realtimeModel.isEmpty ? nil : realtimeModel
    provider.capabilities = capabilitiesForModelList(provider, models: nextModels)
}

private func preferredFetchedModel(
    currentModel: String?,
    previousModels: [String],
    fetchedModels: [String],
    preferredModel: ([String]) -> String
) -> String {
    let current = currentModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    guard !fetchedModels.isEmpty else { return "" }

    if current.isEmpty || !fetchedModels.contains(current) {
        return preferredModel(fetchedModels)
    }

    let previousPreferred = preferredModel(previousModels)
    return !previousPreferred.isEmpty && current == previousPreferred
        ? preferredModel(fetchedModels)
        : current
}

private func configuredOrPreferredModel(
    currentModel: String?,
    models: [String],
    preferredModel: ([String]) -> String
) -> String {
    let current = currentModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !current.isEmpty && models.contains(current)
        ? current
        : preferredModel(models)
}

public func uniqueModels(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !seen.contains(trimmed) else { return nil }
        seen.insert(trimmed)
        return trimmed
    }
}

private func providerRegistryNowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}
