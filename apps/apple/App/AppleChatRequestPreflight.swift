import Foundation
import ZeroChatCore

struct PreparedChatRequest {
    let provider: ProviderConfig
    let model: String
    let baseMessages: [ChatMessage]
}

struct PreparedMessageSpeechRequest {
    let provider: ProviderConfig
    let model: String
    let input: String
}

enum AppleChatRequestPreflightResult {
    case ready(PreparedChatRequest)
    case blocked(AppNotice)
}

enum AppleMessageSpeechRequestPreflightResult {
    case ready(PreparedMessageSpeechRequest)
    case blocked(AppNotice)
}

func applePrepareChatRequest(
    isChatStreaming: Bool,
    provider: ProviderConfig?,
    model: String,
    providerKeyMissing: Bool,
    input: String,
    editingMessageId: String?,
    messages: [ChatMessage],
    newUserMessageId: String,
    now: Int64,
    i18n: NativeI18n
) -> AppleChatRequestPreflightResult {
    guard !isChatStreaming else {
        return .blocked(AppNotice(message: i18n.t("message.generating"), kind: .warning))
    }
    guard let provider else {
        return .blocked(AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning))
    }
    guard !model.isEmpty else {
        return .blocked(AppNotice(message: i18n.t("message.chooseModel"), kind: .warning))
    }
    guard !providerKeyMissing else {
        return .blocked(AppNotice(message: i18n.t("error.providerKeyRequired"), kind: .warning))
    }

    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return .blocked(AppNotice(message: i18n.t("message.emptyInput"), kind: .warning))
    }

    let baseMessages: [ChatMessage]
    if let editingMessageId,
       let index = messages.firstIndex(where: { $0.id == editingMessageId }),
       messages[index].role == .user {
        var edited = messages[index]
        edited.content = trimmed
        edited.createdAt = now
        edited.status = "done"
        edited.error = nil
        baseMessages = Array(messages[..<index]) + [edited]
    } else {
        baseMessages = messages + [
            ChatMessage(id: newUserMessageId, role: .user, content: trimmed, createdAt: now)
        ]
    }

    return .ready(PreparedChatRequest(
        provider: provider,
        model: model,
        baseMessages: baseMessages
    ))
}

func applePrepareMessageSpeechRequest(
    provider: ProviderConfig?,
    model: String,
    providerKeyMissing: Bool,
    message: ChatMessage,
    i18n: NativeI18n
) -> AppleMessageSpeechRequestPreflightResult {
    let input = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !input.isEmpty else {
        return .blocked(AppNotice(message: i18n.t("notice.audioSpeechEmpty"), kind: .warning))
    }
    guard message.status != "streaming" else {
        return .blocked(AppNotice(message: i18n.t("message.generating"), kind: .warning))
    }
    guard let provider else {
        return .blocked(AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning))
    }
    guard !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return .blocked(AppNotice(message: i18n.t("message.audioSpeechModelRequired"), kind: .warning))
    }
    guard !providerKeyMissing else {
        return .blocked(AppNotice(message: i18n.t("error.providerKeyRequired"), kind: .warning))
    }

    return .ready(PreparedMessageSpeechRequest(
        provider: provider,
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        input: input
    ))
}
