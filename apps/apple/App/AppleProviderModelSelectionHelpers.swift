import ZeroChatCore

struct AppleProviderModelSelectionResult {
    let snapshot: AppSnapshot
    let conversationId: String
}

func appleSnapshotBySelectingProviderModel(
    snapshot: AppSnapshot,
    existingConversation: Conversation?,
    provider: ProviderConfig,
    selectedModel: String,
    imageMode: Bool,
    fallbackTitle: String,
    newConversationId: String,
    now: Int64
) -> AppleProviderModelSelectionResult {
    let chatModel: String
    if imageMode {
        if existingConversation?.providerId == provider.id {
            chatModel = chatModelForConversation(existingConversation, provider: provider)
        } else {
            chatModel = defaultChatModelForProvider(provider)
        }
    } else {
        chatModel = selectedModel
    }
    let baseConversation = existingConversation ?? Conversation(
        id: newConversationId,
        title: fallbackTitle,
        providerId: provider.id,
        model: chatModel,
        messages: [],
        createdAt: now,
        updatedAt: now
    )
    let nextConversation = baseConversation.with(
        providerId: provider.id,
        model: chatModel,
        updatedAt: now
    )
    var nextSnapshot = snapshot
    if imageMode {
        nextSnapshot = appleSnapshotByReplacingProviderImageModel(
            snapshot: snapshot,
            providerId: provider.id,
            imageModel: selectedModel,
            now: now
        )
    }

    return AppleProviderModelSelectionResult(
        snapshot: appleSnapshotByUpsertingConversation(
            snapshot: nextSnapshot,
            conversation: nextConversation
        ),
        conversationId: nextConversation.id
    )
}

private func appleSnapshotByReplacingProviderImageModel(
    snapshot: AppSnapshot,
    providerId: String,
    imageModel: String,
    now: Int64
) -> AppSnapshot {
    var next = snapshot
    next.providers = snapshot.providers.map { provider in
        guard provider.id == providerId else { return provider }
        var copy = provider
        copy.imageModel = imageModel
        copy.updatedAt = now
        return copy
    }
    return next
}
