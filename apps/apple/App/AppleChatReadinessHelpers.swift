import Foundation
import ZeroChatCore

func appleActiveProviderModelTitle(
    provider: ProviderConfig?,
    model: String,
    i18n: NativeI18n
) -> String {
    guard let provider else {
        return i18n.t("message.noEnabledProvider")
    }

    return "\(providerDisplayName(provider, i18n)) / \(model.isEmpty ? i18n.t("message.chooseModel") : model)"
}

func appleSendButtonTitle(
    i18n: NativeI18n,
    isChatStreaming: Bool,
    isEditing: Bool,
    composerMode: ComposerMode,
    imageTaskMode: ImageTaskMode
) -> String {
    if isChatStreaming {
        return i18n.t("action.stopGenerating")
    }
    if isEditing || composerMode == .chat {
        return i18n.t("action.send")
    }

    switch imageTaskMode {
    case .generate:
        return i18n.t("action.generate")
    case .edit:
        return i18n.t("mode.imageEdit")
    case .inpaint:
        return i18n.t("mode.imageInpaint")
    }
}

func appleEmptyStateTitle(
    provider: ProviderConfig?,
    composerMode: ComposerMode,
    imageTaskMode: ImageTaskMode,
    i18n: NativeI18n
) -> String {
    guard provider != nil else {
        return i18n.t("title.settings")
    }
    guard composerMode == .image else {
        return i18n.t("title.newChat")
    }

    switch imageTaskMode {
    case .generate:
        return i18n.t("mode.imageGenerate")
    case .edit:
        return i18n.t("mode.imageEdit")
    case .inpaint:
        return i18n.t("mode.imageInpaint")
    }
}

func appleImageComposerHint(
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    imageModel: String,
    imageTaskMode: ImageTaskMode,
    hasSourceImage: Bool,
    hasMaskImage: Bool,
    i18n: NativeI18n
) -> String? {
    guard let provider else {
        return i18n.t("message.configureModelFirst")
    }
    guard provider.kind != .anthropic else {
        return i18n.t("message.imageProviderRequired")
    }
    guard !providerKeyMissing else {
        return i18n.t("error.providerKeyRequired")
    }
    guard !imageModel.isEmpty else {
        return i18n.t("message.imageModelRequired")
    }
    if imageTaskMode != .generate && !hasSourceImage {
        return i18n.t("message.sourceImageRequired")
    }
    if imageTaskMode == .inpaint && !hasMaskImage {
        return i18n.t("message.maskImageRequired")
    }
    return nil
}

func appleEmptyStateDescription(
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    composerMode: ComposerMode,
    imageModel: String,
    imageTaskMode: ImageTaskMode,
    hasSourceImage: Bool,
    hasMaskImage: Bool,
    i18n: NativeI18n
) -> String {
    guard provider != nil else {
        return i18n.t("message.configureModelFirst")
    }
    if providerKeyMissing {
        return i18n.t("error.providerKeyRequired")
    }
    if composerMode == .image {
        return appleImageComposerHint(
            provider: provider,
            providerKeyMissing: providerKeyMissing,
            imageModel: imageModel,
            imageTaskMode: imageTaskMode,
            hasSourceImage: hasSourceImage,
            hasMaskImage: hasMaskImage,
            i18n: i18n
        ) ?? i18n.t("placeholder.imagePrompt")
    }
    return i18n.t("message.emptyChat")
}

func appleEmptyStateSettingsActionLabel(
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    composerMode: ComposerMode,
    imageModel: String,
    chatModel: String,
    i18n: NativeI18n
) -> String? {
    guard let provider else {
        return i18n.t("button.addProvider")
    }
    if providerKeyMissing {
        return i18n.t("action.addProviderKey")
    }
    if composerMode == .image {
        if provider.kind == .anthropic {
            return i18n.t("action.chooseProvider")
        }
        return imageModel.isEmpty ? i18n.t("action.addModel") : nil
    }

    return chatModel.isEmpty ? i18n.t("action.addModel") : nil
}

func appleEmptyStateSettingsActionSystemImage(
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    composerMode: ComposerMode
) -> String {
    guard let provider else {
        return "plus"
    }
    if providerKeyMissing {
        return "key.fill"
    }
    if composerMode == .image && provider.kind == .anthropic {
        return "server.rack"
    }
    return "plus.square.on.square"
}

func appleCanSubmitCurrentInput(
    input: String,
    isChatStreaming: Bool,
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    composerMode: ComposerMode,
    chatModel: String,
    imageModel: String,
    imageTaskMode: ImageTaskMode,
    hasSourceImage: Bool,
    hasMaskImage: Bool
) -> Bool {
    guard !isChatStreaming else {
        return false
    }
    guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let provider else {
        return false
    }
    guard !providerKeyMissing else {
        return false
    }

    if composerMode == .chat {
        return !chatModel.isEmpty
    }

    guard provider.kind != .anthropic, !imageModel.isEmpty else {
        return false
    }

    switch imageTaskMode {
    case .generate:
        return true
    case .edit:
        return hasSourceImage
    case .inpaint:
        return hasSourceImage && hasMaskImage
    }
}
