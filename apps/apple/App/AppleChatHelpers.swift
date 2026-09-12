import Foundation
import SwiftUI
import UniformTypeIdentifiers
import ZeroChatCore

func providerDisplayName(_ provider: ProviderConfig, _ i18n: NativeI18n) -> String {
    isDefaultCustomOpenAiRelay(provider) ? i18n.t("provider.preset.custom-openai-relay") : provider.name
}

func applePreferredColorScheme(for theme: String) -> ColorScheme? {
    switch theme {
    case "light":
        return .light
    case "dark":
        return .dark
    default:
        return nil
    }
}

func nativeLayoutDirection(for i18n: NativeI18n) -> LayoutDirection {
    i18n.locale == "ar-SA" ? .rightToLeft : .leftToRight
}

func normalizeConversationSearchValue(_ value: String) -> String {
    value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
}

func conversationMatchesSearch(
    _ conversation: Conversation,
    normalizedQuery: String,
    i18n: NativeI18n
) -> Bool {
    let haystack = ([displayConversationTitle(conversation, i18n), conversation.model] +
        conversation.messages.map(\.content)).joined(separator: "\n")
    return normalizeConversationSearchValue(haystack).contains(normalizedQuery)
}

extension AppSnapshot {
    func with(preferences: Preferences) -> AppSnapshot {
        var copy = self
        copy.preferences = preferences
        return copy
    }

    func withSyncStatus(_ status: String, completed: Bool) -> AppSnapshot {
        var copy = self
        copy.sync.encryptionEnabled = true
        copy.sync.lastSyncStatus = status
        if completed {
            copy.sync.lastSyncAt = nowMillis()
        }
        return copy
    }
}

extension Conversation {
    func with(providerId: String, model: String, updatedAt: Int64) -> Conversation {
        var copy = self
        copy.providerId = providerId
        copy.model = model
        copy.updatedAt = updatedAt
        return copy
    }
}

extension Date {
    init(milliseconds: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
    }
}

func newConversation(provider: ProviderConfig, model: String, fallbackTitle: String) -> Conversation {
    let now = nowMillis()
    return Conversation(
        id: UUID().uuidString,
        title: fallbackTitle,
        providerId: provider.id,
        model: model,
        messages: [],
        createdAt: now,
        updatedAt: now
    )
}

func title(from messages: [ChatMessage], fallbackTitle: String) -> String {
    messages.first { $0.role == .user }?.content.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40).description ?? fallbackTitle
}

func nowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

func mimeType(for url: URL) -> String {
    UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/png"
}
