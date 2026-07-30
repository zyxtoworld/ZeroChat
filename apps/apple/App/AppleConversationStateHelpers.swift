import ZeroChatCore

struct AppleConversationDeletionResult {
    let snapshot: AppSnapshot
    let nextActiveConversationId: String?
    let deleted: Bool
}

func appleSnapshotByUpsertingConversation(
    snapshot: AppSnapshot,
    conversation: Conversation
) -> AppSnapshot {
    var next = snapshot
    if let index = next.conversations.firstIndex(where: { $0.id == conversation.id }) {
        next.conversations[index] = conversation
    } else {
        next.conversations.insert(conversation, at: 0)
    }
    next.preferences.activeConversationId = conversation.id
    return next
}

func appleDeletedConversationSnapshot(
    snapshot: AppSnapshot,
    conversationId: String
) -> AppleConversationDeletionResult {
    let nextConversations = snapshot.conversations.filter { $0.id != conversationId }
    let currentActiveId = snapshot.preferences.activeConversationId
    let nextActiveId: String?
    if currentActiveId == conversationId {
        nextActiveId = nextConversations.first?.id
    } else {
        nextActiveId = currentActiveId.flatMap { activeId in
            nextConversations.contains { $0.id == activeId } ? activeId : nil
        }
    }

    var next = snapshot
    next.conversations = nextConversations
    next.preferences.activeConversationId = nextActiveId
    return AppleConversationDeletionResult(
        snapshot: next,
        nextActiveConversationId: nextActiveId,
        deleted: nextConversations.count != snapshot.conversations.count
    )
}
