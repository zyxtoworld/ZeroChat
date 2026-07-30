import ZeroChatCore

func configuredModels(for provider: ProviderConfig?) -> [String] {
    selectableModelsForProvider(provider)
}

func chatModels(for provider: ProviderConfig?) -> [String] {
    chatModelsForProvider(provider)
}

func fallbackChatModel(for provider: ProviderConfig) -> String {
    defaultChatModelForProvider(provider)
}

func imageModels(for provider: ProviderConfig?) -> [String] {
    imageModelsForProvider(provider)
}

func providerModelCapabilityKeys(for provider: ProviderConfig?) -> [String] {
    let capabilityOrder = [
        "capability.chat",
        "capability.image-generation",
        "capability.image-editing",
        "capability.audio",
        "capability.audio-speech",
        "capability.audio-transcription",
        "capability.embeddings",
        "capability.moderation",
        "capability.realtime",
    ]
    let capabilityKeys = Set(configuredModels(for: provider).flatMap(modelCapabilityKeysForModel))

    return capabilityOrder.filter { capabilityKeys.contains($0) }
}

func providerModelCapabilitySummary(for provider: ProviderConfig?, i18n: NativeI18n) -> String {
    providerModelCapabilityKeys(for: provider)
        .map { i18n.t($0) }
        .joined(separator: " / ")
}
