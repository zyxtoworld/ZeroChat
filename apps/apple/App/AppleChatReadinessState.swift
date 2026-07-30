import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    func sendButtonTitle(_ i18n: NativeI18n) -> String {
        appleSendButtonTitle(
            i18n: i18n,
            isChatStreaming: isChatStreaming,
            isEditing: editingMessageId != nil,
            composerMode: composerMode,
            imageTaskMode: imageTaskMode
        )
    }

    func emptyStateTitle(_ i18n: NativeI18n) -> String {
        emptyStateTitle(i18n, conversationId: nil)
    }

    func emptyStateTitle(_ i18n: NativeI18n, conversationId: String?) -> String {
        appleEmptyStateTitle(
            provider: activeProvider(conversationId: conversationId),
            composerMode: composerMode,
            imageTaskMode: imageTaskMode,
            i18n: i18n
        )
    }

    func emptyStateDescription(_ i18n: NativeI18n) -> String {
        emptyStateDescription(i18n, conversationId: nil)
    }

    func emptyStateDescription(_ i18n: NativeI18n, conversationId: String?) -> String {
        let provider = activeProvider(conversationId: conversationId)
        return appleEmptyStateDescription(
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            composerMode: composerMode,
            imageModel: provider.map(imageModelForProvider) ?? "",
            imageTaskMode: imageTaskMode,
            hasSourceImage: hasSourceImageUpload,
            hasMaskImage: hasMaskImageUpload,
            i18n: i18n
        )
    }

    func emptyStateSettingsActionLabel(_ i18n: NativeI18n, conversationId: String?) -> String? {
        let provider = activeProvider(conversationId: conversationId)
        let chatModel = provider.map { chatModelForConversation(conversation(id: conversationId), provider: $0) } ?? ""
        return appleEmptyStateSettingsActionLabel(
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            composerMode: composerMode,
            imageModel: provider.map(imageModelForProvider) ?? "",
            chatModel: chatModel,
            i18n: i18n
        )
    }

    func emptyStateSettingsActionSystemImage(conversationId: String?) -> String {
        let provider = activeProvider(conversationId: conversationId)
        return appleEmptyStateSettingsActionSystemImage(
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            composerMode: composerMode
        )
    }

    func imageComposerHint(_ i18n: NativeI18n) -> String? {
        imageComposerHint(i18n, conversationId: nil)
    }

    func imageComposerHint(_ i18n: NativeI18n, conversationId: String?) -> String? {
        let provider = activeProvider(conversationId: conversationId)
        return appleImageComposerHint(
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            imageModel: provider.map(imageModelForProvider) ?? "",
            imageTaskMode: imageTaskMode,
            hasSourceImage: hasSourceImageUpload,
            hasMaskImage: hasMaskImageUpload,
            i18n: i18n
        )
    }

    var canSubmitCurrentInput: Bool {
        canSubmitCurrentInput(conversationId: nil)
    }

    func canSubmitCurrentInput(conversationId: String?) -> Bool {
        let provider = activeProvider(conversationId: conversationId)
        let chatModel = provider.map { chatModelForConversation(conversation(id: conversationId), provider: $0) } ?? ""
        return appleCanSubmitCurrentInput(
            input: input,
            isChatStreaming: isChatStreaming,
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            composerMode: composerMode,
            chatModel: chatModel,
            imageModel: provider.map(imageModelForProvider) ?? "",
            imageTaskMode: imageTaskMode,
            hasSourceImage: hasSourceImageUpload,
            hasMaskImage: hasMaskImageUpload
        )
    }
}
