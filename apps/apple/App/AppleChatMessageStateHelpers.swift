import ZeroChatCore

struct AppleRegenerateDraft {
    let input: String
    let editingMessageId: String
}

func appleStreamingAssistantMessage(id: String, content: String, createdAt: Int64) -> ChatMessage {
    ChatMessage(
        id: id,
        role: .assistant,
        content: content,
        createdAt: createdAt,
        status: "streaming"
    )
}

func applePendingChatConversation(
    conversation: Conversation,
    request: PreparedChatRequest,
    assistant: ChatMessage,
    title: String,
    now: Int64
) -> Conversation {
    var pending = conversation
    pending.model = request.model
    pending.title = title
    pending.messages = request.baseMessages + [assistant]
    pending.updatedAt = now
    return pending
}

func applePendingImageConversation(
    conversation: Conversation,
    assistant: ChatMessage,
    now: Int64
) -> Conversation {
    var pending = conversation
    pending.messages.append(assistant)
    pending.updatedAt = now
    return pending
}

func appleCompletedGeneratedImageMessage(
    assistant: ChatMessage,
    image: GeneratedImage,
    request: PreparedImageRequest,
    attachmentId: String,
    now: Int64
) -> ChatMessage {
    var completed = assistant
    completed.content = image.revisedPrompt?.isEmpty == false ? image.revisedPrompt! : request.prompt
    completed.status = "done"
    completed.attachments = [
        MessageAttachment(
            id: attachmentId,
            kind: "image",
            purpose: "generated",
            mimeType: image.mimeType,
            dataUrl: image.dataUrl,
            url: image.url,
            alt: request.prompt,
            model: request.imageModel,
            createdAt: now
        )
    ]
    return completed
}

func appleFailedImageMessage(assistant: ChatMessage, content: String, error: String) -> ChatMessage {
    var failed = assistant
    failed.content = content
    failed.status = "error"
    failed.error = error
    failed.attachments = []
    return failed
}

func appleStoppedImageMessage(assistant: ChatMessage, stoppedContent: String) -> ChatMessage {
    var stopped = assistant
    stopped.content = stoppedContent
    stopped.status = "done"
    stopped.error = nil
    stopped.attachments = []
    return stopped
}

func appleUpdatedStreamingAssistantConversation(
    snapshot: AppSnapshot,
    conversationId: String,
    assistantId: String,
    content: String,
    now: Int64
) -> Conversation? {
    guard var conversation = snapshot.conversations.first(where: { $0.id == conversationId }),
          let index = conversation.messages.firstIndex(where: { $0.id == assistantId }) else {
        return nil
    }

    conversation.messages[index].content = content
    conversation.messages[index].status = "streaming"
    conversation.messages[index].error = nil
    conversation.updatedAt = now
    return conversation
}

func appleStreamingAssistantContent(
    snapshot: AppSnapshot,
    conversationId: String,
    assistantId: String
) -> String {
    snapshot.conversations
        .first { $0.id == conversationId }?
        .messages
        .first { $0.id == assistantId }?
        .content ?? ""
}

func appleStoppedAssistantMessage(
    assistant: ChatMessage,
    partialContent: String,
    stoppedContent: String
) -> ChatMessage {
    var stopped = assistant
    stopped.content = partialContent.isEmpty ? stoppedContent : partialContent
    stopped.status = "done"
    stopped.error = nil
    return stopped
}

func appleCompletedAssistantConversation(
    snapshot: AppSnapshot,
    conversationId: String,
    assistantId: String,
    message: ChatMessage,
    now: Int64
) -> Conversation? {
    guard var conversation = snapshot.conversations.first(where: { $0.id == conversationId }),
          let index = conversation.messages.firstIndex(where: { $0.id == assistantId }) else {
        return nil
    }

    conversation.messages[index] = message
    conversation.updatedAt = now
    return conversation
}

func appleDeletedMessageConversation(
    conversation: Conversation,
    messageId: String,
    now: Int64
) -> Conversation? {
    guard conversation.messages.contains(where: { $0.id == messageId }) else {
        return nil
    }

    var updated = conversation
    updated.messages.removeAll { $0.id == messageId }
    updated.updatedAt = now
    return updated
}

func appleRegenerateDraft(conversation: Conversation, assistantId: String) -> AppleRegenerateDraft? {
    guard let assistantIndex = conversation.messages.firstIndex(where: { $0.id == assistantId }),
          let user = conversation.messages[..<assistantIndex].last(where: { $0.role == .user }) else {
        return nil
    }

    return AppleRegenerateDraft(input: user.content, editingMessageId: user.id)
}
