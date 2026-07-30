import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    @discardableResult
    func consumePendingSharedText(openedBy url: URL? = nil) -> Bool {
        if let url, !AppleSharedTextIntake.isShareOpenURL(url) {
            return false
        }

        guard let text = AppleSharedTextIntake.consumePendingText() else {
            return false
        }

        importSharedText(text)
        return true
    }

    func beginEdit(_ message: ChatMessage) {
        guard message.role == .user else { return }
        input = message.content
        editingMessageId = message.id
        composerMode = .chat
    }

    func cancelEdit() {
        input = ""
        editingMessageId = nil
    }

    private func importSharedText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            input = trimmed
        } else {
            input += "\n\n\(trimmed)"
        }

        composerMode = .chat
        editingMessageId = nil
        clearSourceImage()
        clearMaskImage()
        notice = AppNotice(message: i18n.t("message.sharedTextAdded"), kind: .success)
    }
}
