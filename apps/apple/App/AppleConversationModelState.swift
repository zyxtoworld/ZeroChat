import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    var activeConversationId: String? {
        get { snapshot.preferences.activeConversationId ?? snapshot.conversations.first?.id }
        set {
            var preferences = snapshot.preferences
            preferences.activeConversationId = newValue
            commit(snapshot.with(preferences: preferences))
        }
    }

    var defaultActiveConversationId: String? {
        snapshot.preferences.activeConversationId ?? snapshot.conversations.first?.id
    }

    func conversation(id: String?) -> Conversation? {
        let resolvedId = id ?? defaultActiveConversationId
        guard let resolvedId else {
            return nil
        }
        return snapshot.conversations.first { $0.id == resolvedId }
    }

    var activeConversation: Conversation? {
        conversation(id: nil)
    }

    var enabledProviders: [ProviderConfig] {
        snapshot.providers.filter(\.enabled)
    }

    var i18n: NativeI18n {
        NativeI18n(mode: snapshot.preferences.language)
    }

    var activeProvider: ProviderConfig? {
        activeProvider(conversationId: nil)
    }

    func activeProvider(conversationId: String?) -> ProviderConfig? {
        guard let conversation = conversation(id: conversationId) else {
            return enabledProviders.first
        }
        return enabledProviders.first { $0.id == conversation.providerId } ?? enabledProviders.first
    }

    func activeProviderModelTitle(_ i18n: NativeI18n) -> String {
        activeProviderModelTitle(i18n, conversationId: nil)
    }

    func activeProviderModelTitle(_ i18n: NativeI18n, conversationId: String?) -> String {
        let provider = activeProvider(conversationId: conversationId)
        let model = composerMode == .image
            ? provider.map(imageModelForProvider) ?? ""
            : provider.map { chatModelForConversation(conversation(id: conversationId), provider: $0) } ?? ""
        return appleActiveProviderModelTitle(provider: provider, model: model, i18n: i18n)
    }

    func imageModelForProvider(_ provider: ProviderConfig) -> String {
        ZeroChatCore.imageModelForProvider(provider)
    }

    @discardableResult
    func createConversation() -> String? {
        guard let provider = enabledProviders.first else {
            notice = AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning)
            return nil
        }
        let model = defaultChatModelForProvider(provider)
        guard !model.isEmpty else {
            notice = AppNotice(message: i18n.t("message.modelRequired"), kind: .warning)
            return nil
        }
        if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let existing = untouchedActiveConversation()
        {
            return existing.id
        }
        return newConversationIfPossible(provider: provider, model: model)?.id
    }

    func select(provider: ProviderConfig, model: String) {
        _ = select(provider: provider, model: model, conversationId: nil)
    }

    @discardableResult
    func select(provider: ProviderConfig, model: String, conversationId: String?) -> String? {
        guard chatModelOptions(provider).contains(model) else { return nil }
        let result = appleSnapshotBySelectingProviderModel(
            snapshot: snapshot,
            existingConversation: self.conversation(id: conversationId),
            provider: provider,
            selectedModel: model,
            imageMode: false,
            fallbackTitle: i18n.t("title.newChat"),
            newConversationId: UUID().uuidString,
            now: nowMillis()
        )
        commit(result.snapshot)
        return result.conversationId
    }

    func selectImageModel(provider: ProviderConfig, imageModel: String) {
        _ = selectImageModel(provider: provider, imageModel: imageModel, conversationId: nil)
    }

    @discardableResult
    func selectImageModel(provider: ProviderConfig, imageModel: String, conversationId: String?) -> String? {
        guard imageModelOptions(provider).contains(imageModel) else { return nil }
        let result = appleSnapshotBySelectingProviderModel(
            snapshot: snapshot,
            existingConversation: self.conversation(id: conversationId),
            provider: provider,
            selectedModel: imageModel,
            imageMode: true,
            fallbackTitle: i18n.t("title.newChat"),
            newConversationId: UUID().uuidString,
            now: nowMillis()
        )
        commit(result.snapshot)
        return result.conversationId
    }

    func configuredModelOptions(_ provider: ProviderConfig?) -> [String] {
        configuredModels(for: provider)
    }

    func chatModelOptions(_ provider: ProviderConfig?) -> [String] {
        chatModels(for: provider)
    }

    func imageModelOptions(_ provider: ProviderConfig?) -> [String] {
        imageModels(for: provider)
    }

    func deleteMessage(_ id: String, conversationId: String? = nil) {
        guard let conversation = self.conversation(id: conversationId),
              let updated = appleDeletedMessageConversation(
                conversation: conversation,
                messageId: id,
                now: nowMillis()
              ) else {
            return
        }

        if speakingMessageId == id {
            stopSpeaking(showNotice: false)
        }
        replaceConversation(updated)
        notice = AppNotice(message: i18n.t("message.messageDeleted"), kind: .warning)
    }

    @discardableResult
    func deleteConversation(_ id: String) -> String? {
        let removedConversation = snapshot.conversations.first { $0.id == id }
        let result = appleDeletedConversationSnapshot(snapshot: snapshot, conversationId: id)
        guard result.deleted else {
            return result.nextActiveConversationId
        }

        if let speakingMessageId,
           removedConversation?.messages.contains(where: { $0.id == speakingMessageId }) == true {
            stopSpeaking(showNotice: false)
        }
        commit(result.snapshot)
        notice = AppNotice(message: i18n.t("message.conversationDeleted"), kind: .warning)
        return result.nextActiveConversationId
    }

    @discardableResult
    func replaceConversation(_ conversation: Conversation, autoSync: Bool = true) -> String {
        let next = appleSnapshotByUpsertingConversation(
            snapshot: snapshot,
            conversation: conversation
        )
        commit(next, autoSync: autoSync)
        return conversation.id
    }

    func createConversationForSend() -> Conversation? {
        guard let provider = enabledProviders.first else {
            notice = AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning)
            return nil
        }
        let model = defaultChatModelForProvider(provider)
        guard !model.isEmpty else {
            notice = AppNotice(message: i18n.t("message.modelRequired"), kind: .warning)
            return nil
        }
        return untouchedActiveConversation()
            ?? newConversationIfPossible(provider: provider, model: model)
    }
    private func untouchedActiveConversation() -> Conversation? {
        guard let conversation = activeConversation,
              conversation.messages.isEmpty,
              (conversation.title.isEmpty || conversation.title == i18n.t("title.newChat"))
        else {
            return nil
        }
        return conversation
    }


    private func newConversationIfPossible(provider: ProviderConfig, model: String) -> Conversation? {
        let conversation = newConversation(
            provider: provider,
            model: model,
            fallbackTitle: i18n.t("title.newChat")
        )
        let next = appleSnapshotByUpsertingConversation(
            snapshot: snapshot,
            conversation: conversation
        )
        commit(next)
        return conversation
    }
}
