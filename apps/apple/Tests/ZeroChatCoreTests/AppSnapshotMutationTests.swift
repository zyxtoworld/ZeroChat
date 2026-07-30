import Testing
@testable import ZeroChatCore

@Test func bootstrapMutationReplaysQuickActionWithoutOverwritingLoadedData() {
    let provider = testProvider(model: "runtime-default", updatedAt: 10)
    let before = AppSnapshot(
        providers: [provider],
        conversations: [],
        preferences: Preferences(language: "system", compactMode: false),
        updatedAt: 10
    )
    let quickConversation = testConversation(id: "quick", title: "Quick", updatedAt: 20)
    var after = before
    after.conversations = [quickConversation]
    after.preferences.activeConversationId = quickConversation.id
    after.preferences.compactMode = true
    after.updatedAt = 20

    let savedConversation = testConversation(id: "saved", title: "Saved", updatedAt: 5)
    let loaded = AppSnapshot(
        providers: [testProvider(model: "saved-custom-model", updatedAt: 5)],
        conversations: [savedConversation],
        preferences: Preferences(language: "zh-CN", compactMode: false),
        updatedAt: 5
    )

    let restored = AppSnapshotMutation(before: before, after: after).applying(to: loaded)

    #expect(restored.providers.first?.model == "saved-custom-model")
    #expect(restored.preferences.language == "zh-CN")
    #expect(restored.preferences.compactMode)
    #expect(restored.preferences.activeConversationId == "quick")
    #expect(Set(restored.conversations.map(\.id)) == Set(["saved", "quick"]))
}

@Test func bootstrapProviderEditChangesOnlyFieldsTouchedBeforeLoadCompletes() {
    let beforeProvider = testProvider(model: "runtime-default", enabled: true, updatedAt: 10)
    var afterProvider = beforeProvider
    afterProvider.enabled = false
    afterProvider.updatedAt = 20

    let before = AppSnapshot(providers: [beforeProvider], updatedAt: 10)
    let after = AppSnapshot(providers: [afterProvider], updatedAt: 20)
    var loadedProvider = testProvider(model: "saved-custom-model", enabled: true, updatedAt: 15)
    loadedProvider.baseUrl = "https://saved.example/v1"
    let loaded = AppSnapshot(providers: [loadedProvider], updatedAt: 15)

    let restored = AppSnapshotMutation(before: before, after: after).applying(to: loaded)
    let provider = restored.providers[0]

    #expect(!provider.enabled)
    #expect(provider.model == "saved-custom-model")
    #expect(provider.baseUrl == "https://saved.example/v1")
    #expect(provider.updatedAt == 20)
}

private func testProvider(
    model: String,
    enabled: Bool = true,
    updatedAt: Int64
) -> ProviderConfig {
    ProviderConfig(
        id: "provider",
        name: "Provider",
        kind: .openAICompatible,
        baseUrl: "https://runtime.example/v1",
        model: model,
        enabled: enabled,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: updatedAt
    )
}

private func testConversation(id: String, title: String, updatedAt: Int64) -> Conversation {
    Conversation(
        id: id,
        title: title,
        providerId: "provider",
        model: "model",
        messages: [],
        createdAt: updatedAt,
        updatedAt: updatedAt
    )
}
